import test from "node:test";
import assert from "node:assert/strict";
import { dateTime, percent, money } from "../lib/format.js";
test("formats values without treating missing values as zero", () => {
  assert.equal(percent(62.33), "62.3%");
  assert.equal(percent(null), "—");
  assert.equal(dateTime(null), "—");
  assert.equal(money(12.4, "USD"), "USD 12.40");
});
