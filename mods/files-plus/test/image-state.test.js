import test from "node:test";
import assert from "node:assert/strict";
import { imageState, fitScale, scaleOf, resetImage, zoomImage, panImage } from "../lib/image-state.js";
import { PreviewRequests, previewKind } from "../lib/preview.js";

test("fit preserves aspect and never upscales small images", () => {
  const s = { ...imageState(), width: 800, height: 600 };
  assert.equal(fitScale(s, { width: 1600, height: 400 }), 0.5);
  assert.equal(fitScale(s, { width: 100, height: 100 }), 1);
});

test("zoom keeps the image point below the mouse fixed", () => {
  const s = { ...imageState(), width: 800, height: 600 };
  const image = { width: 1600, height: 1200 };
  zoomImage(s, image, 2, { x: 600, y: 400 });
  assert.equal(scaleOf(s, image), 1);
  assert.equal(s.x, -200); assert.equal(s.y, -100);
  panImage(s, 30, -20); assert.equal(s.x, -170); assert.equal(s.y, -120);
  resetImage(s, true); assert.equal(scaleOf(s, image), 1); assert.equal(s.x, 0);
  resetImage(s); assert.equal(scaleOf(s, image), 0.5);
});

test("view zoom is bounded without changing pixel data", () => {
  const s = imageState(), image = { width: 100000, height: 100000 };
  zoomImage(s, image, 1e9); assert.equal(s.zoom, 32);
  zoomImage(s, image, 1e-9); assert.equal(s.zoom, 0.01);
  assert.equal(image.width, 100000);
});

test("same-file reopen and close invalidate old asynchronous requests", () => {
  const requests = new PreviewRequests();
  const old = requests.begin(), next = requests.begin();
  assert.equal(requests.current(old), false); assert.equal(requests.current(next), true);
  requests.close(); assert.equal(requests.current(next), false);
});

test("preview routing is case insensitive and has a binary fallback", () => {
  assert.equal(previewKind("a/PHOTO.JPG"), "image");
  assert.equal(previewKind("README.MD"), "markdown");
  assert.equal(previewKind("slides.pdf"), "pdf");
  assert.equal(previewKind("archive.zip"), "unsupported");
  assert.equal(previewKind(".gitignore"), "code");
  assert.equal(previewKind("main.ts"), "code");
});
