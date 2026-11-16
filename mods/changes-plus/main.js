// Changes Plus: a read-only Changes sidebar with Better Changes' grouping, and
// a unified diff in a reusable pane beside the work pane (as in Files Plus).
// Native Changes' Git reads and limits are kept; no staging, commit or history.
import { View, div } from "gpui-kit";
import { h_flex, v_flex, v_virtual_list, Scrollbar } from "gpui-base";
import {
  spaces, panes, focused, props, exec, readTextFile, watchFolder, theme, settings,
  nextCommand, shared, setShared, run,
} from "herdr";
import { randomUUID } from "crypto";
import { previewTarget, previewChannel } from "./lib/pane-target.js";
import { terminalFonts, fontKey, rowHeight, diffWidthFor } from "./lib/fonts.js";
import { resolveLocation, locationKey, joinPath } from "./lib/location.js";
import {
  LIMITS, statusArgs, headArgs, topLevelArgs, numstatArgs, diffArgs,
  parseNumstat, mergeStats, parseStatus, groupFiles, diffRows, untrackedLines, limitLines,
} from "./lib/git.js";
import { SIZE, PanelRoot, PanelHeader, Icon, IconButton, Badge, GroupHeading } from "./views/ui.js";

export default class ChangesPlus extends View {
  init(_p, cx) {
    this.preview = props()?.role === "preview";
    this.handle = cx.focus_handle();
    this.files = []; this.groups = []; this.open = null; this.closed = new Set();
    this.rows = []; this.diffWidth = 300; this.error = null; this.note = null;
    this.loading = false; this.diffLoading = false; this.limited = false;
    this.diffToken = 0; this.loadedRevision = null;
    this.fullFile = shared("changes-plus.full-file") ?? false;
    this.shownFull = this.fullFile;
    this.font = fontKey(terminalFonts(settings()));
    this.refresh(cx);
    // A diff pane follows the shared pick (and terminal font settings) without
    // recreating the sidebar or opening another pane.
    if (this.preview) cx.timer.every(300, cx => this.follow(cx));
    else cx.timer.every(10000, cx => this.refresh(cx));
    cx.spawn(async cx => {
      for (;;) {
        const command = await nextCommand();
        if (command === "focus") this.handle.focus();
        else this.command(command, cx);
        cx.notify();
      }
    });
  }

  req() {
    if (!this.preview) return null;
    const p = props() ?? {};
    const request = p.channel ? shared(p.channel) : null;
    return request?.root && typeof request.file === "string" ? { ...p, ...request } : null;
  }

  location() {
    if (this.preview) {
      const r = this.req();
      return r
        ? { root: r.root, on: r.on ?? null, file: r.file, space: null }
        : { root: null, on: null, file: null, space: null };
    }
    const p = props() ?? {}, list = panes(), f = focused();
    const loc = resolveLocation({ spaces: spaces(), panes: list, focused: f, props: p });
    // A focused diff has no terminal cwd. Keep the folder it was opened from.
    if (p.root == null && list.find(pane => pane.pane === f?.pane)?.mod === "changes-plus") {
      const request = f?.tab ? shared(previewChannel(f.tab)) : null;
      if (request?.root) return { ...loc, root: request.root, on: request.on ?? null };
    }
    return loc;
  }

  contextKey() {
    const key = locationKey(this.location());
    return this.preview ? key + "|" + JSON.stringify(this.req()?.revision ?? null) : key;
  }

  watch(root, cx) {
    if (this.on || this.watched === root) return;
    this.watched = root;
    const context = this.context;
    cx.spawn(async cx => {
      try {
        while (this.context === context && this.watched === root) {
          await watchFolder(root);
          if (this.context === context) this.refresh(cx);
        }
      } catch { if (this.context === context) this.watched = null; }
    });
  }

