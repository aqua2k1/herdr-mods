import test from "node:test";
import assert from "node:assert/strict";
import { PdfPages } from "../lib/pdf-pages.js";

const deferred = () => {
  let resolve, reject;
  const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
};
const tick = () => new Promise(resolve => setImmediate(resolve));
function harness(options = {}) {
  const calls = [], released = [];
  const pager = new PdfPages({
    count: 10000,
    renderPage: async (index, scale) => {
      const resource = { index, scale };
      calls.push(resource);
      return resource;
    },
    release: async resource => { released.push(resource); },
    ...options,
  });
  return { pager, calls, released };
}
const keys = pager => [...pager.pages.keys()].sort((a, b) => a - b);

test("visible pages first, bounded prefetch, edges and empty ranges", async () => {
  const { pager, calls, released } = harness();
  await pager.ensure({ start: 50, end: 52 }, 1);
  assert.deepEqual(calls.map(x => x.index), [50, 51, 49, 52]);
  assert.deepEqual(keys(pager), [49, 50, 51, 52]);
  await pager.ensure({ start: 0, end: 1 }, 1);
  assert.deepEqual(keys(pager), [0, 1]);
  await pager.ensure({ start: 9999, end: 10000 }, 1);
  assert.deepEqual(keys(pager), [9998, 9999]);
  await pager.ensure({ start: 2, end: 2 }, 1);
  assert.equal(pager.pages.size, 0);
  assert.equal(calls.length, 8);
  assert.equal(released.length, 8);
});

test("serial rendering, shared running Promise, latest range replaces queued work", async () => {
  const first = deferred();
  let active = 0, maximum = 0;
  const calls = [];
  const { pager, released } = harness({ renderPage: async (index, scale) => {
    active++;
    maximum = Math.max(maximum, active);
    calls.push(index);
    if (calls.length === 1) await first.promise;
    active--;
    return { index, scale };
  } });
  const running = pager.ensure({ start: 1, end: 2 }, 1);
  await tick();
  assert.deepEqual(calls, [1]);
  assert.equal(pager.ensure({ start: 20, end: 21 }, 1), running);
  assert.equal(pager.ensure({ start: 40, end: 41 }, 1), running);
  first.resolve();
  await running;
  assert.equal(maximum, 1);
  assert.deepEqual(calls, [1, 40, 39, 41]);
  assert.deepEqual(keys(pager), [39, 40, 41]);
  assert.deepEqual(released, [{ index: 1, scale: 1 }]);
});

test("cache eviction is prompt, overlaps reuse resources, async cleanup is awaited", async () => {
  const cleanup = deferred();
  const released = [];
  const { pager, calls } = harness({ release: async resource => {
    released.push(resource);
    await cleanup.promise;
  } });
  await pager.ensure({ start: 2, end: 3 }, 1);
  const retained = pager.pages.get(3).resource;
  const running = pager.ensure({ start: 3, end: 4 }, 1);
  assert.equal(pager.pages.has(1), false);
  await tick();
  assert.deepEqual(released.map(x => x.index), [1]);
  assert.equal(pager.pages.get(3).resource, retained);
  cleanup.resolve();
  await running;
  assert.deepEqual(keys(pager), [2, 3, 4]);
  assert.equal(calls.length, 4);
});

test("scale races discard old results, clamp helper scale and never overwrite new scale", async () => {
  const first = deferred();
  const calls = [];
  const { pager, released } = harness({ count: 1, renderPage: async (index, scale) => {
    calls.push(scale);
    if (calls.length === 1) await first.promise;
    return { index, scale };
  } });
  const running = pager.ensure({ start: 0, end: 1 }, 0.01);
  await tick();
  assert.equal(pager.ensure({ start: 0, end: 1 }, 9), running);
  first.resolve();
  await running;
  assert.deepEqual(calls, [0.25, 3]);
  assert.deepEqual(released, [{ index: 0, scale: 0.25 }]);
  assert.equal(pager.pages.get(0).scale, 3);
  await pager.ensure({ start: 0, end: 1 }, 2);
  assert.deepEqual(released.map(x => x.scale), [0.25, 3]);
  assert.equal(pager.pages.get(0).scale, 2);
});

