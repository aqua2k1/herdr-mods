import test from "node:test";
import assert from "node:assert/strict";
import { initialState, loadProvider } from "../lib/state.js";
test("retains last good snapshot on error", async () => {
  const state = initialState();
  await loadProvider(state, async () => ({ quotas: [] }), () => {});
  const previous = state.snapshot;
  await loadProvider(state, async () => { throw new Error("offline"); }, () => {});
  assert.equal(state.status, "error");
  assert.equal(state.snapshot, previous);
  assert.equal(state.error, "offline");
});
test("deduplicates in-flight queries", async () => {
  const state = initialState();
  let resolve;
  let calls = 0;
  const fetch = () => { calls++; return new Promise(r => { resolve = r; }); };
  const first = loadProvider(state, fetch, () => {});
  await loadProvider(state, fetch, () => {});
  assert.equal(calls, 1);
  resolve({ quotas: [] });
  await first;
  assert.equal(state.status, "ready");
});
test("providers fail independently", async () => {
  const a = initialState(), b = initialState();
  await Promise.all([
    loadProvider(a, async () => { throw new Error("failed"); }, () => {}),
    loadProvider(b, async () => ({ tier: "plus" }), () => {}),
  ]);
  assert.equal(a.status, "error");
  assert.equal(b.status, "ready");
});
