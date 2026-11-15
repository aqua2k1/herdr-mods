# Status-bar popover integration

The status bar shows a Subscriptions icon and label, never quota or balance summaries. Clicking it opens the existing detail cards above the button, without resizing terminals or changing Files/Changes.

These are manual instructions, not changes to your personal configuration. Install `mods/subscriptions/` into your Herdr home first. Back up your layout; clone a shipped layout before editing it:

```sh
herdr-app do layout.clone '{"name":"main","as":"subscriptions-statusbar"}'
```

For an existing personal layout, edit that layout instead. Do not replace unrelated content or edit a shipped MOD.

## Layout

In your personal layout, replace the `status` block with a row holding the existing status MOD and a narrow Subscriptions block. Preserve any custom status MOD, styling and sizing you already use. Example for the shipped main layout's 28 px bar:

```json
{
  "id": "status",
  "type": "row",
  "size": { "px": 28 },
  "resizable": false,
  "children": [
    {
      "id": "status-content",
      "type": "block",
      "content": { "mod": "workspace-status" }
    },
    {
      "id": "subscriptions-statusbar",
      "type": "block",
      "size": { "px": 144 },
      "background": "chrome",
      "border": { "width": 1, "color": "border" },
      "padding": [2, 4],
      "content": { "mod": "subscriptions" }
    }
  ]
}
```

This does not need a cloned status MOD or tabs MOD. Its layout block ID is arbitrary; no `subscriptions.open` token or tabs observer is required. If migrating from the side-panel integration, remove only its Subscriptions panel child, button, enabled-list addition and open observer from your personal layout/tabs clone. Leave Files/Changes untouched.

## Behavior

- Uses native `gpui-base.Popover`, controlled through `open` / `on_open_change`, with a `bottom_right` anchor (prefer upward opening, clamped to window edges).
- Click the trigger to toggle; outside press or Escape dismisses it. Native Popover manages focus restoration.
- Detail surface is 360 × 480 logical px with an internally scrolling provider list. Verify fit in your window, particularly unusually small windows or large UI scales.
- Initial mount and redraws do not query. Each closed-to-open transition queries configured providers once; in-flight requests are deduplicated. No polling.
- Closing keeps the last result in the view's memory and clears unsaved API-key input and delete confirmation. An already-running query may finish while closed; closing does not start new queries.
- Credential save/delete behavior is unchanged. Secrets are never placed in shared state.
- The status-bar popover is the only presentation. No `presentation` prop is needed (an existing `presentation: "statusbar"` prop is harmless but unnecessary). Install just one copy; separate copies have independent caches and request lifecycles.

## Verify

```sh
herdr-app check /absolute/path/to/mods/subscriptions
npm test
```

Also test in a running Herdr window (the static check alone cannot prove popup placement or input behavior):

1. The icon and Subscriptions label appear in the status bar; startup does not query.
2. Clicking it opens full details above the button; terminal and sidebar geometry do not change.
3. Loading finishes inside the open surface, without reopening it.
4. Trigger click, outside press and Escape close it, restoring keyboard focus appropriately.
5. Reopening refreshes once; rapidly reopening during a query does not launch duplicates.
6. The list scrolls, credential controls work without closing the popover (especially 保存并查询), and unsaved key input is empty after closing/reopening.
7. Files/Changes and other status-bar controls still work.
