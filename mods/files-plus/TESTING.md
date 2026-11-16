# Files Plus — verification record

## Native Windows image regression — verified

`test-files-plus-windows.ps1` passed on **native Windows Herdr 0.1.16** (not only WSL PowerShell): PNG display with Unicode/apostrophe filename, 100%, zoom-in, JPEG, exact 5 MiB PNG, source/cache SHA-256 equality, screenshot color checks and fixture/staging cleanup. It creates and closes only its own isolated window/home; unrelated restored panes are excluded from fixture cleanup assertions by checksum. Artifacts: `$env:TEMP/files-plus-win-b643580f-c84e-46e2-82d5-5998581065a5/results.json` and `01-png-fit.png` through `05-png-5MiB.png`.

A native minimal reproduction showed binary `fs.writeFile(Uint8Array)` resolving successfully but producing a zero-byte file, while text writes worked. Platform compatibility now lives in `lib/cache-writer.js`: bounded text staging plus atomic PowerShell/.NET publication on Windows; direct writes elsewhere. Large Base64 encoding/decoding yields between blocks after the native Windows VM budget interrupted a 1 MiB synchronous decode. Tests cover this cooperative path and exact byte preservation. No host source or personal Windows configuration was changed.

PDF now shares the image modifier-wheel zoom factor and ordinary wheel remains native scrolling (event-handler regression tests). This is not a claim of native Windows PDF or physical wheel-device testing.

## Continuous PDF and refresh icon update

Real renderer test passed 15 cases at `~/.cache/files-plus-live-J00Zv7/results.json`, including a screenshot/pixel check of **both adjacent PDF pages visible in one continuous view** (`10b-pdf-continuous-two-pages.png`). Native vertical virtualization uses the true mixed page dimensions and stable placeholders; visible pages plus one neighbor on each side are rendered serially, with out-of-range/old-scale resources evicted. The refresh control now uses a round-arrow SVG, not a font-dependent Unicode glyph. The running workspace test window was also updated and visually checked (`~/.cache/files-plus-panes-live-mtz1cJ/09-continuous-pdf.png`).

Real PDF helper tests additionally cover metadata-only inspection, CropBox/rotation, bounded page count/JSON and leases. Scheduling tests cover rapid range/scale changes, serial work, errors without retry loops, and late results after close. App UI zoom is accounted for when measuring Fit width. Original previous/next arrows and the page counter are retained, without a numeric page-entry field; arrows scroll within the continuous document. Layout's measurement/visible-range callbacks are coalesced to avoid an idle notify/redraw loop (regression tested). The current window screenshot is `~/.cache/files-plus-panes-live-mtz1cJ/10-continuous-pdf-arrows.png`.

## Current sidebar → workarea pane workflow

`npm run test:files-panes -- --keep` passed on real Linux/WSLg Herdr 0.1.16. It uses the shipped native three-column layout and a dedicated test tab, not a standalone file-viewer block:

- Herdr management bar, active-tab terminal/workarea, and right Files/Changes sidebar remain in place.
- Native SVG file/folder/chevron icons and two-level `src/nested/example.ts` hierarchy/indentation are displayed and screenshot-checked.
- Opening a file runs the production `openFile` handler and a real `pane.split` to the right of the work pane.
- Opening another file reuses the same preview pane ID; sidebar stays a tree and keeps expanded folders.
- Native `pane.zoom`, preview close without closing Files, and reopen beside the original terminal passed. Duplicate internal Zoom/close buttons were subsequently removed; the running test window was hot-updated and `08-native-pane-controls-only.png` was visually checked.
- Settings specify Fira Code and font_size 20; the real terminal and code preview were visually compared. The test home's UI zoom is 1.2 (host reports effective terminal size 24); no hardcoded 12px remains.
- Font-setting changes, per-tab routing, rapid-click split suppression and preview-focus cwd preservation also have regression tests.

Latest workspace artifacts:

```text
~/.cache/files-plus-panes-live-mtz1cJ/results.json
~/.cache/files-plus-panes-live-mtz1cJ/01b-native-icons-indentation.png
~/.cache/files-plus-panes-live-mtz1cJ/02-image-workarea-tree.png
~/.cache/files-plus-panes-live-mtz1cJ/04-native-workarea-zoom.png
~/.cache/files-plus-panes-live-mtz1cJ/06-reopen-code-font20.png
~/.cache/files-plus-panes-live-mtz1cJ/08-native-pane-controls-only.png
```

`--keep` intentionally leaves its named test tab/window open for manual testing. Without this flag, the script closes only its own test tab/window. The script generates its own image/code/nested-folder fixtures; `--fixtures DIR` can use existing fixtures instead. Click-handler injection is only in a separate test driver MOD inheriting an unmodified nested production copy; production panes and the pane model are real. This does not claim pointer/keyboard automation or Windows/macOS GUI verification.

## Renderer and media verification

Environment: Linux under WSLg, real GPUI desktop window, installed `herdr-app 0.1.16` (earlier exploratory run used 0.1.15). No host source changes, dependency installation, personal layout edits or remote core restarts were performed.

### Automated tests

`npm test`: **195 tests — 194 passed, 0 failed, 1 skipped**. The skipped test is the opt-in live `hc` remote 5 MiB round trip, not a successful remote verification.

Coverage includes:

