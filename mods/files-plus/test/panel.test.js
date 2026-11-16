import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import vm from "node:vm";
import { resolveLocation, locationKey, joinPath } from "../lib/location.js";
import { PreviewRequests, previewKind } from "../lib/preview.js";
import { imageState } from "../lib/image-state.js";
import { previewTarget, previewChannel } from "../lib/pane-target.js";
import { terminalFonts, fontKey } from "../lib/fonts.js";
import { randomUUID } from "node:crypto";
import { PdfPages } from "../lib/pdf-pages.js";
import { pdfScale, pdfRasterScale } from "../lib/pdf-layout.js";

const source = (await readFile(new URL("../main.js", import.meta.url), "utf8"))
  .replace(/^import .*;\n/gm, "").replace("export default class FilesPlus", "globalThis.FilesPlus = class FilesPlus");
const deferred = () => { let resolve; const promise = new Promise(r => { resolve = r; }); return { promise, resolve }; };
const settle = async () => { for (let n = 0; n < 20; n++) await Promise.resolve(); };

function panel(overrides = {}) {
  const config = { root: "/project", on: null };
  const removed = [], codes = [], calls = [], errors = [], commands = [];
  const store = new Map();
  const resources = {
    async init() {},
    allocatePdf() { return { path: "/app/cache/files-plus/pdf/test.png", asset: "cache/files-plus/pdf/test.png" }; },
    async image(value) { return { path: "/cache/" + value.tag, asset: value.tag, width: 10, height: 10 }; },
    async binary() { return { path: "/app/data/files-plus/download.pdf", asset: "data/files-plus/download.pdf" }; },
    async remove(value) { removed.push(value.path); }, async close() {},
    ...overrides.resources,
  };
  const sandbox = {
    View: class {}, resolveLocation, locationKey, joinPath, PreviewRequests, previewKind, imageState,
    previewTarget, previewChannel, terminalFonts, fontKey, randomUUID, PdfPages, pdfScale, pdfRasterScale,
    shared: key => store.get(key), setShared: (key, value) => store.set(key, value),
    run: (name, args) => commands.push({ name, args }),
    props: () => config, spaces: () => [], panes: () => [], focused: () => null,
    window: () => ({ platform: "linux" }), theme: () => ({}), settings: () => ({}), appHome: () => "/app",
    fs: { readFile: async () => "helper" },
    exec: async (...args) => { calls.push(args); return { code: 0 }; },
    directory: async (...args) => { calls.push(args); return []; }, PER_FOLDER: 500, TOTAL: 5000,
    readTextFile() {}, readText: async () => "source", readImage: async () => ({ tag: "image" }),
    readBinary: async () => new Uint8Array([37, 80, 68, 70, 45]),
    createCode(text, path, t, fonts) { const code = { text, fonts, released: false, release() { this.released = true; } }; codes.push(code); return code; },
    inspectPdf: async () => ({ pages: 2, sizes: [{ width: 600, height: 800 }, { width: 800, height: 600 }] }),
    renderPdf: async (_path, options) => ({ pages: 2, page: options.page, width: 600, height: 800 }),
    watchFolder: () => new Promise(() => {}),
    ...overrides,
  };
  vm.runInNewContext(source, sandbox, { filename: "files-plus/main.js" });
  const value = new sandbox.FilesPlus();
  Object.assign(value, { requests: new PreviewRequests(), resources, saved: new Map(), entries: new Map(), folders: new Set(), pending: new Map(), folderRequests: new Map(), image: imageState(), file: null });
  const loc = value.location(); value.context = { ...loc, cwd: loc.root, key: locationKey(loc) }; value.root = loc.root; value.on = loc.on;
  const cx = { notify() {}, sleep: async () => {}, spawn(fn) { Promise.resolve(fn(cx)).catch(e => errors.push(e)); } };
  return { value, config, cx, removed, codes, calls, errors, sandbox, commands, store };
}

