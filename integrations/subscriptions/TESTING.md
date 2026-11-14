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

Not yet verified in the real window: signed-out Codex error state, authenticated DeepSeek balance display, and multi-window operation.
