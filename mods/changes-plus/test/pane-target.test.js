import test from "node:test";
import assert from "node:assert/strict";
import { previewTarget, previewChannel, PREVIEW_MOD } from "../lib/pane-target.js";
import { terminalFonts, fontKey, rowHeight, diffWidthFor } from "../lib/fonts.js";

test("the diff splits beside a focused work pane, never a layout sidebar or another tab", () => {
  const list = [{ pane: "other", tab: "b", terminal: "t0" }, { pane: "work", tab: "a", terminal: "t1" }];
  const target = previewTarget(list, { pane: "sidebar-block", tab: "a" });
  assert.equal(target.work.pane, "work");
  assert.equal(target.preview, undefined);
  assert.equal(target.channel, previewChannel("a"));
  assert.equal(previewTarget(list, null), null);
});

test("focusing the diff does not cause another nested split", () => {
  const list = [{ pane: "work", tab: "a", terminal: "t1" }, { pane: "diff", tab: "a", mod: PREVIEW_MOD }];
  const target = previewTarget(list, { pane: "diff", tab: "a" });
  assert.equal(target.preview.pane, "diff");
  assert.equal(target.work.pane, "work");
});

test("diff font and row metrics come from terminal settings", () => {
  const fonts = terminalFonts({ font_family: "My Mono", font_size: 20 });
  assert.deepEqual(fonts, { font_family: "My Mono", font_size: 20 });
  assert.equal(fontKey(fonts), '["My Mono",20]');
  assert.equal(rowHeight(fonts), 30);
  assert.ok(diffWidthFor([{ text: "x".repeat(100) }], fonts) > 300);
  assert.deepEqual(terminalFonts({ font_size: NaN }), { font_family: "monospace", font_size: 14 });
  assert.equal(PREVIEW_MOD, "changes-plus");
});
