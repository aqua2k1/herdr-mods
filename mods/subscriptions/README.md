# Subscriptions

Provider cards in Herdr's Files/Changes side panel, or a detail popover opened from a status-bar icon. Implements **Codex subscriptions** and **DeepSeek API balance**. API balance is distinct from spending/budgets; it does not invent an expense total or usage percentage.

## Behavior

- Query each provider once when opening the panel or status-bar popover. The status bar itself shows an icon and Subscriptions label, not a usage summary.
- No polling, refresh button, model prompts, or session-log fallback. Saving/changing a credential explicitly queries that provider; deleting a local credential queries only if an environment fallback is configured.
- Reopening queries again; overlapping requests are deduplicated.
- Failures retain the last successful reading, explicitly labelled as old.
- Cache is per view, in memory only.
- Codex reset cards are read-only: available count, title, description, status, grant/expiry times. No redeem/use action or consume request is implemented. Missing reset-card information is hidden; count-only responses are explicitly labelled.
- Queries the **local** signed-in Codex account, regardless of the focused terminal/machine.

## Requirements

Herdr and Python 3.9+ are required. Python is discovered through `python3`, `python`, then Windows' `py -3` launcher; helper output is forced to UTF-8 with `-X utf8` rather than relying on the Windows console code page; install Python and add it to PATH before starting Herdr. DeepSeek credential management supports macOS, Linux, and Windows (a filesystem supporting Windows ACLs, such as NTFS, is required).

The Codex card additionally requires an installed, signed-in Codex CLI supporting `codex app-server` and `account/rateLimits/read`. The helper uses portable threaded pipe reads on macOS/Linux/Windows and initializes Winsock before spawning on Windows. Windows supports native executables and the standard npm `codex.cmd` layout (launched through Node directly, without a shell). Nonstandard batch shims are rejected. Optional binary override: `HERDR_SUBSCRIPTIONS_CODEX_BIN`; an explicit `.py` wrapper is launched through the same Python interpreter. Native Windows validation is still required.

The helper delegates authentication to Codex, never reads credentials, sends no prompt, and terminates its app-server. Deadline: 15 seconds; Herdr exec bound: 20 seconds. No automatic retries.

## DeepSeek API configuration

Enter the API Key in the DeepSeek card's masked input and click **保存并查询**. Once configured, the card offers **更换** and **删除** (with confirmation). No restart is required. Existing saved keys are never read back into the input.

The shared credential store uses `<appHome>/data/subscriptions/credentials/<credential-id>.key` (for DeepSeek: `deepseek-api.key`). On macOS/Linux its directory has mode `0700`, and each credential file has mode `0600`. On Windows, protected ACLs grant access only to the current user and LocalSystem. Existing owned directories with inherited ACLs are first migrated to protected ACLs, including during the initial status check when no key exists. Already-protected broad ACLs, null DACLs, foreign owners, unsafe credential files and reparse-point redirection are rejected. Filesystems that cannot enforce these ACLs fail closed. This is **plaintext storage protected by OS permissions, not encryption**; it does not protect against administrators or other programs running as your user. Do not copy the credential directory into the repository or share it in backups unintentionally.

`helpers/credentials.py` owns metadata checks, secure draft creation, validation, atomic replacement and deletion; `helpers/windows_credentials.py` implements native Windows ACL and handle checks with the Python standard library (no extra packages). `lib/credentials.js` supplies the generic transport and operation state; `lib/credential-panel.js` supplies the reusable masked-input UI. Herdr's exec API has no stdin parameter, so secrets are written only into a helper-created private draft, then committed atomically; they never appear in process arguments. Failed saves discard their draft, deletion removes abandoned drafts for that credential, and drafts older than 24 hours are cleaned on the next status/save operation. A process crash can leave a private draft until then. Delete unlinks files; it is not secure disk erasure.

