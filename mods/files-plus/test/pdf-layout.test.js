import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import vm from "node:vm";
import { pdfScale, pdfRasterScale, pdfLayout, PDF_PAGE_GAP } from "../lib/pdf-layout.js";

const document = () => ({ id: 1, pages: 2, width: 600, fit: true, zoom: 1,
  sizes: [{ width: 600, height: 800 }, { width: 800, height: 600 }] });

test("continuous layout uses real mixed page sizes and stable gaps", () => {
  const pdf = document(), layout = pdfLayout(pdf);
  assert.equal(pdfScale(pdf), 568 / 800);
  assert.equal(layout.heights[0], 800 * layout.scale + PDF_PAGE_GAP);
  assert.equal(layout.heights[1], 600 * layout.scale + PDF_PAGE_GAP);
  pdf.fit = false; pdf.zoom = 2;
  assert.equal(pdfLayout(pdf).width, 1632); assert.equal(pdfScale(pdf), 2);
  assert.equal(pdfRasterScale(0.01), 0.25); assert.equal(pdfRasterScale(1.25), 1.5); assert.equal(pdfRasterScale(4), 3);
});

test("virtual PDF renderer returns adjacent page rows, including placeholders", async () => {
  const calls = [], range = { start: 0, end: 2 }, rows = [];
  const el = (kind, value) => {
    const target = { kind, value, children: [], styles: {} }; let proxy;
    proxy = new Proxy(target, { get(o, key) {
      if (key in o) return o[key];
      if (key === "child") return child => { o.children.push(child); return proxy; };
      return value => { o.styles[key] = value; return proxy; };
    } }); return proxy;
  };
  const sandbox = { pdfLayout,
    div: () => el("div"), image: path => el("image", path), v_flex: () => el("column"),
    Scrollbar: { vertical: id => el("scrollbar", id) },
    v_virtual_list(id, count, sizes, key, render) {
      calls.push({ id, count, sizes, keys: [key(0), key(1)] }); rows.push(...render(range, {})); return el("list");
    },
  };
  const source = (await readFile(new URL("../renderers/pdf.js", import.meta.url), "utf8"))
    .replace(/^import .*;\n/gm, "").replace("export function renderPdfDocument", "globalThis.renderPdfDocument = function");
  vm.runInNewContext(source, sandbox);
  const visible = [];
  sandbox.renderPdfDocument(document(), { pages: new Map([[0, { resource: { asset: "page-1.png" } }]]), errors: new Map() }, {}, {}, {
    visible: (...args) => visible.push(args), size() {},
  });
  assert.equal(calls[0].count, 2); assert.deepEqual(calls[0].keys, ["0", "1"]);
  assert.equal(rows.length, 2); assert.equal(rows[0].children[0].children[0].value, "page-1.png");
  assert.equal(rows[1].children[0].children[0].children[0], "Loading page 2…");
  assert.equal(visible[0][0], range);
});

test("refresh uses a circular SVG instead of a font-dependent character", async () => {
  const main = await readFile(new URL("../main.js", import.meta.url), "utf8");
  const svg = await readFile(new URL("../refresh.svg", import.meta.url), "utf8");
  assert.match(main, /svg\("mods\/files-plus\/refresh.svg"\)/);
  assert.doesNotMatch(main, /this\.button\("↻"/);
  assert.match(svg, /a8 8/); assert.match(svg, /stroke-linecap="round"/);
});