- Real Linux directory enumeration: Unicode/hostile names, hidden files, links and 500+1 limiting; mocked Windows directory semantics.
- Real POSIX and **real Windows PowerShell via WSL** helper execution, exact 5 MiB boundary, oversize rejection, bounded chunks, file-change/version checks and literal path handling.
- Cross-machine routing / missing-`sh` fallback, cancellation, Base64 validation and PNG/JPEG headers; no image pixel-count cap.
- Markdown source shielding, links intercepted for all schemes, fenced code, hostile HTML/reference/inline image cases.
- Panel request races, same-file reopen, directory result ordering, context cleanup, Editor release and remote-PDF local-cache routing (the last item is mocked).
- Real PDFium rendering of two pages, damaged/encrypted documents, dependency errors, output/pixel budgets, path restrictions, watched-asset output and lease revocation during publish.
- Resource files/leases removed on close and idempotent late cleanup.

`herdr-app check mods/files-plus`: passed. A check alone does not exercise deferred native elements or asynchronous loading; the following live tests do.

### Real window tests

Command:

```sh
npm run test:files-live -- --stress
```

The original stress run passed **15 cases** below. After separating sidebar and preview roles, the standalone renderer harness was rerun successfully (**14 cases**, without the optional stress loop), with artifacts at `~/.cache/files-plus-live-ciCqu3/`. This harness tests renderers; the workspace script above tests the actual sidebar/pane workflow.

1. Lazy file tree displayed.
2. PNG Fit displayed.
3. PNG 100% displayed.
4. PNG 125% displayed.
5. JPEG displayed.
6. Exact **5 MiB PNG** traversed the actual MOD/exec/cache/GPUI path and displayed.
7. Native Markdown displayed.
8. Markdown source toggle displayed.
9. Embedded local HTTP probe received **zero requests** from inline/reference/HTML images.
10. Native code editor displayed with syntax highlighting and line numbers.
11. Real PDF page 1 displayed, with rendered red text/rectangle verified in screenshot pixels.
12. Page-next command displayed page 2, with its blue content verified in screenshot pixels.
13. Corrupt-image header produced an error view.
14. Twelve image switches completed; Linux RSS samples were 326,560 / 316,312 / 310,756 / 310,944 / 308,364 / 308,268 / 308,296 / 302,424 / 308,676 / 308,936 / 308,784 / 308,920 KiB. This is **not** a GPU-memory measurement or a proof of leak freedom.
15. Back-to-tree removed cached media files.

Screenshots were visually inspected for the file tree, Fit/125% image, code, Markdown and PDF. Image/PDF screenshot pixel checks additionally ensure the view was not merely a blank successful render. Zoom/source/page controls in this run were driven through the same MOD command handlers as toolbar controls; mouse-wheel/drag and keyboard focus still need hands-on platform checks.

Local artifacts from the final run:

```text
~/.cache/files-plus-live-0huUK6/results.json
~/.cache/files-plus-live-0huUK6/02-image-fit.png
~/.cache/files-plus-live-0huUK6/05b-local-5MiB-image.png
~/.cache/files-plus-live-0huUK6/06-markdown.png
~/.cache/files-plus-live-0huUK6/08-code.png
~/.cache/files-plus-live-0huUK6/09-pdf-page-1.png
~/.cache/files-plus-live-0huUK6/10-pdf-page-2.png
```

Artifacts are local, not committed. The test home may show an unrelated `layout pc-4080-sbw: doc.get: lost the line...` error from the pre-existing remote connection; it is retained in `results.json`, not hidden or counted as a MOD error.

## Remote status — blocked, not accepted as verified

An early real `hc` test successfully read a small PNG. A full-size single-response experiment exposed the outer Base64 envelope problem. The implementation now uses ≤1 MiB chunks and version checks, rather than assuming a 5 MiB Base64 response fits every transport wrapper.

Subsequent full-size remote verification was blocked: `hc exec --json --on pc-4080-sbw` returned `lost the line ... during the call`, including for a tiny Python temporary-directory command. SSH probes also timed out. No machine configuration, login, daemon restart/update or user session was changed. Known temporary remote fixtures were cleaned by the helper test agent; failure to establish a new remote live run is not recorded as success.

Re-run once the existing machine connection is healthy:

```sh
npm run test:files-live -- --remote pc-4080-sbw
FILES_PLUS_REMOTE=pc-4080-sbw node --test mods/files-plus/test/file-source.test.js
```

The first command additionally verifies a real 5 MiB remote image in GPUI and a remote PDF downloaded/rendered locally. The second verifies byte checksum/transport and cleans its fixtures.

## Not yet verified / not implemented

- Windows PNG/JPEG GUI is verified above. The full native Windows workspace routing, Markdown/PDF and physical wheel-device workflows remain pending; macOS GUI is untested.
- Remote Windows GUI workflow, cross-OS connected-machine matrix and remote PDF end-to-end: pending.
- Embedded Markdown images, safe link opening, extra image formats, very large media/range streaming, PDF text search/selection and OS sandboxing: not implemented.
- Full native image decode-error callback: unavailable in the exposed host API; header checks catch obvious corruption, but deeper decode failures may only appear in the host log.
- Cleanup after a hard crash/kill and native asset invalidation when the host's file watcher is unavailable: not guaranteed. The watched-asset path was chosen from the host's actual invalidation implementation; direct native cache eviction is not publicly exposed.