  refresh(cx) {
    const next = this.contextKey();
    if (this.preview) {
      if (next !== this.context?.key) {
        const loc = this.location();
        this.context = { cwd: loc.root, key: next };
        this.root = loc.root; this.on = loc.on; this.file = loc.file;
        this.loadedRevision = this.req()?.revision ?? null;
        this.loadDiff(cx);
      }
      return;
    }
    if (next !== this.context?.key) {
      const loc = this.location();
      this.context = { cwd: loc.root, key: next };
      this.root = loc.root; this.on = loc.on;
      this.files = []; this.groups = []; this.open = null;
      this.error = null; this.note = null; this.limited = false;
      this.loading = false; this.watched = null;
    }
    if (!this.root || this.loading || this.busy) return;
    const context = this.context;
    this.loading = true; this.busy = true;
    cx.spawn(async cx => {
      try {
        const top = await exec("git", topLevelArgs(), { cwd: context.cwd, on: context.on });
        if (this.context !== context) return;
        if (top.code !== 0) {
          this.root = null; this.files = []; this.groups = []; this.open = null;
          this.error = "Not a git repository"; return;
        }
        const root = top.stdout.trim();
        const git = args => exec("git", args, { cwd: root, on: context.on });
        const status = await git(statusArgs());
        if (this.context !== context) return;
        if (status.code !== 0) throw new Error(status.stderr);
        const head = await git(headArgs());
        if (this.context !== context) return;
        const hasHead = head.code === 0, stats = {};
        for (const args of numstatArgs(hasHead)) {
          const result = await git(args);
          if (this.context !== context) return;
          if (result.code !== 0) throw new Error(result.stderr);
          mergeStats(stats, parseNumstat(result.stdout));
        }
        const parsed = parseStatus(status.stdout, stats, hasHead);
        if (this.context !== context) return;
        this.root = root; this.files = parsed.files; this.groups = groupFiles(parsed.files);
        this.limited = parsed.limited; this.error = null;
        this.watch(root, cx);
        if (this.open && !parsed.files.some(file => file.path === this.open)) this.open = null;
        // Keep native Changes' first-file selection, but don't open a pane on load.
        if (!this.open && parsed.files.length) this.open = parsed.files[0].path;
      } catch (e) {
        if (this.context === context) this.error = String(e);
      } finally {
        if (this.context === context) { this.loading = false; this.busy = false; }
        cx.notify();
      }
    });
  }

  follow(cx) {
    if (!this.preview) return;
    const fonts = terminalFonts(settings()), key = fontKey(fonts);
    if (key !== this.font) {
      this.font = key; this.diffWidth = diffWidthFor(this.rows, fonts); cx.notify();
    }
    const request = this.req();
    const full = request?.full ?? shared("changes-plus.full-file") ?? false;
    const revision = request?.revision ?? null;
    if (full !== this.shownFull || revision !== this.loadedRevision) {
      this.shownFull = full; this.fullFile = full; this.loadedRevision = revision;
      this.loadDiff(cx);
    }
  }

  setLines(lines) {
    this.rows = diffRows(limitLines(lines));
    this.diffWidth = diffWidthFor(this.rows, terminalFonts(settings()));
  }

  loadDiff(cx) {
    const token = ++this.diffToken, request = this.req();
    this.rows = []; this.diffWidth = 300; this.note = null; this.error = null;
    this.diffLoading = true;
    if (!request || !request.file) {
      this.diffLoading = false; cx.notify(); return;
    }
    const { root, on, file } = request;
    const meta = this.files.find(f => f.path === file);
    const fresh = meta?.fresh ?? request.fresh ?? false;
    const hasHead = meta?.hasHead ?? request.hasHead ?? true;
    const binary = meta?.binary ?? request.binary ?? false;
    cx.spawn(async cx => {
      try {
        let lines;
        if (fresh) {
          const text = await readTextFile(joinPath(root, file), { on: on ?? null });
          if (token !== this.diffToken) return;
          if (text === null) lines = ["Cannot preview this file (binary, too large, or unreadable)"];
          else if (text.includes("\0")) lines = ["Binary file · no text diff"];
          else lines = untrackedLines(text);
        } else {
          const result = await exec("git", diffArgs({ hasHead, path: file, full: this.fullFile }),
            { cwd: root, on: on ?? null });
          if (token !== this.diffToken) return;
          if (result.code !== 0) throw new Error(result.stderr || "git diff failed");
          const all = result.stdout.replace(/\n$/, "").split("\n");
          const first = all.findIndex(line => line.startsWith("@@"));
          lines = first < 0 ? [binary ? "Binary file changed" : "No text diff available"] : all.slice(first);
        }
        if (token !== this.diffToken) return;
        this.setLines(lines);
      } catch (e) {
        if (token === this.diffToken) this.note = `Cannot preview this diff: ${String(e)}`;
      } finally {
        if (token === this.diffToken) { this.diffLoading = false; cx.notify(); }
      }
    });
    cx.notify();
  }

