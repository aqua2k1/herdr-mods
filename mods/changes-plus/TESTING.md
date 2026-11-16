# Verification record — Changes Plus

This records what was actually run. Node mocks and `herdr-app check` do not
claim Windows/macOS GUI compatibility.

## Run on Linux (WSLg, 2026-11-16)

- `npm test` — 212 tests, 211 pass, 1 pre-existing skip (files-plus PDF helper
  timeout). New tests cover Git parsing/grouping, diff row numbering, pane
  targeting and terminal-font metrics.
- `herdr-app check mods/changes-plus` — passed (Herdr 0.1.16).
- `npm run test:changes-panes` — passed in a real, isolated Herdr window:
  - Cloned the freshly shipped `main` layout into a throw-away app home; the
    active-tab workarea and Files/Changes stack were preserved.
  - Installed the unmodified production mod plus a driver subclass in a
    **separate mod folder**. No production file was edited for the test.
  - Built a real Git repository with a modified tracked file, an untracked
    file and a conflicted merge, then verified the three Better Changes-style
    groups (Conflicts / Changed / Untracked) with their status and counts.
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
  - Screenshots and the full CLI/status snapshot are in
    `~/.cache/changes-plus-live-*/` (`01-sidebar-groups.png`,
    `02-unified-diff.png`, `02b-full-file-toggle.png`, `03-reused-untracked.png`, `04-full-file-toggle.png`,
    `05-native-zoom.png`, `06-close-keeps-sidebar.png`, `results.json`).
  - The test closed its own tab and window afterwards and left the personal
    layout and installed mods untouched.

## Not verified

- Windows / macOS GUI behaviour, including native file paths and fonts.
- Remote spaces (another Herdr machine) in a real window. The code routes
  Git and file reads through `on`, as native Changes does, but no connected
  remote was available for this run.
- Very large diffs / 1,000-file lists in a live window (only the logic limits
  are unit tested).
