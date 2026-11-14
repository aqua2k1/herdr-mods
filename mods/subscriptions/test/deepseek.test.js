import test from "node:test";
import assert from "node:assert/strict";
import deepseek, { parse } from "../providers/deepseek.js";
import { PROVIDERS } from "../providers/index.js";
const balance = { currency: "CNY", total_balance: "110.00", granted_balance: "10.00", topped_up_balance: "100.00" };

test("registers DeepSeek as an independent API provider", () => {
  assert.equal(deepseek.kind, "api");
  assert.ok(PROVIDERS.includes(deepseek));
});
test("parses documented balance fields without converting them to spending", () => {
  const snapshot = parse(JSON.stringify({ is_available: true, balance_infos: [balance] }), 123);
  assert.deepEqual(snapshot, {
    tier: "按量计费", observedAt: 123, quotas: [], accountAvailable: true,
    balances: [{ currency: "CNY", total: "110.00", granted: "10.00", toppedUp: "100.00" }],
  });
  assert.equal(snapshot.spending, undefined);
});
test("supports multiple currencies, zero, negative and high precision balances", () => {
  const result = parse(JSON.stringify({ is_available: false, balance_infos: [
    { ...balance, total_balance: "0.00" },
    { currency: "USD", total_balance: "-0.000000000000000001", granted_balance: "0", topped_up_balance: "0" },
  ] }));
  assert.equal(result.accountAvailable, false);
  assert.equal(result.balances[0].total, "0.00");
  assert.equal(result.balances[1].total, "-0.000000000000000001");
});
test("missing optional fields remain unknown, not zero", () => {
  const result = parse(JSON.stringify({ balance_infos: [{ currency: "USD", total_balance: "1.00" }] }));
  assert.equal(result.accountAvailable, null);
  assert.equal(result.balances[0].granted, null);
});
test("rejects missing, malformed and error responses", () => {
  for (const data of [null, {}, { balance_infos: [] }, { balance_infos: [null] },
    { balance_infos: [{ ...balance, total_balance: null }] },
    { balance_infos: [{ ...balance, total_balance: 110 }] },
    { balance_infos: [{ ...balance, currency: "invalid" }] },
    { error: { message: "do not expose raw server errors" } }]) {
    assert.throws(() => parse(JSON.stringify(data)));
  }
  assert.throws(() => parse("not json"));
});
