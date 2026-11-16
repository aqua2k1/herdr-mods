// Derived from Herdr's native Files MOD (Apache-2.0); no Git queries.
import { View, div, svg } from "gpui-kit";
import * as fs from "fs/promises";
import { v_flex, h_flex, VirtualListScrollHandle } from "gpui-base";
import { spaces, panes, focused, props, exec, readTextFile, watchFolder, theme, settings, window, appHome, nextCommand, shared, setShared, run } from "herdr";
import { randomUUID } from "crypto";
import { previewTarget, previewChannel } from "./lib/pane-target.js";
import { terminalFonts, fontKey } from "./lib/fonts.js";
import { directory, PER_FOLDER, TOTAL } from "./lib/directory.js";
import { resolveLocation, locationKey, joinPath } from "./lib/location.js";
import { readImage, readText, readBinary } from "./lib/file-source.js";
import { Resources } from "./lib/resources.js";
import { PreviewRequests, previewKind } from "./lib/preview.js";
import { imageState, resetImage, scaleOf, zoomImage } from "./lib/image-state.js";
import { createCode, renderCode } from "./renderers/code.js";
import { renderMarkdown } from "./renderers/markdown.js";
import { renderImage } from "./renderers/image.js";
import { renderPdf, inspectPdf } from "./lib/pdf-source.js";
import { PdfPages } from "./lib/pdf-pages.js";
import { pdfScale, pdfRasterScale } from "./lib/pdf-layout.js";
import { renderPdfDocument } from "./renderers/pdf.js";

export default class FilesPlus extends View {
  init(_p, cx) {
    this.saved = new Map(); this.entries = new Map(); this.folders = new Set(); this.pending = new Map(); this.folderRequests = new Map();
    this.requests = new PreviewRequests(); this.resources = new Resources(appHome()); this.image = imageState();
    this.handle = cx.focus_handle(); this.pdfScroll = VirtualListScrollHandle.new(); this.file = null; this.source = false;
    this.preview = props()?.role === "preview"; this.selected = null;
    this.refresh(cx);
    if (!this.preview) cx.timer.every(10000, cx => this.refresh(cx));
    cx.spawn(async cx => {
      for (;;) {
        const command = await nextCommand();
        if (command === "focus") this.handle.focus();
        else this.command(command, cx);
        cx.notify();
      }
    });
  }

  previewRequest() {
    const p = props() ?? {};
    const request = p.channel ? shared(p.channel) : null;
    return request?.root && typeof request.file === "string" ? { ...p, ...request } : p;
  }

  location() {
    const p = this.preview ? this.previewRequest() : props() ?? {};
    const list = panes(), f = focused();
    const loc = resolveLocation({ spaces: spaces(), panes: list, focused: f, props: p });
    // A focused preview has no terminal cwd. Keep the folder it was opened from,
    // rather than falling back to the space's (possibly different) root.
    if (!this.preview && p.root == null && list.find(pane => pane.pane === f?.pane)?.mod === "files-plus") {
      const request = f?.tab ? shared(previewChannel(f.tab)) : null;
      if (request?.root) return { ...loc, root: request.root, on: request.on ?? null };
    }
    return loc;
  }

  contextKey() {
    const key = locationKey(this.location());
    return this.preview ? key + JSON.stringify(this.previewRequest().revision ?? null) : key;
  }
  current(context) { return this.context === context && this.contextKey() === context.key; }

  openFile(path, cx) {
    const target = previewTarget(panes(), focused());
    if (!target?.work && !target?.preview) {
      this.error = "Select a work tab before opening a file"; cx.notify(); return;
    }
    const request = { root: this.root, on: this.on ?? null, file: path, revision: randomUUID() };
    this.selected = path; this.error = null;
    setShared(target.channel, request);
    if (target.preview) {
      this.opening = null;
      run("pane.focus", { pane: target.preview.pane });
    } else if (!this.opening || this.opening.tab !== target.tab || Date.now() - this.opening.at > 3000) {
      this.opening = { tab: target.tab, at: Date.now() };
      run("pane.split", { pane: target.work.pane, direction: "right", mod: "files-plus",
        props: { role: "preview", tab: target.tab, channel: target.channel, ...request } });
    }
    cx.notify();
  }

  previewPane() {
    const tab = props()?.tab;
    return tab ? panes().find(p => p.mod === "files-plus" && p.tab === tab) : null;
  }

