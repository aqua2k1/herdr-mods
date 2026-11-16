# Files Plus layout integration

Do not overwrite shipped `mods/files` or `layouts/main.json`. Copy `mods/files-plus/` into the actual Herdr application home and run `herdr-app check <installed directory>` first.

1. Find the current personal layout using `herdr-app status`.
2. If it is shipped, clone it (cloning switches to the clone):

   ```sh
   herdr-app do layout.clone '{"name":"main","as":"my-files-layout"}'
   ```

   Use the actual source layout/name; do not overwrite an existing clone.
3. In that personal layout, find the block whose `content.mod` is `files`. Change **only** its mod name to `files-plus`. Keep its block ID, size, hidden state, stack/parent and all unrelated settings. Keeping the block ID preserves workspace-chrome's Files toggle.
4. Check `herdr-app status`, open Files, try a file and inspect `herdr-app shot`.

For an existing personal layout, edit it directly only after making a backup. To revert, change that one `content.mod` back to `files`; do not reset the whole layout.

Keep this block in the original right-hand Files/Changes stack. File clicks split a preview inside the **active tab's workarea**, not another layout column. Do not replace the workarea's `{ "tab": "active" }` content.

Example sidebar block content (not a full replacement layout):

```json
{ "mod": "files-plus" }
```

Optional pinned sidebar directory:

```json
{
  "mod": "files-plus",
  "props": { "root": "/path/to/project", "on": "my-remote" }
}
```

`on` is an existing Herdr machine name. Use null for local; Windows roots use normal JSON backslash escaping. POSIX names containing backslashes are preserved.

## Remove

Close any Files Plus preview panes, then restore the original sidebar block reference before deleting the MOD directory. Closing only a preview pane does not remove or reset the Files sidebar. After no Files Plus viewers remain, temporary `layouts/files-plus-assets/` files may be removed if a crash left them. Do not delete them while a viewer/helper is active. Optional standalone helper tests may also leave `cache/files-plus/pdf/` outputs after a forced termination.