test("preview leaves pane zoom/close buttons to Herdr", () => {
  assert.doesNotMatch(source, /this\.button\("Zoom"/);
  assert.doesNotMatch(source, /this\.button\("×"/);
});

test("sidebar opens on the right of the work pane without replacing its tree", () => {
  const list = [{ pane: "work", tab: "a", terminal: "t1" }];
  const { value, cx, commands, store } = panel({ panes: () => list, focused: () => ({ pane: "work", tab: "a" }) });
  value.folders.add("src"); value.openFile("src/a.ts", cx); value.openFile("src/b.ts", cx);
  assert.equal(commands.length, 1); assert.equal(commands[0].name, "pane.split");
  assert.equal(commands[0].args.pane, "work"); assert.equal(commands[0].args.direction, "right");
  assert.equal(commands[0].args.props.role, "preview"); assert.equal(commands[0].args.props.tab, "a");
  assert.equal(store.get(previewChannel("a")).file, "src/b.ts");
  assert.equal(value.file, null); assert.equal(value.selected, "src/b.ts"); assert.equal(value.folders.has("src"), true);
});

test("existing preview is reused only within the current tab", () => {
  const list = [{ pane: "work", tab: "a", terminal: "t1" }, { pane: "other", tab: "b", mod: "files-plus" }, { pane: "preview", tab: "a", mod: "files-plus" }];
  const { value, cx, commands, store } = panel({ panes: () => list, focused: () => ({ pane: "work", tab: "a" }) });
  value.openFile("photo.png", cx);
  assert.equal(commands[0].name, "pane.focus"); assert.equal(commands[0].args.pane, "preview");
  assert.equal(commands.length, 1); assert.equal(store.get(previewChannel("b")), undefined);
  value.command("close-preview", cx); assert.equal(commands.length, 1, "sidebar must not close a preview");
});

test("preview has a fixed source, skips folder scans, and closes only its own pane", async () => {
  const list = [{ pane: "work", tab: "a", terminal: "t1" }, { pane: "preview", tab: "a", mod: "files-plus" }];
  const { value, cx, config, commands, calls, store } = panel({ panes: () => list });
  Object.assign(config, { role: "preview", tab: "a", channel: previewChannel("a"), file: "hello.ts" });
  value.preview = true; value.context = null; value.refresh(cx); await settle();
  assert.equal(value.text, "source"); assert.equal(calls.length, 0);
  assert.equal(value.root, "/project");
  value.command("zoom-pane", cx); value.command("close-preview", cx);
  assert.equal(commands[0].name, "pane.zoom"); assert.equal(commands[0].args.pane, "preview");
  assert.equal(commands[1].name, "pane.close"); assert.equal(commands[1].args.pane, "preview");
  store.set(config.channel, { root: "/second", file: "new.ts", revision: "v2" });
  value.refresh(cx); await settle(); assert.equal(value.root, "/second"); assert.equal(value.file, "new.ts");
  await value.close(); assert.equal(store.get(config.channel), null);
});

test("preview focus keeps the sidebar at the originating terminal cwd", () => {
  const { value, config, store } = panel({
    panes: () => [{ pane: "preview", tab: "a", mod: "files-plus", cwd: null }],
    focused: () => ({ pane: "preview", tab: "a" }),
    spaces: () => [{ id: "space", active: true, folder: "/old-root" }],
  });
  delete config.root;
  store.set(previewChannel("a"), { root: "/terminal/live-cwd", on: "remote", file: "a.ts" });
  assert.equal(value.location().root, "/terminal/live-cwd"); assert.equal(value.location().on, "remote");
});

test("terminal font settings update an open code viewer without re-reading the file", async () => {
  const fonts = { font_family: "Terminal Mono", font_size: 20 }; let reads = 0;
  const { value, cx, codes } = panel({ settings: () => fonts, readText: async () => { reads++; return "text"; } });
  value.show("hello.ts", cx); await settle(); assert.equal(value.code.fonts.font_size, 20);
  fonts.font_size = 24; value.syncFonts(cx); await settle();
  assert.equal(value.code.fonts.font_size, 24); assert.equal(value.code.fonts.font_family, "Terminal Mono");
  assert.equal(codes[0].released, true); assert.equal(reads, 1);
});

test("panel uses native location root and never queries Git", async () => {
  const { value, cx, calls, errors } = panel();
  value.context = null; value.refresh(cx); await settle();
  assert.equal(value.root, "/project"); assert.equal(value.context.cwd, "/project");
  assert.equal(calls[0][0], "/project"); assert.equal(calls.length, 1);
  assert.equal(errors.length, 0);
});

test("context switch cleans the old image without waiting for another preview", async () => {
  const { value, cx, config, removed } = panel();
  value.show("photo.png", cx); await settle();
  const old = value.resource.path; config.root = "/other";
  value.refresh(cx); await settle();
  assert.ok(removed.includes(old)); assert.equal(value.file, null);
});

test("same-folder results only commit the latest revision", async () => {
  const first = deferred(), second = deferred(); let n = 0;
  const { value } = panel({ directory: () => (++n === 1 ? first : second).promise });
  const old = value.loadFolder("", value.context), fresh = value.loadFolder("", value.context);
  second.resolve([{ name: "new.txt", dir: false }]); await fresh;
  first.resolve([{ name: "deleted.txt", dir: false }]); await old;
  assert.equal(value.entries.get("")[0].name, "new.txt");
});

test("same-file reload rejects old text and releases replaced Editor", async () => {
  const first = deferred(), second = deferred(); let n = 0;
  const { value, cx, codes } = panel({ readText: () => (++n === 1 ? first : second).promise });
  value.show("a.ts", cx); await settle();
  value.show("a.ts", cx); await settle();
  second.resolve("new"); await settle(); first.resolve("old"); await settle();
  assert.equal(value.text, "new"); assert.equal(codes.length, 1);
  value.show(null, cx); await settle(); assert.equal(codes[0].released, true);
});

test("image cache finishing after a switch is removed and cannot replace text", async () => {
  const writing = deferred();
  const { value, cx, removed } = panel({ resources: { image: () => writing.promise } });
  value.show("photo.png", cx); await settle();
  value.show("hello.ts", cx); await settle();
  writing.resolve({ path: "/cache/late.png", asset: "late.png", width: 10, height: 10 }); await settle();
  assert.equal(value.text, "source"); assert.equal(value.resource, null);
  assert.ok(removed.includes("/cache/late.png"));
});

test("leaving a machine invalidates results even before refresh", async () => {
  const loading = deferred();
  const { value, cx, config } = panel({ readText: () => loading.promise });
  value.show("hello.ts", cx); await settle(); config.on = "other-machine";
  loading.resolve("wrong machine"); await settle(); assert.equal(value.code, null);
});

test("closing invalidates pending work and releases native state", async () => {
  const loading = deferred();
  const { value, cx, codes } = panel({ readText: () => loading.promise });
  value.show("hello.ts", cx); await settle(); await value.close();
  loading.resolve("too late"); await settle(); assert.equal(codes.length, 0);
});

test("PDF is a continuous session, renders only requested pages and closes on file switch", async () => {
  const { value, cx, errors } = panel();
  value.show("two.pdf", cx); await settle();
  assert.equal(value.pdf.page, 1); assert.equal(value.pdfSession.pages.size, 0);
  value.pdfVisible({ start: 0, end: 1 }, 1, cx); await settle();
  assert.equal(value.pdfSession.pages.get(0).resource.asset, "cache/files-plus/pdf/test.png");
  value.pdfPage(2, 1, cx); await settle(); assert.equal(value.pdf.page, 2);
  const old = value.pdfSession;
  value.show("hello.ts", cx); await settle(); assert.equal(value.pdf, null); assert.equal(value.pdfSession, null);
  assert.equal(old.pages.size, 0); assert.equal(errors.length, 0);
});

test("PDF coalesces measurement/visible ranges and never notifies on unchanged layout", async () => {
  const { value, cx } = panel();
  value.show("two.pdf", cx); await settle();
  const wanted = []; let notifications = 0;
  value.pdfSession.ensure = async range => { wanted.push({ ...range }); };
  cx.notify = () => { notifications++; };
  value.pdfVisible({ start: 0, end: 1 }, 1, cx);
  value.pdfVisible({ start: 1, end: 2 }, 1, cx); await settle();
  assert.deepEqual(wanted, [{ start: 1, end: 2 }]); assert.equal(value.pdf.page, 2);
  assert.equal(notifications, 1);
  value.pdfVisible({ start: 0, end: 1 }, 1, cx);
  value.pdfVisible({ start: 1, end: 2 }, 1, cx); await settle();
  assert.equal(wanted.length, 1); assert.equal(notifications, 1);
});

test("remote PDF downloads bounded bytes and renders the local cache, not a local lookalike", async () => {
  let source;
  const { value, cx, config, removed } = panel({ renderPdf: async (path, options) => {
    source = path; return { pages: 2, page: options.page, width: 600, height: 800 };
  } }); config.on = "remote";
  const loc = value.location(); value.context = { ...loc, cwd: loc.root, key: locationKey(loc) };
  value.show("two.pdf", cx); await settle();
  value.pdfVisible({ start: 0, end: 1 }, 1, cx); await settle();
  assert.equal(source, "/app/data/files-plus/download.pdf"); assert.equal(value.pdf.page, 1);
  value.show(null, cx); await settle(); assert.ok(removed.includes(source));
});
