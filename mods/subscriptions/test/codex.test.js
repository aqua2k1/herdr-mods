import test from "node:test";
import assert from "node:assert/strict";
import { parse } from "../providers/codex.js";

const window = { usedPercent: 62, windowDurationMins: 300, resetsAt: 1800000000 };
test("parses multiple pools and quota windows without guessing", () => {
  const result = parse(JSON.stringify({ result: { rateLimitsByLimitId: {
    codex: { planType: "plus", primary: window, secondary: { ...window, windowDurationMins: 10080 } },
    review: { limitName: "Code review", primary: { ...window, usedPercent: 0 } },
  } } }), 123);
  assert.equal(result.tier, "plus");
  assert.equal(result.observedAt, 123);
  assert.deepEqual(result.quotas.map(q => q.title), ["5h 额度", "每周额度", "Code review · 5h 额度"]);
  assert.equal(result.quotas[0].resetsAt, 1800000000000);
  assert.equal(result.quotas[2].usedPercent, 0);
});
test("parses read-only reset credit details and timestamps without retaining IDs", () => {
  const snapshot = parse(JSON.stringify({ result: {
    rateLimits: { primary: window },
    rateLimitResetCredits: { availableCount: 1, credits: [{
      id: "not-needed-by-read-only-ui", title: "Full reset", description: "Weekly + 5 hr",
      status: "available", grantedAt: 1800000000, expiresAt: 1801000000,
    }] },
  } }));
  assert.equal(snapshot.resetCredits.availableCount, 1);
  assert.deepEqual(snapshot.resetCredits.credits[0], {
    title: "Full reset", description: "Weekly + 5 hr", status: "available",
    grantedAt: 1800000000000, expiresAt: 1801000000000,
  });
});
test("distinguishes unavailable reset information, count-only and zero credits", () => {
  const read = summary => parse(JSON.stringify({ result: {
    rateLimits: { primary: window }, rateLimitResetCredits: summary,
  } })).resetCredits;
  assert.equal(read(null), null);
  assert.deepEqual(read({ availableCount: 1, credits: null }), { availableCount: 1, credits: null });
  assert.deepEqual(read({ availableCount: 0, credits: [] }), { availableCount: 0, credits: [] });
  assert.equal(read({ credits: [] }).availableCount, null);
  assert.equal(read({ availableCount: -1 }).availableCount, null);
});
test("supports legacy single limit result", () => {
  assert.equal(parse(JSON.stringify({ result: { rateLimits: { primary: window } } })).quotas.length, 1);
});
test("reports RPC errors, missing limits and malformed JSON", () => {
  assert.throws(() => parse('{"error":{"message":"Please log in"}}'), /Please log in/);
  assert.throws(() => parse('{"result":{}}'), /未返回/);
  assert.throws(() => parse("invalid"));
});
test("does not coerce null/string percentages into zero", () => {
  assert.throws(() => parse(JSON.stringify({ result: { rateLimits: { primary: { usedPercent: null } } } })));
});
