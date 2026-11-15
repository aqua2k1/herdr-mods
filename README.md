# Herdr MODs

Independent, self-contained MODs in `mods/<name>/`.

- [Subscriptions](mods/subscriptions/README.md): provider cards; Codex subscription quotas/reset cards and DeepSeek API balance, queried only when opened.
- [Desktop notifications](mods/desktop-notifications/README.md): forwards existing toasts to the OS while Herdr is inactive, without changing the host.

## Install

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