  syncFonts(cx) {
    if (this.text == null || !this.code) return;
    const key = fontKey(terminalFonts(settings()));
    if (key === this.codeFont || this.fontPending) return;
    this.fontPending = true;
    cx.spawn(async cx => {
      try {
        if (this.text == null || !this.code) return;
        const fonts = terminalFonts(settings());
        this.code.release(); this.code = createCode(this.text, this.file, theme(), fonts);
        this.codeFont = fontKey(fonts);
      } finally { this.fontPending = false; cx.notify(); }
    });
  }

  watch(root, cx) {
    if (this.on || this.watched === root) return;
    this.watched = root;
    const context = this.context;
    cx.spawn(async cx => {
      try {
        while (this.current(context)) {
          await watchFolder(root);
          if (this.current(context)) this.refresh(cx);
        }
      } catch { if (this.context === context) this.watched = null; }
    });
  }

  async loadFolder(path, context) {
    const revision = (this.folderRequests.get(path) ?? 0) + 1;
    this.folderRequests.set(path, revision);
    const entries = await directory(path ? joinPath(context.cwd, path) : context.cwd, context.on, { exec, platform: window()?.platform });
    if (!this.current(context) || this.folderRequests.get(path) !== revision || (path && !this.folders.has(path))) return;
    const used = [...this.entries.entries()].filter(([p]) => p !== path).reduce((n, [, e]) => n + e.length, 0);
    this.entries.set(path, entries.slice(0, Math.max(0, Math.min(PER_FOLDER, TOTAL - used)))
      .sort((a, b) => Number(b.dir) - Number(a.dir) || a.name.localeCompare(b.name)));
    if (entries.length > PER_FOLDER || used + entries.length > TOTAL) this.limited = true;
  }

  refresh(cx) {
    const loc = this.location(), next = this.contextKey();
    if (this.preview) {
      if (next !== this.context?.key) {
        this.context = { ...loc, cwd: loc.root, key: next }; this.root = loc.root; this.on = loc.on;
        this.loadedRevision = this.previewRequest().revision;
        this.show(this.previewRequest().file ?? null, cx);
      }
      return;
    }
    if (next !== this.context?.key) {
      if (this.context) this.saved.set(this.context.key, { folders: this.folders, selected: this.selected });
      if (this.saved.size > 20) this.saved.delete(this.saved.keys().next().value);
      const saved = this.saved.get(next);
      this.context = { ...loc, cwd: loc.root, key: next }; this.root = loc.root; this.on = loc.on;
      this.entries = new Map(); this.folders = new Set(saved?.folders); this.pending = new Map(); this.folderRequests = new Map();
      this.show(null, cx); this.watched = null; this.error = null; this.loading = false;
      this.selected = saved?.selected ?? null;
    }
    if (!this.root || this.loading) return;
    const context = this.context;
    this.loading = true; this.limited = false;
    cx.spawn(async cx => {
      try {
        for (const path of ["", ...this.folders]) {
          if (!this.current(context)) return;
          await this.loadFolder(path, context);
        }
        if (this.current(context)) { this.error = null; this.watch(context.cwd, cx); }
      } catch (e) { if (this.current(context)) this.error = String(e); }
      finally { if (this.context === context) this.loading = false; cx.notify(); }
    });
  }

  toggle(path, cx) {
    if (this.folders.has(path)) {
      for (const folder of [...this.folders]) if (folder === path || folder.startsWith(path + "/")) {
        this.folders.delete(folder); this.entries.delete(folder); this.pending.delete(folder);
        this.folderRequests.set(folder, (this.folderRequests.get(folder) ?? 0) + 1);
      }
    } else {
      this.folders.add(path);
      if (!this.entries.has(path) && !this.pending.has(path)) {
        const context = this.context;
        const pending = {}; this.pending.set(path, pending);
        cx.spawn(async cx => {
          try { await this.loadFolder(path, context); }
          catch (e) { if (this.current(context)) this.error = String(e); }
          finally { if (this.context === context && this.pending.get(path) === pending) this.pending.delete(path); cx.notify(); }
        });
      }
    }
    cx.notify();
  }

