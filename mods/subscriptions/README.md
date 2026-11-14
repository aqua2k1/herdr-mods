# Subscriptions

Provider cards in Herdr's Files/Changes side panel. Implements **Codex subscriptions** and **DeepSeek API balance**. API balance is distinct from spending/budgets; it does not invent an expense total or usage percentage.

## Behavior

- Query each provider once when opening the panel.
- No polling, refresh button, model prompts, or session-log fallback.
- Reopening queries again; overlapping requests are deduplicated.
- Failures retain the last successful reading, explicitly labelled as old.
- Cache is per view, in memory only.
- Codex reset cards are read-only: available count, title, description, status, grant/expiry times. No redeem/use action or consume request is implemented. Missing reset-card information is hidden; count-only responses are explicitly labelled.
- Queries the **local** signed-in Codex account, regardless of the focused terminal/machine.

## Requirements

Herdr, Python 3, and an installed, signed-in Codex CLI supporting `codex app-server` and `account/rateLimits/read`. macOS/Linux only. Optional binary override: `HERDR_SUBSCRIPTIONS_CODEX_BIN`.

The helper delegates authentication to Codex, never reads credentials, sends no prompt, and terminates its app-server. Deadline: 15 seconds; Herdr exec bound: 20 seconds. No automatic retries.

## DeepSeek API configuration

Set `DEEPSEEK_API_KEY` in the environment inherited by Herdr when it starts. The Python helper sends a read-only `GET https://api.deepseek.com/user/balance` with Bearer authentication. Keys are never passed as command-line arguments, sent to the MOD UI, logged, or persisted by this MOD. No permanent proxy settings are added.

Example (enter the key without adding it to shell history, Bash):

```bash
read -rsp "DeepSeek API key: " DEEPSEEK_API_KEY; echo
export DEEPSEEK_API_KEY
herdr-app
unset DEEPSEEK_API_KEY
```

A running app must be relaunched to inherit a newly set variable. Do not paste keys in chat or commit them. A missing key produces an error in the DeepSeek card, without affecting Codex. Every open queries both providers independently; no background polling.

Displays each returned currency's total, granted, and topped-up balances and whether the balance is sufficient for API calls. Decimal strings are preserved without floating-point rounding. No reset date, subscription quota, or spending is inferred from a balance.

Official schema: https://api-docs.deepseek.com/api/get-user-balance/

## Install

Copy this directory to your Herdr home as `mods/subscriptions/` (do not symlink). A default path is `~/.config/herdr-app/mods/subscriptions/`; respect `HERDR_APP_HOME` / `XDG_CONFIG_HOME` if configured.

Follow [side-panel integration](../../integrations/subscriptions/README.md). Installing the directory alone does not add the navigation button.

Run `herdr-app check /absolute/path/to/mods/subscriptions` and `npm test` from the repository root.

For an explicit live API test, run `npm run test:live`. This launches your actual signed-in Codex CLI, validates the normalized quotas and prints display data only. It is not included in the default unit tests and sends no model prompt. A passing live query/check is not proof of the sidebar open/close behavior; that still requires a running Herdr window.

## Provider contract

Register adapters in `providers/index.js`. Each adapter has `id`, `title`, `kind` (`subscription` or `api`), `helper` (Python script relative to this MOD) and `parse(stdout, observedAt)`. Each helper runs locally through Python 3. To add another transport, extend the runner explicitly rather than hiding side effects in the renderer.

The parser returns:

```js
{
  tier: "Plus",             // optional
  observedAt: 1800000000000, // epoch milliseconds
  quotas: [{
    id: "codex:primary",
    title: "5h 额度",
    usedPercent: 62,         // optional; backend's actual percentage
    used: undefined,        // optional absolute counts
    limit: undefined,
    unit: undefined,
    resetsAt: 1800001000000, // optional epoch milliseconds
    windowSeconds: 18000    // optional
  }],
  spending: undefined,     // or { title, amount, currency, budget?, periodEnd? }
  resetCredits: null,      // or { availableCount: number|null, credits: [{ title, description, status, grantedAt, expiresAt }]|null }; timestamps in milliseconds
  accountAvailable: true,  // optional API balance sufficiency flag
  balances: []             // optional [{ currency, total, granted, toppedUp }]; amounts are decimal strings, optional amounts may be null
}
```

Unknown quota windows are displayed dynamically. Missing values are not zeroes. API budgets are not subscription limits. Do not manufacture consumption percentages from model token counts.

Visibility integration targets the layout block ID `subscriptions`. The token `subscriptions.open` is emitted by the tabs integration; it is only a UI event counter, not a credential.
