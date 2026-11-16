import test from "node:test";
import assert from "node:assert/strict";
import { previewTarget, previewChannel } from "../lib/pane-target.js";
import { terminalFonts } from "../lib/fonts.js";

test("right split targets a focused work pane, never a layout sidebar or another tab", () => {
  const list = [{ pane: "other", tab: "b", terminal: "t0" }, { pane: "work", tab: "a", terminal: "t1" }];
  const target = previewTarget(list, { pane: "sidebar-block", tab: "a" });
  assert.equal(target.work.pane, "work"); assert.equal(target.preview, undefined);
  assert.equal(target.channel, previewChannel("a"));
  assert.equal(previewTarget(list, null), null);
});

test("focusing the preview does not cause another nested split", () => {
  const list = [{ pane: "work", tab: "a", terminal: "t1" }, { pane: "preview", tab: "a", mod: "files-plus" }];
  const target = previewTarget(list, { pane: "preview", tab: "a" });
  assert.equal(target.preview.pane, "preview"); assert.equal(target.work.pane, "work");
});

test("font settings are terminal values, not a hardcoded 12px", () => {
  assert.deepEqual(terminalFonts({ font_family: "My Mono", font_size: 23 }), { font_family: "My Mono", font_size: 23 });
  assert.deepEqual(terminalFonts({ font_size: NaN }), { font_family: "monospace", font_size: 14 });
});