  show(path, cx) {
    const token = this.requests.begin();
    const oldPdf = this.pdfSession; this.pdfSession = null; this.pdfRangeKey = null; this.pdfWanted = null; this.pdfQueued = null;
    if (oldPdf && cx) cx.spawn(async () => { await oldPdf.close(); });
    this.code?.release(); this.code = null;
    const previous = [this.resource, this.pdfSource].filter(Boolean); this.resource = null; this.pdfSource = null;
    this.file = path; this.fileError = null; this.text = null; this.source = false;
    this.pdf = null; this.kind = path ? previewKind(path) : null; this.image = imageState();
    if (previous.length && cx) cx.spawn(async () => { for (const resource of previous) await this.resources.remove(resource); });
    // Context changes also call show(null) without cx; the next task cleans up.
    else if (previous.length) this.retired = [...(this.retired ?? []), ...previous];
    if (!cx) return;
    const context = this.context;
    cx.spawn(async cx => {
      const retired = this.retired ?? []; this.retired = [];
      for (const resource of retired) await this.resources.remove(resource);
      if (!this.requests.current(token) || !this.current(context)) return;
      if (!path) { cx.notify(); return; }
      try {
        if (this.kind === "unsupported") throw new Error("This file type has no preview yet");
        if (this.kind === "pdf") {
          if (context.on) {
            const bytes = await readBinary(joinPath(context.cwd, path), context.on, { exec, platform: window()?.platform, scripts: await this.helperScripts(),
              isCurrent: () => this.requests.current(token) && this.current(context) });
            if (!this.requests.current(token) || !this.current(context)) return;
            if (bytes.length < 5 || String.fromCharCode(...bytes.slice(0, 5)) !== "%PDF-") throw new Error("Not a PDF file");
            const source = await this.resources.binary(bytes, "pdf");
            if (!this.requests.current(token) || !this.current(context)) { await this.resources.remove(source); return; }
            this.pdfSource = source;
          }
          await this.openPdf(path, token, context); return;
        }
        if (this.kind === "image") {
          const scripts = await this.helperScripts();
          const value = await readImage(joinPath(context.cwd, path), context.on, { exec, platform: window()?.platform, scripts,
            isCurrent: () => this.requests.current(token) && this.current(context) });
          if (!this.requests.current(token) || !this.current(context)) return;
          const resource = await this.resources.image(value);
          if (!this.requests.current(token) || !this.current(context)) { await this.resources.remove(resource); return; }
          this.resource = resource;
        } else {
          const text = await readText(joinPath(context.cwd, path), context.on, { readTextFile });
          if (!this.requests.current(token) || !this.current(context)) return;
          const fonts = terminalFonts(settings());
          this.text = text; this.code = createCode(text, path, theme(), fonts); this.codeFont = fontKey(fonts);
        }
      } catch (e) { if (this.requests.current(token) && this.current(context)) this.fileError = String(e).replace(/^Error: /, ""); }
      finally { cx.notify(); }
    });
  }

  helperScripts() {
    this.scripts ??= Promise.all([
      fs.readFile(`${appHome()}/mods/files-plus/helpers/read-image.sh`, "utf8"),
      fs.readFile(`${appHome()}/mods/files-plus/helpers/read-image.ps1`, "utf8"),
    ]).then(([posix, windows]) => ({ posix, windows }));
    return this.scripts;
  }

  async openPdf(path, token, context) {
    await this.resources.init();
    if (!this.requests.current(token)) return;
    const source = this.pdfSource?.path ?? joinPath(context.cwd, path);
    const options = {
      helper: `${appHome()}/mods/files-plus/helpers/render-pdf.py`, lease: this.resources.lease,
      python: props()?.python || (window()?.platform === "windows" ? "python" : "python3"),
    };
    const info = await inspectPdf(source, options, { exec });
    if (!this.requests.current(token) || !this.current(context)) return;
    this.pdf = { ...info, id: token, page: 1, fit: true, zoom: 1, width: 0 };
    const session = new PdfPages({ count: info.pages,
      isCurrent: () => this.pdfSession === session && this.requests.current(token) && this.current(context),
      release: resource => this.resources.remove(resource),
      renderPage: async (index, scale) => {
        const target = this.resources.allocatePdf();
        try {
          await renderPdf(source, { ...options, page: index + 1, scale, output: target.path }, { exec });
          return target;
        } catch (e) { await this.resources.remove(target); throw e; }
      },
    });
    this.pdfSession = session;
    this.pdfScroll?.scroll_to_item(0);
  }

