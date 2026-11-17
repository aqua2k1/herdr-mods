# Verification record — Changes Plus

This records what was actually run. Node mocks and `herdr-app check` do not
claim Windows/macOS GUI compatibility.

## Run on Linux (WSLg, 2026-11-16)

- `npm test` — 219 tests, 218 pass, 1 pre-existing skip (files-plus PDF helper
  timeout). Tests cover Git parsing/grouping, diff row numbering, pane
  targeting, terminal-font metrics and commit log/file/group parsing.
- `herdr-app check mods/changes-plus` — passed (Herdr 0.1.16).
- `npm run test:changes-panes` — passed in a real, isolated Herdr window:
  - Cloned the freshly shipped `main` layout into a throw-away app home; the
    active-tab workarea and Files/Changes stack were preserved.
  - Installed the unmodified production mod plus a driver subclass in a
    **separate mod folder**. No production file was edited for the test.
  - Built a real Git repository with a modified tracked file, an untracked
    file, a conflicted merge and a local bare remote with the base pushed,
    then verified the three Better Changes-style groups (Conflicts / Changed /
    Untracked) with their status and counts.
  - `changes-plus.open:modified` produced a real `pane.split` to the right of
    the work pane inside the dedicated tab. Unified rows carried hunk headers
    and old/new line numbers; terminal font size 20 was read from settings.
  - Opening the untracked file reused that same pane and updated the shared
    request/revision. Its all-added hunk showed the file's text.
  - `changes-plus.full` toggled the shared Full-file preference and reloaded
    the diff: on a 25-line file the short hunk grew to the whole file, with
    the changed line still marked in `ansi1`/`ansi2`. Native `pane.zoom`
    toggled, and `pane.close` removed only the diff pane while the sidebar
    kept its groups.
  - The Commits tab read the real history and split it into the local unpushed
    and `origin/main` groups; opening the `ours` commit listed its changed file
    and a click reused the unified diff pane with `git show <hash> -- <path>`.
  - Screenshots and the full CLI/status snapshot are in
    `~/.cache/changes-plus-live-*/` (`01-sidebar-groups.png`,
    `02-unified-diff.png`, `02b-full-file-toggle.png`, `03-reused-untracked.png`, `04-full-file-toggle.png`,
    `05-native-zoom.png`, `06-close-keeps-sidebar.png`, `07-commits-tabs.png`,
    `08-commit-files.png`, `09-commit-unified-diff.png`, `results.json`).
  - The test closed its own tab and window afterwards and left the personal
    layout and installed mods untouched.

## Run on native Windows (2026-11-17)

- `herdr-app.exe check mods/changes-plus` — passed on Herdr 0.1.16.
- `powershell.exe -ExecutionPolicy Bypass -File scripts/test-changes-plus-windows.ps1`
  — passed in a real, isolated native Windows window:
  - A real Windows Git repository with a modified file, an untracked file and
    a conflicted merge produced the three expected sections with status letters
    and `+N/−N` counts.
  - Clicking a file created a native right-split diff pane inside the dedicated
    tab; the unified view showed hunk headers, both line-number columns and
    added/removed tint at the terminal's 20px font.
  - Full file replaced the short hunks with the whole file, same-tab reuse kept
    one pane while updating the shared request, and native pane close left the
    sidebar intact.
  - With a local bare remote, the Commits tab showed real `main` / `origin/main`
    groups, a commit's author, date and changed files, and its file diff in the
    reused unified pane.
  - A space on the connected `wsl-arch` machine with a POSIX folder was routed
    to that machine. Before the fix, Windows ran Git locally with the POSIX cwd
    and failed with `os error 267` ("directory name invalid"); the test now
    asserts `on === "wsl-arch"` and no error.
  - The test found a real bug: switching context while a Git read was in flight
    left `busy` set and blocked later refreshes. Fixed in `main.js` and the
    Windows test then passed end to end.
  - Screenshots and snapshots are in `%TEMP%\changes-plus-win-*\`. No personal
    layout or installed mod was touched by the test; it cleans up its own tab,
    window and app home.

## Not verified

- macOS GUI behaviour.
- Remote spaces (another Herdr machine) in a real window. The code routes
  Git and file reads through `on`, as native Changes does, but no connected
  remote was available for this run.
- Very large diffs / 1,000-file lists in a live window (only the logic limits
  are unit tested).
