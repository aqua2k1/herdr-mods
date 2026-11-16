# Changes Plus

A read-only replacement for Herdr's Changes panel. It keeps native Changes' Git
reads and limits, but arranges the files in Better Changes-style sections and
shows the diff in a native pane inside the active tab's workarea — the same
route Files Plus uses for previews. No staging, commit box or history; nothing
is written under `.git`.

```text
Herdr management | workarea: terminal + unified diff pane | Changes Plus
```

The sidebar stays in the right-hand Files/Changes stack. Clicking a file splits
(or reuses) a diff pane to the right of the focused work pane, **inside the
active tab**. Each tab has one reusable diff pane, addressed by a shared
channel with a revision; later clicks update it without a new pane. Native pane
zoom and close work as usual, and closing the diff keeps the sidebar.

## Features

- **Sections:** `Conflicts`, `Changed` and `Untracked`, built from native
  `git status` letters. Empty sections are hidden; headings collapse on click.
  Files are sorted by path inside a section. The first file is selected, as in
  native Changes, but no pane is opened until you click.
- **File rows:** file icon tinted by status (`A`, `M`, `D`, `U`), dim folder
  prefix, `+N` / `−N` counts from `git diff --numstat`, and the status letter.
- **Unified diff:** added/removed lines keep both real line numbers, with `+`
  in `ansi2`, `−` in `ansi1`, and hunk headings in `accent`. Only the changed
  hunks show by default; **Full file** (button or `f`) shows the whole file
  with the same marks. The setting is shared by every copy.
- **Fonts:** diff rows use `settings().font_family` / `font_size` — the terminal
  font settings, exactly as Files Plus does — and follow changes live. Row
  height is 1.5× the font size.
- **Remote:** Git commands and untracked-file reads run on the space's machine
  through `exec` / `readTextFile` with `on`.

## Boundaries

- Reads only: no `git add`, `git commit`, reset, conflict resolution or fetch.
- The first 1,000 changed files, 1,500 diff lines and 4,000 characters per line
  are shown, with a note when the file list is truncated. Only Git itself is
  run; no external diff driver or textconv.
- Untracked files are read with the host's bounded text API and shown as one
  all-added hunk. Binary files show a short message, not a text diff.
- The mod cannot import code from another mod: helper modules under `lib/` and
  `views/` are local copies of the relevant Files Plus / Better Changes ideas.

## Install

### With your Herdr agent

```text
Read ~/.config/herdr-app/AGENTS.md, then replace the Changes panel with this mod: https://github.com/aqua2k1/herdr-mods/tree/main/mods/changes-plus
```

### Manual installation

Copy this whole directory (not a symlink) to `<appHome>/mods/changes-plus/`, then run:

```sh
herdr-app check <appHome>/mods/changes-plus
```

Clone your current personal layout before changing anything, then change only
the Changes block's `content.mod` to `changes-plus`; keep its IDs, size, hidden
state and stack. See [layout integration](../../integrations/changes-plus/README.md).
The shipped `changes` MOD is not modified.

## Props and commands

No props: the sidebar follows the focused pane/space like native Changes.
Optional `{ "root": "/path/to/repo", "on": null }` pins the repository folder;
`on` is an existing Herdr machine name, or null for local.

Diff panes are created with `{ role: "preview", tab, channel, root, on, file,
fresh, hasHead, binary, revision }`; `file` is relative to `root`. Their source
stays fixed when focus changes. Closing one releases the shared request only if
it still matches the revision it showed.

Shown copies accept `changes-plus.refresh`, `.full`, `.back` /
`.close-preview` and `.open:<path>` (the latter reaches the sidebar for tests
and keys). `f` toggles Full file in a focused diff; `Escape` closes it. Use
Herdr's native pane header for pane zoom and close.

## Tests

```sh
npm test                        # unit tests for Git parsing, grouping, diff rows, panes
npm run test:changes-panes      # real, isolated Herdr window (Linux GPUI)
```

Native Windows GUI test (from PowerShell, real `herdr-app.exe` and Git):

```powershell
powershell.exe -NoProfile -ExecutionPolicy Bypass -File ../../scripts/test-changes-plus-windows.ps1
```

The live test clones a personal layout into a throw-away app home, installs a
test-only driver subclass next to the unmodified production mod, creates a real
Git fixture with modified, untracked and conflicted files, and checks the
sidebar groups, shared pane requests, pane reuse, full-file toggle, font
setting and screenshots. It leaves results in `~/.cache/changes-plus-live-*`
and never edits your installed mods or personal layout. It needs a display,
`herdr-app`, `hc` and Git.

See [verification record](TESTING.md) for what was actually run. Passing Node
mocks is not a claim of Windows/macOS GUI compatibility.

## Attribution

Git reads, status letters and diff numbering are derived from Herdr's native
Changes MOD (Apache-2.0); see `LICENSE-Apache-2.0.txt`. Section layout and
row metrics reference [Better Changes](https://github.com/munza/herdr-mods/tree/main/better-changes)
(no code copied). The pane-opening route and font reader follow Files Plus in
this repository.