The balance helper reads credentials internally and sends a read-only `GET https://api.deepseek.com/user/balance`. It returns only balance data, never the key. Keys are not kept in shared state/localStorage or logs. The input is cleared on save/cancel and view teardown. No permanent proxy settings are added.

For compatibility, `DEEPSEEK_API_KEY` in Herdr's startup environment is an optional fallback. A local file takes precedence. The UI labels the credential source; deleting the local file does not delete the environment variable.

Example (enter the key without adding it to shell history, Bash):

```bash
read -rsp "DeepSeek API key: " DEEPSEEK_API_KEY; echo
export DEEPSEEK_API_KEY
herdr-app
unset DEEPSEEK_API_KEY
```

Only the optional environment-variable method requires relaunching to inherit a new variable. Do not paste keys in chat or commit them. Without any credential, the DeepSeek card shows the input rather than issuing an unauthenticated request; Codex remains independent. Every open queries configured providers independently; no background polling.

Displays each returned currency's total, granted, and topped-up balances and whether the balance is sufficient for API calls. Decimal strings are preserved without floating-point rounding. No reset date, subscription quota, or spending is inferred from a balance.

Official schema: https://api-docs.deepseek.com/api/get-user-balance/

## Install

### With your Herdr agent

```text
Read ~/.config/herdr-app/AGENTS.md, then add this mod alongside Files and Changes: https://github.com/aqua2k1/herdr-mods/tree/main/mods/subscriptions
```

### Manual installation

Copy this directory to your Herdr home as `mods/subscriptions/` (do not symlink). A default path is `~/.config/herdr-app/mods/subscriptions/`; respect `HERDR_APP_HOME` / `XDG_CONFIG_HOME` if configured.

Choose [status-bar popover integration](../../integrations/subscriptions/STATUSBAR.md) (icon and label open floating details without changing layout geometry) or [side-panel integration](../../integrations/subscriptions/README.md). Installing the directory alone does not add either button. Status-bar mode uses layout props `{ "presentation": "statusbar" }`; omitting this preserves sidebar mode.

Run `herdr-app check /absolute/path/to/mods/subscriptions` and `npm test` from the repository root.

For an explicit live API test, run `npm run test:live`. This launches your actual signed-in Codex CLI, validates the normalized quotas and prints display data only. It is not included in the default unit tests and sends no model prompt. A passing live query/check is not proof of the sidebar open/close behavior; that still requires a running Herdr window.

## Icons

Codex and DeepSeek icons are bundled from [LobeHub Icons](https://github.com/lobehub/lobe-icons) under MIT. See [icon attribution and license](icons/README.md).

## Provider contract

Register adapters in `providers/index.js`. Each adapter has `id`, `title`, `kind` (`subscription` or `api`), `helper` (Python script relative to this MOD) and `parse(stdout, observedAt)`. Each helper runs locally through Python 3. An optional `icon: { path: "icons/provider.svg", tint: true }` adds a locally bundled icon before the title; `tint: true` follows the theme foreground, while `false` preserves a color icon. Providers without an icon still render normally. To add another transport, extend the runner explicitly rather than hiding side effects in the renderer.

Providers that need an API credential additionally declare:

```js
credential: {
  id: "deepseek-api",          // stable store identifier, lowercase letters/digits/hyphens
  label: "API Key",
  env: "DEEPSEEK_API_KEY"      // optional compatibility fallback
}
```

The panel handles credential UI, source checks and lifecycle generically. Credential-enabled Python helpers receive `--app-home <path>`; use `read_credential(home, id, env_name)` from `helpers/credentials.py`, never retrieve the existing secret through the JavaScript layer. Replacing a credential invalidates the previous account's cached result immediately. Query failures after saving keep the credential available for correction/deletion.

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

In sidebar mode, visibility integration targets the layout block ID `subscriptions`. The token `subscriptions.open` is emitted by the tabs integration; it is only a UI event counter, not a credential. Status-bar mode instead tracks native Popover open transitions locally and does not depend on the layout block ID or tabs events.