  // Same right-split/reuse rule as Files Plus, on a separate channel.
  pick(path, cx) {
    const target = previewTarget(panes(), focused());
    if (!target?.work && !target?.preview) {
      this.error = "Select a work tab before opening a diff"; cx.notify(); return;
    }
    const file = this.files.find(f => f.path === path);
    const request = {
      root: this.root, on: this.on ?? null, file: path, revision: randomUUID(),
      fresh: file?.fresh ?? false, hasHead: file?.hasHead ?? true, binary: file?.binary ?? false,
      full: this.fullFile,
    };
    // The diff takes its whole-file choice from the shared request so the two
    // copies can never disagree after a restart or rapid click.
    setShared("changes-plus.full-file", this.fullFile);
    this.open = path; this.error = null;
    setShared(target.channel, request);
    if (target.preview) {
      run("pane.focus", { pane: target.preview.pane });
    } else if (!this.opening || this.opening.tab !== target.tab || Date.now() - this.opening.at > 3000) {
      this.opening = { tab: target.tab, at: Date.now() };
      run("pane.split", {
        pane: target.work.pane, direction: "right", mod: "changes-plus",
        props: { role: "preview", tab: target.tab, channel: target.channel, ...request },
      });
    }
    cx.notify();
  }

  previewPane() {
    const tab = props()?.tab;
    return tab ? panes().find(p => p.mod === "changes-plus" && p.tab === tab) : null;
  }

  closePreview(cx) {
    const pane = this.previewPane();
    if (pane) run("pane.close", { pane: pane.pane });
    cx.notify();
  }

  toggleGroup(key, cx) {
    if (this.closed.has(key)) this.closed.delete(key); else this.closed.add(key);
    cx.notify();
  }

  toggleFull(cx) {
    const full = !this.fullFile;
    this.fullFile = full; this.shownFull = full;
    setShared("changes-plus.full-file", full);
    // Update the open request too: a reopened tab must not fall back to the
    // previous mode when the shared preference is cleared with the pane.
    const channel = this.preview ? props()?.channel : focused()?.tab ? previewChannel(focused().tab) : null;
    const request = channel ? shared(channel) : null;
    if (channel && request) setShared(channel, { ...request, full, revision: randomUUID() });
    if (this.preview) this.loadDiff(cx);
    cx.notify();
  }

  command(command, cx) {
    if (command === "refresh") {
      this.refresh(cx);
      if (this.preview) this.loadDiff(cx);
    } else if (command === "full") this.toggleFull(cx);
    else if (command === "back" || command === "close-preview") {
      if (this.preview) this.closePreview(cx);
    } else if (command.startsWith("open:")) {
      const path = command.slice(5);
      if (this.files.some(file => file.path === path)) this.pick(path, cx);
    }
    cx.notify();
  }

  fileRow(file, t) {
    const parts = file.path.split("/"), name = parts.pop(), dir = parts.length ? parts.join("/") + "/" : "";
    const color = file.status === "A" ? t.ansi2 : file.status === "D" ? t.ansi1
      : file.status === "U" ? t.ansi1 : t.blocked;
    return h_flex().id(`changes-plus-file-${file.path}`).h(SIZE.row).flex_none().px(8).gap(8)
      .items_center().rounded(7).cursor_pointer().hover(s => s.bg(t.hover))
      .when(this.open === file.path, el => el.bg(t.selected))
      .on_click((_e, cx) => this.pick(file.path, cx))
      .child(Icon("file", 14).text_color(color))
      .child(h_flex().flex_1().min_w(0)
        .child(div().text_color(t.dim).truncate().child(dir))
        .child(div().max_w(260).min_w(0).truncate().child(name)))
      .when(file.add > 0, el => el.child(div().text_size(11).text_color(t.ansi2).child(`+${file.add}`)))
      .when(file.del > 0, el => el.child(div().text_size(11).text_color(t.ansi1).child(`−${file.del}`)))
      .child(div().w(14).flex_none().text_size(11).text_color(color).child(file.status));
  }

  diffRow(row, t, height) {
    const line = () => h_flex().w_full().h(height).flex_none().gap(10).px(10).items_center();
    if (row.kind === "@") {
      // No empty gutter here: a narrow split pane needs the whole row for the
      // hunk header, which is wider than the two line-number columns.
      return h_flex().w_full().h(height).flex_none().px(10).items_center()
        .bg(t.raised).text_color(t.accent)
        .child(div().flex_1().min_w(0).truncate().child(row.text));
    }
    const color = row.kind === "+" ? t.ansi2 : row.kind === "-" ? t.ansi1 : t.dim;
    return line()
      .when(row.kind === "+", el => el.bg(t.ansi2 + "18"))
      .when(row.kind === "-", el => el.bg(t.ansi1 + "18"))
      .child(div().w(42).flex_none().text_right().text_color(color).child(row.oldNo == null ? "" : String(row.oldNo)))
      .child(div().w(42).flex_none().text_right().text_color(color).child(row.newNo == null ? "" : String(row.newNo)))
      .child(div().w(10).flex_none().text_color(color).child(row.kind === " " ? "" : row.kind))
      .child(div().flex_1().min_w(0).truncate().child(row.text));
  }

