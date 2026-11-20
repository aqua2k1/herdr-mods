import test from "node:test";
import assert from "node:assert/strict";
import gemini, { parse } from "../providers/gemini.js";
import { PROVIDERS } from "../providers/index.js";

const report = () => ({
  status: "SUCCESS",
  groups: [
    { name: "Gemini Models", buckets: [
      { id: "gemini-weekly", window: "weekly", remaining_fraction: 0.988, reset_time: "2026-10-30T23:07:13Z" },
      { id: "gemini-5h", window: "5h", remaining_fraction: 0.986, reset_time: "2026-10-24T14:59:51Z" },
    ] },
    { name: "Claude and GPT models", buckets: [
      { id: "3p-5h", window: "5h", remaining_fraction: 0.75, reset_time: "2026-10-24T15:00:00Z" },
      { id: "3p-weekly", window: "weekly", remaining_fraction: 1, reset_time: "2026-10-30T00:00:00Z" },
    ] },
    { name: "Gemini 4 Argon", buckets: [
      { id: "gemini-argon-wtu-weekly", window: "weekly", remaining_fraction: 0.5, reset_time: "2026-11-01T00:00:00Z" },
    ] },
  ],
});

test("registers Gemini as a subscription provider without a credential", () => {
  assert.equal(gemini.id, "gemini-subscription");
  assert.equal(gemini.title, "Gemini");
  assert.equal(gemini.kind, "subscription");
  assert.equal(gemini.credential, undefined);
  assert.ok(PROVIDERS.includes(gemini));
});

test("parses every bucket into its own quota regardless of order", () => {
  const result = parse(JSON.stringify(report()), 123);
  assert.equal(result.observedAt, 123);
  assert.equal(result.tier, null);
  assert.equal(result.quotas.length, 5);
  assert.deepEqual(result.quotas.map(q => [q.id, q.group, q.title]), [
    ["agy:gemini-weekly", "Gemini 模型", "每周"],
    ["agy:gemini-5h", "Gemini 模型", "5 小时"],
    ["agy:3p-5h", "Claude / GPT 模型", "5 小时"],
    ["agy:3p-weekly", "Claude / GPT 模型", "每周"],
    ["agy:gemini-argon-wtu-weekly", "Gemini 4 Argon", "每周"],
  ]);
});

test("remaining fractions become used percentages and ISO resets become epoch ms", () => {
  const [weekly, fiveHour, , filled, argon] = parse(JSON.stringify(report())).quotas;
  assert.equal(weekly.usedPercent, 1.2);
  assert.equal(fiveHour.usedPercent, 1.4);
  assert.equal(filled.usedPercent, 0);
  assert.equal(argon.usedPercent, 50);
  assert.equal(fiveHour.resetsAt, Date.parse("2026-10-24T14:59:51Z"));
  assert.equal(fiveHour.windowSeconds, 18000);
  assert.equal(weekly.windowSeconds, 604800);
});

test("unknown groups and windows are preserved instead of dropped", () => {
  const result = parse(JSON.stringify({ status: "SUCCESS", groups: [
    { name: "Future Pool", buckets: [
      { id: "future-daily", window: "daily", remaining_fraction: 0.25 },
      { id: "unlabeled" },
    ] },
  ] }));
  assert.deepEqual(result.quotas.map(q => [q.group, q.title, q.usedPercent, q.resetsAt]), [
    ["Future Pool", "daily", 75, null],
    ["Future Pool", "unlabeled", null, null],
  ]);
});

test("disabled and malformed buckets are skipped", () => {
  const result = parse(JSON.stringify({ status: "SUCCESS", groups: [
    { name: "Gemini Models", buckets: [
      { id: "off", window: "5h", remaining_fraction: 1, disabled: true },
      null, { window: "5h", remaining_fraction: 1 }, { id: "", remaining_fraction: 1 },
      { id: "ok", window: "5h", remaining_fraction: 0.9, reset_time: "not-a-date" },
    ] },
  ] }));
  assert.equal(result.quotas.length, 1);
  assert.equal(result.quotas[0].id, "agy:ok");
  assert.equal(result.quotas[0].resetsAt, null);
});

test("rejects failures and malformed responses instead of inventing zeroes", () => {
  for (const data of [
    { status: "FAILURE" },
    { status: "AUTHENTICATION_REQUIRED" },
    { status: "SUCCESS", groups: [] },
    { status: "SUCCESS", groups: [{ name: "Gemini Models", buckets: [] }] },
    { status: "SUCCESS" },
    null,
  ]) {
    assert.throws(() => parse(JSON.stringify(data)));
  }
  assert.throws(() => parse("not json"));
});
