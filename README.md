# Herdr MODs

Independent, self-contained MODs in `mods/<name>/`.

- [Subscriptions](mods/subscriptions/README.md): provider cards; Codex subscription quotas/reset cards and DeepSeek API balance, queried only when opened.

## Install

### Subscriptions

```text
Read ~/.config/herdr-app/AGENTS.md, then add this mod alongside Files and Changes: https://github.com/aqua2k1/herdr-mods/tree/main/mods/subscriptions
```

## Development

Run `npm test`. Copy a MOD directory (not a symlink) into your Herdr `mods/` directory. Host layout integration lives in `integrations/`; personal configurations are not stored here.
