# Changes Plus layout integration

Do not overwrite shipped `mods/changes` or `layouts/main.json`. Copy
`mods/changes-plus/` into the actual Herdr application home and run
`herdr-app check <installed directory>` first.

1. Find the current personal layout using `herdr-app status`.
2. If it is shipped, clone it (cloning switches to the clone):

   ```sh
   herdr-app do layout.clone '{"name":"main","as":"my-changes-layout"}'
   ```

   Use the actual source layout/name; do not overwrite an existing clone.
3. In that personal layout, find the block whose `content.mod` is `changes`.
   Change **only** its mod name to `changes-plus`. Keep its block ID, size,
   hidden state, stack/parent and all unrelated settings. Keeping the block ID
   preserves workspace-chrome's Changes toggle.
4. Check `herdr-app status`, open Changes, click a file and inspect
   `herdr-app shot`.

For an existing personal layout, edit it directly only after making a backup.
To revert, change that one `content.mod` back to `changes`; do not reset the
whole layout.

Keep the block in the original right-hand Files/Changes stack. A click splits
a diff pane inside the **active tab's workarea**, not another layout column.
Do not replace the workarea's `{ "tab": "active" }` content.

Example sidebar block content (not a full replacement layout):

```json
{ "mod": "changes-plus" }
```

Optional pinned repository folder:

```json
{
  "mod": "changes-plus",
  "props": { "root": "/path/to/repo", "on": "my-remote" }
}
```

`on` is an existing Herdr machine name. Use null for local; Windows roots use
normal JSON backslash escaping. POSIX names containing backslashes are
preserved.

## Remove

Close any Changes Plus diff panes, then restore the original sidebar block
reference before deleting the MOD directory. Closing only a diff pane does not
remove or reset the Changes sidebar.
