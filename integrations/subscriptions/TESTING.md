# Real-window verification

Verified locally on 2026-11-14 with the installed Herdr app and signed-in Codex CLI.

## Setup

- Started Herdr from the terminal.
- Cloned `main` to `subscriptions-test` and `tabs` to `subscriptions-tabs`; originals were not edited.
- Installed `mods/subscriptions` into the user's Herdr MOD directory.
- Passed HTTP(S) proxy variables to the test Herdr process only. No proxy was added to source, Herdr settings, or shell configuration.
- Drove layout visibility through `herdr-app do`; no desktop pointer/key automation.

## Results

- Live Codex query and parsing succeeded (Plus, two quota windows).
- Inspected `herdr-app shot` output: title, plan, percentages, progress bars, reset timestamps, and observation time render correctly.
- Temporary installed-only request tracing: baseline 1; close/reopen 2; Files/Subscriptions switch 3; after 12 seconds idle still 3.
- `herdr-app status` reported no errors during verification.
- 12 unit/helper tests and `herdr-app check` passed.
- Screenshots: `/tmp/herdr-subscriptions-proxy-test.png` and `/tmp/herdr-subscriptions-verified.png` (local temporary artifacts, not repository assets).

The first real-window run exposed a render-phase `cx.notify()` error missed by the static check. Fixed by moving query dispatch into initialization / `nextCommand()` events; `render()` is now side-effect-free. Integration emits `subscriptions.open` on each open transition.

Temporary request tracing was removed from the installed MOD. The final screenshot/status attempt found the window no longer running; the screenshots and runtime checks above were captured before that. No claim is made that the test app remains open.

## Read-only reset cards

Re-tested in a real Herdr window after adding reset-card display. Screenshot inspected: `/tmp/herdr-subscriptions-reset-cards.png`. The existing read request returned one available card, with title, description, status, grant time and expiry, all rendered inside the Codex block. No consume endpoint or action was added or invoked. `herdr-app status` reported no errors; 16 tests and the MOD check passed. Proxy environment variables were again supplied only to the test app process.

## DeepSeek API balance

Added the fixed HTTPS GET `/user/balance` transport and decimal-string balance model using the official response schema. `npm test` passes 22 top-level tests, including a Python helper suite with 5 cases (missing key, Bearer GET/whitelisted output, sanitized 401 error, timeout, malformed response). MOD check passes.

Installed the updated MOD and inspected `/tmp/herdr-subscriptions-deepseek-test.png`: the independent DeepSeek API block correctly shows a missing-key error, while Codex continues loading successfully. Runtime status reported no errors. This environment has no `DEEPSEEK_API_KEY`, so **no authenticated live DeepSeek balance result has been verified**. HTTP success/error responses are tested with mocks; no real key is embedded in source/tests. Proxy settings were only passed to the test app process.

## Reusable credential management

- `npm test`: 27 top-level tests pass, including Python suites with 7 credential-store and 6 DeepSeek-helper cases. Checks cover file/directory permissions, replacement, environment fallback, traversal/symlinks, invalid drafts preserving the old value, abandoned draft cleanup, and sanitized errors.
- `herdr-app check` passes for the updated MOD.
- Installed the updated source and inspected the actual masked-input screen in `/tmp/herdr-credentials-input.png`.
- Exercised the shared UI and storage transport in a temporary smoke MOD using a dedicated `credential-smoke-test` identifier and fake keys only. Verified masked presentation, save, replacement and deletion with native Herdr file writes, file mode `0600`, directory mode `0700`, and zero remaining smoke drafts. No API was called with a fake key. Temporary smoke MOD/layout block and test credential were removed afterwards.
- Smoke screenshots: `/tmp/herdr-credential-masked-smoke.png`, `/tmp/herdr-credential-saved-smoke.png`, `/tmp/herdr-credential-delete-confirm.png`.
- Inspected `/tmp/herdr-credentials-final.png`: the actual DeepSeek card now successfully displays authenticated live balance data and a local-file credential source, with change/delete controls. No saved DeepSeek secret was read back for inspection. Runtime status reported no errors.
- Proxy variables remained limited to the test app process.

