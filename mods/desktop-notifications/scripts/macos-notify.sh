#!/bin/sh
set -eu

command -v terminal-notifier >/dev/null 2>&1 || {
  printf '%s\n' 'terminal-notifier is required for macOS notifications' >&2
  exit 127
}
# Prefix arguments so terminal-notifier cannot interpret text beginning with "-".
# terminal-notifier documents this escaping convention for its text arguments.
exec terminal-notifier -title "\\${1:-Herdr}" -message "\\${2:-}" -group herdr-notification
