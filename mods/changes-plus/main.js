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
import {
  COMMITS_PER_PAGE, logArgs, branchArgs, upstreamArgs, defaultBranchArgs, mergeBaseArgs,
  revListArgs, countArgs, originUrlArgs, commitFilesArgs, commitDiffArgs,
  parseLog, parseCommitFiles, timeAgo, githubRepo, groupCommits,
} from "./lib/commits.js";
import { SIZE, PanelRoot, PanelHeader, Icon, IconButton, GroupHeading, HeaderTab } from "./views/ui.js";

const lines = text => text.split("\n").filter(Boolean);

export default class ChangesPlus extends View {
  init(_p, cx) {
    this.preview = props()?.role === "preview";
    this.handle = cx.focus_handle();
    this.files = []; this.groups = []; this.open = null;
    this.closed = new Set(JSON.parse(localStorage.getItem("changes-plus.collapsed") ?? "[]"));
    this.tab = localStorage.getItem("changes-plus.tab") === "commit" ? "commit" : "changes";
    this.resetCommits();
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

  resetCommits() {
    this.commits = []; this.remote = null; this.remoteHead = null;
    this.behind = 0; this.branch = null; this.repo = null; this.hasHead = false;
    this.commitsDone = false; this.commitsLoading = false; this.commitsError = null;
    this.selectedCommit = null; this.commitFiles = [];
    this.commitFilesLoading = false; this.commitFilesError = null;
    this.commitsToken = (this.commitsToken ?? 0) + 1;
    this.commitToken = (this.commitToken ?? 0) + 1;
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
      this.resetCommits();
      // A new context needs a fresh read even if the previous one was still
      // in flight; its result is ignored by the `this.context === context`
      // checks, so leaving `busy` set here would block refreshes forever.
      this.loading = false; this.busy = false; this.watched = null;
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
        this.hasHead = hasHead;
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

  setTab(tab, cx) {
    if (this.preview || this.tab === tab) return;
    this.tab = tab;
    localStorage.setItem("changes-plus.tab", tab);
    if (tab === "commit") this.loadCommits(cx);
    cx.notify();
  }

  // What HEAD has over its upstream, or over the recorded default branch when
  // the branch was never pushed. Only the last fetch is read; never fetch.
  async historyMeta(git, stale) {
    const upstream = await git(upstreamArgs());
    if (stale()) return;
    let comparison = null;
    if (upstream.code === 0 && upstream.stdout.trim()) comparison = { ref: "@{u}", name: upstream.stdout.trim() };
    else {
      const defaultBranch = await git(defaultBranchArgs());
      if (stale()) return;
      if (defaultBranch.code === 0 && defaultBranch.stdout.trim())
        comparison = { ref: "refs/remotes/origin/HEAD", name: defaultBranch.stdout.trim() };
    }
    let remote = null;
    if (comparison) {
      const base = await git(mergeBaseArgs(comparison.ref));
      if (stale()) return;
      const head = await git(headArgs());
      if (base.code === 0 && head.code === 0) {
        const unpushed = await git(revListArgs(`${base.stdout.trim()}..HEAD`));
        if (stale()) return;
        if (unpushed.code === 0)
          remote = { ref: comparison.ref, name: comparison.name, unpushed: new Set(lines(unpushed.stdout)) };
      }
    }
    let remoteHead = null, behind = 0;
    if (remote) {
      const name = remote.name.split("/")[0] || "origin";
      const ref = `refs/remotes/${name}/HEAD`;
      const target = await git(["symbolic-ref", "--short", ref]);
      if (stale()) return;
      if (target.code === 0 && target.stdout.trim()) {
        const base = await git(mergeBaseArgs(ref));
        const count = await git(countArgs(`HEAD..${ref}`));
        const ahead = await git(revListArgs(`${base.stdout.trim()}..HEAD`));
        if (stale()) return;
        if (base.code === 0 && count.code === 0 && ahead.code === 0)
          remoteHead = { name: `${name}/HEAD`, target: target.stdout.trim(), behind: Number(count.stdout) || 0, ahead: new Set(lines(ahead.stdout)) };
      }
      const count = await git(countArgs(`HEAD..${remote.ref}`));
      if (stale()) return;
      behind = count.code === 0 ? Number(count.stdout) || 0 : 0;
    }
    const branch = await git(branchArgs());
    const origin = await git(originUrlArgs());
    if (stale()) return;
    this.branch = branch.code === 0 ? branch.stdout.trim() : this.branch;
    this.repo = origin.code === 0 ? githubRepo(origin.stdout) : this.repo;
    this.remote = remote; this.remoteHead = remoteHead; this.behind = behind;
  }

  loadCommits(cx, more = false) {
    if (this.preview || this.commitsLoading || !this.root) return;
    if (!this.hasHead) { this.commitsDone = true; cx.notify(); return; }
    const context = this.context, token = ++this.commitsToken;
    const stale = () => token !== this.commitsToken || this.context !== context;
    const count = more ? COMMITS_PER_PAGE : Math.max(COMMITS_PER_PAGE, this.commits.length);
    const skip = more ? this.commits.length : 0;
    const git = args => exec("git", args, { cwd: this.root, on: this.on });
    this.commitsLoading = true; cx.notify();
    cx.spawn(async cx => {
      try {
        const result = await git(logArgs(count, skip));
        if (stale()) return;
        if (result.code !== 0) throw new Error(result.stderr || "Cannot read history");
        const page = parseLog(result.stdout);
        if (stale()) return;
        if (!more) await this.historyMeta(git, stale);
        if (stale()) return;
        this.commits = more ? [...this.commits, ...page] : page;
        this.commitsDone = page.length < count;
        this.commitsError = null;
      } catch (e) {
        if (token === this.commitsToken) this.commitsError = String(e);
      } finally {
        if (token === this.commitsToken) { this.commitsLoading = false; cx.notify(); }
      }
    });
  }

  openCommit(commit, cx) {
    if (this.preview) return;
    const context = this.context, token = ++this.commitToken;
    this.selectedCommit = commit; this.commitFiles = [];
    this.commitFilesError = null; this.commitFilesLoading = true;
    cx.notify();
    cx.spawn(async cx => {
      try {
        const git = args => exec("git", args, { cwd: this.root, on: this.on });
        const [numstat, names] = await Promise.all([
          git(commitFilesArgs(commit.hash, "--numstat")),
          git(commitFilesArgs(commit.hash, "--name-status")),
        ]);
        if (numstat.code !== 0 || names.code !== 0)
          throw new Error(numstat.stderr || names.stderr || "Cannot read commit");
        if (token !== this.commitToken || this.context !== context) return;
        this.commitFiles = parseCommitFiles(numstat.stdout, names.stdout);
      } catch (e) {
        if (token === this.commitToken) this.commitFilesError = String(e);
      } finally {
        if (token === this.commitToken) { this.commitFilesLoading = false; cx.notify(); }
      }
    });
  }

  toggleGroup(key, cx) {
    if (this.closed.has(key)) { this.closed.delete(key); localStorage.setItem("changes-plus.collapsed", JSON.stringify([...this.closed])); }
    else { this.closed.add(key); localStorage.setItem("changes-plus.collapsed", JSON.stringify([...this.closed])); }
    cx.notify();
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
          const args = request.commit?.hash
            ? commitDiffArgs({ hash: request.commit.hash, path: file, full: this.fullFile })
            : diffArgs({ hasHead, path: file, full: this.fullFile });
          const result = await exec("git", args, { cwd: root, on: on ?? null });
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
  pick(path, cx, scope = "changes") {
    const target = previewTarget(panes(), focused());
    if (!target?.work && !target?.preview) {
      this.error = "Select a work tab before opening a diff"; cx.notify(); return;
    }
    const file = scope === "commit"
      ? this.commitFiles.find(f => f.path === path)
      : this.files.find(f => f.path === path);
    const request = {
      root: this.root, on: this.on ?? null, file: path, revision: randomUUID(),
      fresh: scope === "commit" ? false : (file?.fresh ?? false),
      hasHead: scope === "commit" ? true : (file?.hasHead ?? true),
      binary: file?.binary ?? false, full: this.fullFile,
    };
    if (scope === "commit" && this.selectedCommit) {
      request.scope = "commit";
      request.commit = {
        hash: this.selectedCommit.hash, short: this.selectedCommit.short,
        subject: this.selectedCommit.subject,
      };
    }
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
      else if (this.tab === "commit" && !this.selectedCommit) this.loadCommits(cx);
    } else if (command === "full") this.toggleFull(cx);
    else if (command === "changes") this.setTab("changes", cx);
    else if (command === "commit" || command === "commits") this.setTab("commit", cx);
    else if (command === "more") this.loadCommits(cx, true);
    else if (command === "back" || command === "close-preview") {
      if (this.preview) this.closePreview(cx);
      else if (this.tab === "commit" && this.selectedCommit) {
        this.selectedCommit = null; this.commitFiles = []; this.commitFilesError = null;
      }
    } else if (command.startsWith("open:")) {
      const path = command.slice(5);
      if (this.tab === "commit" && this.selectedCommit && this.commitFiles.some(f => f.path === path))
        this.pick(path, cx, "commit");
      else if (this.files.some(file => file.path === path)) this.pick(path, cx);
    } else if (command.startsWith("commit:")) {
      const short = command.slice(7);
      const commit = this.commits.find(c => c.short === short || c.hash.startsWith(short));
      if (commit) this.openCommit(commit, cx);
    }
    cx.notify();
  }

  fileRow(file, t, scope = "changes") {
    const parts = file.path.split("/"), name = parts.pop(), dir = parts.length ? parts.join("/") + "/" : "";
    const color = file.status === "A" ? t.ansi2 : file.status === "D" ? t.ansi1
      : file.status === "U" ? t.ansi1 : t.blocked;
    return h_flex().id(`changes-plus-file-${file.path}`).h(SIZE.row).flex_none().px(8).gap(8)
      .items_center().rounded(7).cursor_pointer().hover(s => s.bg(t.hover))
      .when(this.open === file.path, el => el.bg(t.selected))
      .on_click((_e, cx) => this.pick(file.path, cx, scope))
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

  commitRow(commit, t) {
    return h_flex().id(`changes-plus-commit-${commit.hash}`).flex_none().px(8).py(6).gap(8)
      .items_center().rounded(7).cursor_pointer().hover(s => s.bg(t.hover))
      .on_click((_e, cx) => this.openCommit(commit, cx))
      .child(v_flex().flex_1().min_w(0).gap(1)
        .child(div().truncate().child(commit.subject))
        .child(div().truncate().text_size(11).text_color(t.dim).child(`${commit.author} · ${timeAgo(commit.at)}`)))
      .child(div().flex_none().text_size(11).text_color(t.dim)
        .font_family(terminalFonts(settings()).font_family).child(commit.short));
  }

  renderHistory(t) {
    const list = v_flex().id("changes-plus-commit-list").flex_1().min_h(0).overflow_y_scrollbar().p(6);
    if (this.commitsError) return list.child(div().p(8).text_color(t.ansi1).child(this.commitsError));
    if (!this.commits.length) return list.child(div().p(8).text_color(t.dim)
      .child(this.commitsLoading ? "Loading history…" : this.root ? "No commits yet" : "No folder"));
    const groups = groupCommits({
      commits: this.commits, remote: this.remote, remoteHead: this.remoteHead,
      behind: this.behind, branch: this.branch, done: this.commitsDone,
    });
    let drawn = 0;
    for (const group of groups) {
      const open = !this.closed.has(group.scope);
      list.child(GroupHeading({
        id: `changes-plus-group-${group.scope}`, label: group.label, count: group.count,
        detail: group.detail, color: group.scope === "branch" ? t.accent : t.muted,
        open, divided: drawn++ > 0, onClick: c => this.toggleGroup(group.scope, c),
      }));
      if (!open) continue;
      for (const commit of group.commits) list.child(this.commitRow(commit, t));
      if (group.withMore && !this.commitsDone) list.child(div().id("changes-plus-commits-more")
        .py(8).text_size(11).text_color(t.muted).cursor_pointer().hover(s => s.bg(t.hover))
        .on_click((_e, cx) => this.loadCommits(cx, true))
        .child(this.commitsLoading ? "Loading…" : "Load more"));
    }
    return list;
  }

  renderCommit(t) {
    const commit = this.selectedCommit;
    return v_flex().id("changes-plus-commit-detail").flex_1().min_h(0)
      .child(h_flex().h(42).flex_none().px(8).gap(8).items_center().border_b(1).border_color(t.border)
        .child(div().id("changes-plus-commit-back").h(26).px(8).flex_none().flex().items_center()
          .rounded(6).text_color(t.muted).cursor_pointer().hover(s => s.bg(t.hover))
          .on_click((_e, cx) => this.command("back", cx)).child("‹ Back"))
        .child(div().flex_1().min_w(0).truncate().font_semibold().child(commit.subject))
        .child(div().flex_none().text_size(11).text_color(t.dim)
          .font_family(terminalFonts(settings()).font_family).child(commit.short)))
      .child(v_flex().id("changes-plus-commit-about").flex_none().px(10).py(8).gap(3)
        .child(div().text_size(11).text_color(t.dim).child(`${commit.author} · ${new Date(commit.at * 1000).toLocaleString()}`))
        .when(Boolean(commit.body), el => el.child(div().text_size(11).text_color(t.muted).child(commit.body))))
      .child(v_flex().id("changes-plus-commit-files").flex_1().min_h(0).overflow_y_scrollbar().p(6)
        .border_t(1).border_color(t.border)
        .when(this.commitFilesLoading, el => el.child(div().p(8).text_color(t.dim).child("Loading files…")))
        .when(Boolean(this.commitFilesError), el => el.child(div().p(8).text_color(t.ansi1).child(this.commitFilesError)))
        .children(this.commitFiles.map(file => this.fileRow(file, t, "commit")))
        .when(!this.commitFiles.length && !this.commitFilesLoading, el => el.child(div().p(8)
          .text_color(t.dim).child("No file changes in this commit"))));
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
      const header = PanelHeader()
        .child(HeaderTab({ id: "changes-plus-tab-changes", label: "Changes", count: this.files.length,
          active: this.tab === "changes", onClick: c => this.setTab("changes", c) }))
        .child(HeaderTab({ id: "changes-plus-tab-commits", label: "Commits",
          count: this.remote ? this.remote.unpushed.size : undefined,
          active: this.tab === "commit", onClick: c => this.setTab("commit", c) }))
        .child(div().flex_1())
        .when(this.tab === "changes", el => el
          .child(div().text_size(11).text_color(t.ansi2).child(`+${add}`))
          .child(div().text_size(11).text_color(t.ansi1).child(`−${del}`)))
        .child(IconButton({ id: "changes-plus-refresh", icon: "refresh", label: "Refresh",
          onClick: c => this.command("refresh", c) }));
      const body = this.tab === "commit"
        ? (this.selectedCommit ? this.renderCommit(t) : this.renderHistory(t))
        : v_flex().id("changes-plus-list").flex_1().min_h(0).overflow_y_scrollbar().p(6)
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
            .child(`Showing the first ${LIMITS.files} changed files`)));
      return root.child(header).child(body)
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