Not yet verified in the real window: signed-out Codex error state and multi-window operation.

## Windows credential compatibility

- Added interpreter discovery (`python3`, `python`, `py -3`), shared by credential and provider helpers. Discovery is cached; failed helper operations are not retried.
- Added native Windows owner/DACL validation and protected draft ACLs; reads validate the actual file handle and reject reparse points. POSIX checks are unchanged.
- Linux `npm test` passes 32 top-level tests, including interpreter fallback and mocked Windows-backend routing/cleanup. The credential suite has 11 cases; two native Windows cases are skipped on Linux. `herdr-app check` also passes for the modified MOD.
- Added `.github/workflows/credentials.yml` to run the focused credential/interpreter tests on Linux, macOS and Windows. Windows-only tests exercise broad-ACL rejection and directory-junction rejection using fake secrets.
- Native Windows execution and Windows Herdr UI have **not** been verified locally. CI results must be checked before treating the native ACL path as validated.

### Follow-up from native Windows error reports

The first Windows report exposed an initial-status failure for an already-existing `data/subscriptions` directory with inherited ACLs. Status now migrates owned inherited directory ACLs to protected user/System ACLs before validating them. Already-protected broad grants are still rejected. A Windows-only regression starts with inherited directories and checks status, save and read.

Codex now initializes Winsock before Windows process creation and uses bounded threaded pipe reads instead of POSIX selectors. Tests launch a `.py` fake explicitly through Python, avoiding shebang/WinError 193 failures. Standard Windows npm shims are resolved to Node and `codex.js` without invoking a shell; nonstandard batch wrappers are rejected. Python helper invocations use `-X utf8`, and the Codex helper explicitly configures UTF-8 streams.

After these fixes, Linux `npm test` passes **37 top-level tests**, including the real 15-second timeout/cleanup test; `herdr-app check` passes. The credential suite has 12 cases, with three Windows-native cases skipped on Linux. CI now runs all subscription tests across the three OSes, not just credential tests. Native Windows execution of these follow-up fixes is still pending.

## Status-bar popover: real-window smoke test

- Started a real Herdr window under an isolated `HERDR_APP_HOME` (`/tmp/herdr-popover-live.NCcWiY`) using a copy of the main layout with the status-bar integration. Personal layout/configuration was not edited.
- The initial real-window run exposed that layout props arrive through `herdr.props()`, while the View's `init` argument was `undefined`. Fixed presentation selection to read `props()` and updated lifecycle regression tests accordingly. Before this fix, sidebar content was clipped into the status-bar block despite the static check passing.
- Inspected screenshots showing the icon-only trigger, full Codex quota/reset-card details above it, unchanged underlying terminal bounds, and the internally scrolled DeepSeek credential section. A real authenticated Codex query succeeded. No real DeepSeek key was saved or balance request validated.
- Temporary test-copy logs showed no query at mount, one query during rapid open/close/reopen while loading, and no additional query over a five-second idle period. Instrumentation was removed from the test copy afterward; it was never added to repository code.
- Final `npm test`: 58 tests passed; `herdr-app check` and `git diff --check` passed.
- User follow-up confirmed a successful DeepSeek query but reported that 保存并查询 closed the popover. Native Popover toggles on a bubbling mouse-down; the detail content now stops left mouse-down propagation so its controls cannot toggle the trigger. Added regression coverage for content event isolation and credential save/query retaining the open state. Manual confirmation of this fix is pending.
- The trigger now shows its icon plus a Subscriptions label; the integration block width is 144 logical px. Updated the isolated test layout and MOD for user retesting, without changing stored credentials.
- Keyboard automation was inconclusive: do not treat Escape/focus restoration as verified. The user will perform the remaining interaction checks (trigger/outside/Escape dismissal, focus restoration, credential input clearing and Files/Changes compatibility).
- Temporary screenshot artifacts, not repository assets: `fixed-open.png`, `scrolled.png`, `toggle-closed.png` and `outside-closed.png` in the isolated test directory. Herdr status also reported an unrelated unavailable remote-machine/core connection; no subscription MOD error was reported.