  pdfVisible(range, scale, cx) {
    const session = this.pdfSession;
    const raster = pdfRasterScale(scale), key = `${range.start}:${range.end}:${raster}`;
    if (!session) return;
    this.pdfWanted = { session, range, raster, key };
    if (this.pdfRangeKey === key || this.pdfQueued?.session === session) return;
    const queued = { session }; this.pdfQueued = queued;
    cx.spawn(async cx => {
      // Layout may first measure a representative row, then report the actual
      // visible range. Coalesce those calls before I/O; do not notify per layout.
      await cx.sleep(0);
      if (this.pdfQueued !== queued) return;
      this.pdfQueued = null;
      const wanted = this.pdfWanted;
      if (this.pdfSession !== session || wanted?.session !== session || this.pdfRangeKey === wanted.key) return;
      this.pdfRangeKey = wanted.key;
      this.pdf.page = wanted.range.start + 1;
      await session.ensure(wanted.range, wanted.raster);
      if (this.pdfSession === session) cx.notify();
    });
  }

  pdfPage(page, _scale, cx) {
    if (!this.pdf) return;
    this.pdf.page = Math.max(1, Math.min(this.pdf.pages, page));
    this.pdfScroll?.scroll_to_item(this.pdf.page - 1);
    cx.notify();
  }

  command(command, cx) {
    if (this.preview && (command === "close-preview" || command === "back")) {
      const pane = this.previewPane(); if (pane) run("pane.close", { pane: pane.pane });
    } else if (command === "zoom-pane" && this.preview) {
      const pane = this.previewPane(); if (pane) run("pane.zoom", { pane: pane.pane });
    } else if (command === "back") this.show(null, cx);
    else if (command === "refresh") { this.refresh(cx); if (this.file) this.show(this.file, cx); }
    else if (command === "source" && this.kind === "markdown") this.source = !this.source;
    else if (this.pdf && ["fit", "actual", "zoom-in", "zoom-out"].includes(command)) {
      const pdf = this.pdf, scale = pdfScale(pdf);
      pdf.fit = command === "fit";
      pdf.zoom = command === "actual" ? 1 : Math.max(0.05, Math.min(4, scale * (command === "zoom-in" ? 1.25 : command === "zoom-out" ? 0.8 : 1)));
      this.pdfRangeKey = null;
      this.pdfScroll?.scroll_to_item(pdf.page - 1);
    } else if (command === "fit") resetImage(this.image);
    else if (command === "actual") resetImage(this.image, true);
    else if (this.resource && (command === "zoom-in" || command === "zoom-out")) {
      zoomImage(this.image, this.resource, command === "zoom-in" ? 1.25 : 0.8);
    } else if (this.pdf && command === "next") this.pdfPage(this.pdf.page + 1, null, cx);
    else if (this.pdf && command === "previous") this.pdfPage(this.pdf.page - 1, null, cx);
    cx.notify();
  }

  button(label, command, t, title = label) {
    return div().id(`files-plus-${command}`).px(7).py(4).rounded(4).text_size(12).flex_none()
      .text_color(t.foreground).cursor_pointer().hover(s => s.bg(t.hover)).tooltip(title)
      .on_click((_e, cx) => this.command(command, cx)).child(label);
  }

  rows(prefix, depth, out, t) {
    if (out.length >= TOTAL || depth > 40) return out;
    for (const entry of this.entries.get(prefix) ?? []) {
      if (out.length >= TOTAL) break;
      const path = prefix ? `${prefix}/${entry.name}` : entry.name, open = this.folders.has(path);
      out.push(h_flex().id(`files-plus-file-${path}`).h(28).flex_none().pl(8 + depth * 18).pr(8).gap(7)
        .items_center().rounded(7).cursor_pointer().hover(s => s.bg(t.hover))
        .when(path === this.selected, el => el.bg(t.selected))
        .on_click((_e, cx) => entry.dir ? this.toggle(path, cx) : this.openFile(path, cx))
        .child(entry.dir ? svg(`mods/files-plus/chevron-${open ? "down" : "right"}.svg`).size(12).flex_none().text_color(t.dim) : div().w(12).flex_none())
        .child(svg(`mods/files-plus/${entry.dir ? "folder" : "file"}.svg`).size(14).flex_none().text_color(t.muted))
        .child(div().flex_1().min_w(0).truncate().child(entry.name)));
      if (entry.dir && open) this.rows(path, depth + 1, out, t);
    }
    return out;
  }