test("errors are recorded without retry loops, obsolete failures do not poison latest scale", async () => {
  const { pager, calls } = harness({ count: 3, renderPage: (index, scale) => {
    calls.push({ index, scale });
    throw new Error("broken " + index);
  } });
  await pager.ensure({ start: 1, end: 2 }, 1);
  assert.equal(calls.length, 3);
  assert.deepEqual(pager.errors.get(1), { message: "broken 1", scale: 1 });
  for (let i = 0; i < 5; i++) await pager.ensure({ start: 1, end: 2 }, 1);
  assert.equal(calls.length, 3);
  await pager.ensure({ start: 1, end: 2 }, 2);
  assert.equal(calls.length, 6);

  const fail = deferred();
  let attempts = 0;
  const other = harness({ count: 1, renderPage: async () => {
    if (++attempts === 1) await fail.promise;
    return "ok";
  } }).pager;
  const running = other.ensure({ start: 0, end: 1 }, 1);
  await tick();
  other.ensure({ start: 0, end: 1 }, 2);
  fail.reject(new Error("obsolete"));
  await running;
  assert.equal(other.errors.size, 0);
  assert.deepEqual(other.pages.get(0), { resource: "ok", scale: 2 });
});

test("close releases cached pages without waiting for long render; late result is cleaned once", async () => {
  const late = deferred();
  const { pager, released } = harness({ count: 3, renderPage: async (index, scale) => {
    if (index === 0) await late.promise;
    return { index, scale };
  } });
  const running = pager.ensure({ start: 1, end: 2 }, 1);
  await tick(); // Visible page 1 is cached; prefetch page 0 is blocked.
  assert.deepEqual(keys(pager), [1]);
  const closing = pager.close();
  assert.equal(pager.close(), closing);
  await closing;
  assert.deepEqual(released, [{ index: 1, scale: 1 }]);
  await pager.ensure({ start: 2, end: 3 }, 2);
  assert.equal(pager.pages.size, 0);
  late.resolve();
  await running;
  assert.deepEqual(released, [{ index: 1, scale: 1 }, { index: 0, scale: 1 }]);
  assert.equal(pager.pages.size, 0);
  assert.equal(pager.errors.size, 0);
});

test("invalid current closes cached resources and releases in-flight results", async () => {
  let current = true;
  const late = deferred();
  const { pager, released } = harness({ count: 3, isCurrent: () => current,
    renderPage: async index => index === 0 ? late.promise : index });
  const running = pager.ensure({ start: 1, end: 2 }, 1);
  await tick();
  current = false;
  late.resolve(0);
  await running;
  assert.deepEqual(released, [1, 0]);
  await pager.ensure({ start: 1, end: 2 }, 1);
  assert.equal(pager.pages.size, 0);
  const never = harness({ isCurrent: () => false });
  await never.pager.ensure({ start: 0, end: 1 }, 1);
  assert.equal(never.calls.length, 0);
});

test("validates metadata/range/scale without allocation; release rejection is contained", async () => {
  for (const count of [0, -1, 1.5, 10001, NaN, Infinity, "2"]) {
    assert.throws(() => harness({ count }), RangeError);
  }
  assert.throws(() => new PdfPages({ count: 1 }), TypeError);
  const { pager, calls } = harness({ release: async () => { throw new Error("host lease fallback"); } });
  for (const range of [null, {}, { start: -1, end: 1 }, { start: 2, end: 1 },
    { start: 0, end: 10001 }, { start: 0.5, end: 1 }, { start: "0", end: 1 }]) {
    await assert.rejects(pager.ensure(range, 1), RangeError);
  }
  for (const scale of [NaN, Infinity, -Infinity, "1", undefined]) {
    await assert.rejects(pager.ensure({ start: 0, end: 1 }, scale), RangeError);
  }
  assert.equal(calls.length, 0);
  await pager.ensure({ start: 0, end: 1 }, 1);
  await pager.ensure({ start: 10, end: 11 }, 1);
  await pager.close();
});

test("ensure updates received during asynchronous eviction are drained", async () => {
  const cleanup = deferred();
  const { pager } = harness({ release: async () => cleanup.promise });
  await pager.ensure({ start: 0, end: 1 }, 1);
  const running = pager.ensure({ start: 0, end: 0 }, 1);
  await tick();
  assert.equal(pager.ensure({ start: 100, end: 101 }, 2), running);
  cleanup.resolve();
  await running;
  assert.deepEqual(keys(pager), [99, 100, 101]);
  assert.ok([...pager.pages.values()].every(entry => entry.scale === 2));
});
