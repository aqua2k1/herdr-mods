# Side-panel integration

For an icon-and-label status-bar button that opens floating details without resizing the layout, use [status-bar popover integration](STATUSBAR.md) instead.

These changes are **manual instructions**, not applied to your personal Herdr configuration. Back up your layout and clone the shipped tabs MOD with `mod.clone` before editing it (consult `herdr-app commands` for your version's arguments). Point the layout's tabs block to your clone.

## 1. Layout

In your active layout's `panel-body` stack, append this child alongside `files` and `changes`:

```json
{
  "id": "subscriptions",
  "type": "block",
  "content": { "mod": "subscriptions" }
}
```

Keep `panel` and `panel-body` IDs unchanged.

## 2. Tabs button

In the cloned tabs `main.js`, add `setShared` to the imports from `herdr`.

After the existing Files and Changes buttons, add a button using the existing `panelButton` builder:

```js
.child(panelButton("subscriptions", "Subscriptions", "mods/subscriptions/icon.svg"))
```

Unlike Files/Changes, this button is intentionally not gated by the built-in `workspace.panels` preference.

The tabs MOD remembers panels per space. Extend its local enabled list (do not overwrite global preferences):

```js
const enabled = [...new Set([
  ...(shared("workspace.panels") ?? ["files", "changes"]),
  "subscriptions"
])];
```

## 3. Emit exactly one event per open

In the tabs `render()`, **after** `this.syncPanel(space, panel, body, enabled)`, insert:

```js
// Ignore a transient old layout while syncPanel restores another space's panel.
if (!this.pending) {
  const subscriptionsOpen = Boolean(panel && !panel.hidden &&
    body?.active === "subscriptions");
  if (subscriptionsOpen && !this.subscriptionsOpen) {
    setShared("subscriptions.open", (shared("subscriptions.open") ?? 0) + 1);
    run("subscriptions.open");
  }
  this.subscriptionsOpen = subscriptionsOpen;
}
```

Do not emit in both the button handler and render: that would cause duplicate requests. Keeping the observer in the always-visible tabs MOD lets it see panel closes even when the subscriptions MOD is not rendering. Layout reads and shared state are reactive; no timer is required.

The MOD receives `open` through `nextCommand()` and starts work outside the render phase; its initial mount checks visibility once as well. Never start requests or call `cx.notify()` from `render()`.

The subscriptions MOD also checks layout visibility before executing any query. Opening a panel already being queried does not start a duplicate process. Changes of focus, theme, and ordinary redraws do not query.

## 4. Verify

Run `herdr-app check` on both MOD directories after editing. Check manually:

1. Files/Changes still work.
2. Open Subscriptions: one Codex request.
3. Leave it open: no further requests.
4. Switch away and back, or close and reopen: one new request.
5. Missing CLI / signed-out account: visible error, not a fake 0%.
6. Open repeatedly while a query is running: no overlapping duplicate.