  render(cx) {
    if (this.contextKey() !== this.context?.key) this.refresh(cx);
    if (this.preview) this.syncFonts(cx);
    const t = theme();
    const root = v_flex().id("files-plus").size_full().min_h(0).min_w(0).rounded(10).overflow_hidden()
      .track_focus(this.handle).bg(t.background).border_1().border_color(t.border).text_color(t.foreground).text_size(13)
      .on_key_down((e, cx) => {
        const map = { escape: "back", "+": "zoom-in", "=": "zoom-in", "-": "zoom-out", "0": "fit", "1": "actual" };
        if (map[e.key]) { this.command(map[e.key], cx); cx.stop_propagation(); }
      })
      .child(h_flex().h(42).flex_none().px(10).gap(5).items_center().border_b(1).border_color(t.border)
        .child(div().font_semibold().flex_none().child(this.preview ? "Preview" : "Files"))
        .child(div().flex_1().min_w(0).truncate().text_size(12).text_color(t.dim).tooltip(this.root ?? "")
          .child(this.file ?? this.root ?? "No folder"))
        .when(Boolean(this.on), el => el.child(div().text_size(11).text_color(t.accent).child(this.on)))
        .child(div().id("files-plus-refresh").size(26).flex_none().flex().items_center().justify_center().rounded(6)
          .text_color(t.muted).cursor_pointer().hover(s => s.bg(t.hover)).tooltip("Refresh")
          .on_click((_e, cx) => this.command("refresh", cx))
          .child(svg("mods/files-plus/refresh.svg").size(16))));
    if (!this.preview) return root.child(v_flex().id("files-plus-tree").flex_1().min_h(0).overflow_y_scrollbar().p(6)
      .children(this.rows("", 0, [], t))
      .when(Boolean(this.error) || !this.entries.get("")?.length, el => el.child(div().p(8).text_color(t.dim)
        .child(this.error || (this.loading ? "Loading files…" : this.root ? "No files" : "No folder"))))
      .when(this.limited, el => el.child(div().p(8).text_size(11).text_color(t.dim).child("Limited to 500 entries per folder / 5,000 total"))));
    if (this.kind === "markdown") root.child(h_flex().h(34).flex_none().px(8).items_center()
      .child(this.button(this.source ? "Preview" : "Source", "source", t)));
    if (this.resource) root.child(h_flex().h(34).flex_none().px(8).gap(3).items_center()
      .child(this.button("−", "zoom-out", t)).child(this.button("+", "zoom-in", t))
      .child(this.button("Fit", "fit", t)).child(this.button("100%", "actual", t))
      .child(div().text_size(11).text_color(t.dim).child(`${Math.round(scaleOf(this.image, this.resource) * 100)}% · ${this.resource.width} × ${this.resource.height}`)));
    if (this.pdf) root.child(h_flex().h(34).flex_none().px(8).gap(3).items_center()
      .child(this.button("−", "zoom-out", t)).child(this.button("+", "zoom-in", t))
      .child(this.button("Fit width", "fit", t)).child(this.button("100%", "actual", t))
      .child(div().text_size(11).text_color(t.dim).child(`${Math.round(pdfScale(this.pdf) * 100)}%`))
      .child(this.button("‹", "previous", t, "Previous page"))
      .child(div().text_size(11).text_color(t.dim).child(`${this.pdf.page} / ${this.pdf.pages}`))
      .child(this.button("›", "next", t, "Next page")));
    if (this.fileError) return root.child(div().p(12).text_color(t.muted).child(this.fileError));
    if (this.pdf && this.pdfSession) return root.child(renderPdfDocument(this.pdf, this.pdfSession, this.pdfScroll, t, {
      visible: (range, scale, cx) => this.pdfVisible(range, scale, cx),
      size: (size, cx) => {
        // GPUI reports measured pixels; numeric MOD dimensions include app zoom.
        const width = size.width / (Number(settings().zoom) || 1);
        if (this.pdf && this.pdf.width !== width) { this.pdf.width = width; this.pdfRangeKey = null; cx.notify(); }
      },
    }));
    if (this.resource) return root.child(renderImage(this.resource, this.image, t));
    if (this.kind === "markdown" && this.text !== null && !this.source) return root.child(renderMarkdown(this.text, "files-plus-markdown", t, terminalFonts(settings())));
    return root.child(this.code ? renderCode(this.code) : div().p(12).text_color(t.dim).child("Loading file…"));
  }

  async close() {
    const channel = this.preview ? props()?.channel : null;
    if (channel && shared(channel)?.revision === this.loadedRevision) setShared(channel, null);
    this.requests.close(); this.code?.release(); this.code = null; this.resource = null;
    await this.pdfSession?.close(); this.pdfSession = null;
    this.pdfScroll?.release();
    await this.resources.close();
  }
}
