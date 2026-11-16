# Herdr MODs

Independent, self-contained MODs in `mods/<name>/`.

- [Files Plus](mods/files-plus/README.md): native Files enhancement with code/Markdown, zoomable PNG/JPEG and optional PDF preview; bounded remote media, no Git badges. See the [verification record](mods/files-plus/TESTING.md) for platform coverage.
- [Changes Plus](mods/changes-plus/README.md): read-only Changes replacement with Better Changes-style sections and a unified diff in a reusable pane inside the active tab's workarea. See the [verification record](mods/changes-plus/TESTING.md).
- [Subscriptions](mods/subscriptions/README.md): provider cards; Codex subscription quotas/reset cards and DeepSeek API balance, queried only when opened.
- [Desktop notifications](mods/desktop-notifications/README.md): forwards existing toasts to the OS while Herdr is inactive, without changing the host.

## Install

### Files Plus

```text
Read ~/.config/herdr-app/AGENTS.md, then replace the Files panel with this mod: https://github.com/aqua2k1/herdr-mods/tree/main/mods/files-plus
```

See [manual installation and layout integration](integrations/files-plus/README.md) and [optional PDF dependencies](mods/files-plus/README.md#optional-pdf-dependencies).

### Changes Plus

```text
Read ~/.config/herdr-app/AGENTS.md, then replace the Changes panel with this mod: https://github.com/aqua2k1/herdr-mods/tree/main/mods/changes-plus
```

See [manual installation and layout integration](integrations/changes-plus/README.md).

### Subscriptions

```text
Read ~/.config/herdr-app/AGENTS.md, then add this mod as a status-bar button opening floating details (no Files/Changes side-panel entry): https://github.com/aqua2k1/herdr-mods/tree/main/mods/subscriptions
```

### Desktop notifications

```text
Read ~/.config/herdr-app/AGENTS.md, then install this mod and set the current personal layout's root toast field to desktop-notifications (clone a shipped layout first; preserve existing layout content): https://github.com/aqua2k1/herdr-mods/tree/main/mods/desktop-notifications
```

See [platform dependencies and manual installation](mods/desktop-notifications/README.md#install).

## Development

Run `npm test`. Copy a MOD directory (not a symlink) into your Herdr `mods/` directory. Host layout integration lives in `integrations/`; personal configurations are not stored here.
