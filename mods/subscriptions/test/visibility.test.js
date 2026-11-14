import test from "node:test";
import assert from "node:assert/strict";
import { panelVisible, shouldLoad } from "../lib/visibility.js";
const layout = (hidden, active = "subscriptions") => ({
  type: "column", children: [{ id: "panel", type: "column", hidden, children: [
    { id: "panel-body", type: "stack", active, children: [
      { id: "files" }, { id: "subscriptions", content: { mod: "subscriptions" } },
    ] },
  ] }],
});
test("requires both shown ancestors and selected stack child", () => {
  assert.equal(panelVisible(layout(false)), true);
  assert.equal(panelVisible(layout(true)), false);
  assert.equal(panelVisible(layout(false, "files")), false);
  assert.equal(panelVisible(null), false);
});
test("query only once per open token, never on hidden redraw", () => {
  assert.equal(shouldLoad(true, 1, null), true);
  assert.equal(shouldLoad(true, 1, 1), false);
  assert.equal(shouldLoad(false, 2, 1), false);
  assert.equal(shouldLoad(true, 2, 1), true);
});
