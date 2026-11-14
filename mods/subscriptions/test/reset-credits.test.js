import test from "node:test";
import assert from "node:assert/strict";
import { resetCreditsModel } from "../lib/reset-credits.js";

test("does not manufacture missing credit counts or details", () => {
  assert.equal(resetCreditsModel(null), null);
  assert.equal(resetCreditsModel({ availableCount: null, credits: null }).count, "数量未知");
  assert.equal(resetCreditsModel({ availableCount: 0, credits: [] }).count, "0 张可用");
  assert.equal(resetCreditsModel({ availableCount: 1, credits: null }).note, "暂无重置卡明细");
});
test("displays states and expiry without consuming credits or changing server counts", () => {
  const summary = { availableCount: 1, credits: [
    { title: "Full reset", description: "Weekly + 5h", status: "available", grantedAt: 1, expiresAt: 100 },
    { title: null, description: null, status: "redeemed", grantedAt: null, expiresAt: null },
    { status: "future-status", grantedAt: null, expiresAt: null },
  ] };
  const model = resetCreditsModel(summary, 200);
  assert.match(model.credits[0].expiry, /已到期/);
  assert.equal(model.count, "1 张可用");
  assert.equal(model.credits[1].status, "已使用");
  assert.equal(model.credits[1].expiry, "无到期时间");
  assert.equal(model.credits[2].status, "未知");
  assert.equal(summary.credits[0].status, "available");
});