  render(cx) {
    if (this.contextKey() !== this.context?.key) this.refresh(cx);
    const t = theme();
    const root = PanelRoot("changes-plus").track_focus(this.handle)
      .on_key_down((e, cx) => {
        if (e.key === "escape" && this.preview) { this.closePreview(cx); cx.stop_propagation(); }
        else if (e.key === "f" && this.preview) { this.toggleFull(cx); cx.stop_propagation(); }
      });

    if (!this.preview) {
      const add = this.files.reduce((sum, file) => sum + (file.add || 0), 0);
      const del = this.files.reduce((sum, file) => sum + (file.del || 0), 0);
      return root
        .child(PanelHeader()
          .child(div().font_semibold().child("Changes"))
          .child(Badge(this.files.length))
          .child(div().flex_1())
          .child(div().text_size(11).text_color(t.ansi2).child(`+${add}`))
          .child(div().text_size(11).text_color(t.ansi1).child(`−${del}`))
          .child(IconButton({ id: "changes-plus-refresh", icon: "refresh", label: "Refresh",
            onClick: c => this.command("refresh", c) })))
        .child(v_flex().id("changes-plus-list").flex_1().min_h(0).overflow_y_scrollbar().p(6)
          .children(this.groups.flatMap((group, index) => {
            const open = !this.closed.has(group.key);
            const heading = GroupHeading({
              id: `changes-plus-group-${group.key}`, label: group.label, count: group.files.length,
              color: t[group.tone] ?? t.muted, open, divided: index > 0,
              onClick: c => this.toggleGroup(group.key, c),
            });
            return open ? [heading, ...group.files.map(file => this.fileRow(file, t))] : [heading];
          }))
          .when(!this.files.length, el => el.child(div().p(8).text_color(t.dim)
            .child(this.error || (this.loading ? "Loading changes…" : this.root ? "No uncommitted changes" : "No folder"))))
          .when(this.limited, el => el.child(div().px(8).pb(8).text_size(11).text_color(t.dim)
            .child(`Showing the first ${LIMITS.files} changed files`))))
        .when(Boolean(this.note), el => el.child(div().px(10).pb(8).text_size(11).text_color(t.ansi1).child(this.note)));
    }

    const fonts = terminalFonts(settings()), height = rowHeight(fonts), file = this.req()?.file ?? null;
    return root
      .child(PanelHeader()
        .child(div().font_semibold().flex_none().child("Diff"))
        .child(div().flex_1().min_w(0).truncate().text_size(12).text_color(t.dim).tooltip(file ?? "")
          .child(file ?? "No file selected"))
        .child(div().id("changes-plus-full").h(26).flex_none().px(8).flex().items_center().rounded(6)
          .bg(this.fullFile ? t.selected : t.raised).text_color(this.fullFile ? t.foreground : t.dim)
          .text_size(11).cursor_pointer().hover(s => s.bg(t.hover))
          .tooltip("Whole file / changed lines only").on_click((_e, cx) => this.toggleFull(cx))
          .child("Full file"))
        .child(IconButton({ id: "changes-plus-diff-refresh", icon: "refresh", label: "Refresh",
          onClick: c => this.command("refresh", c) })))
      .when(Boolean(this.note), el => el.child(div().px(10).py(6).text_size(11).text_color(t.ansi1).child(this.note)))
      .child(div().flex_1().min_h(0).relative()
        .font_family(fonts.font_family).text_size(fonts.font_size)
        .child(div().id("changes-plus-diff-x").size_full().overflow_x_scrollbar()
          .child(div().w_full().min_w(this.diffWidth).h_full()
            .child(v_virtual_list("changes-plus-diff", this.rows.length, height, i => String(i),
              range => this.rows.slice(range.start, range.end).map(row => this.diffRow(row, t, height))).size_full())))
        .child(Scrollbar.vertical("changes-plus-diff").viewport_from_layout().absolute().inset_0())
        .when(!file, el => el.child(div().absolute().top(6).px(12).text_color(t.dim)
          .child("Select a file in Changes"))));
  }

  async close() {
    const channel = this.preview ? props()?.channel : null;
    if (channel && shared(channel)?.revision === this.loadedRevision) setShared(channel, null);
    this.diffToken++;
  }
}
