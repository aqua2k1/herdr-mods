#!/bin/sh
set -eu

title=${1:-Herdr}
message=${2:-}

# The Herdr window may itself run inside WSL. Use Windows' notification center.
if [ -n "${WSL_DISTRO_NAME:-}${WSL_INTEROP:-}" ]; then
  command -v powershell.exe >/dev/null 2>&1 || {
    printf '%s\n' 'powershell.exe is required for WSL notifications' >&2
    exit 127
  }
  command -v wslpath >/dev/null 2>&1 || {
    printf '%s\n' 'wslpath is required for WSL notifications' >&2
    exit 127
  }
  command -v od >/dev/null 2>&1 && command -v tr >/dev/null 2>&1 || {
    printf '%s\n' 'od and tr are required for WSL notification text encoding' >&2
    exit 127
  }
  script=$(wslpath -w "$(dirname "$0")/windows-toast.ps1")
  # Encode text so -File cannot mistake a title/body starting with '-' for a parameter.
  title_hex="hex:$(printf '%s' "$title" | od -An -v -tx1 | tr -d ' \n')"
  message_hex="hex:$(printf '%s' "$message" | od -An -v -tx1 | tr -d ' \n')"
  exec powershell.exe -NoLogo -NoProfile -NonInteractive \
    -ExecutionPolicy Bypass -File "$script" -TitleHex "$title_hex" -MessageHex "$message_hex"
fi

command -v notify-send >/dev/null 2>&1 || {
  printf '%s\n' 'notify-send is required for Linux notifications' >&2
  exit 127
}
exec notify-send --app-name=Herdr --expire-time=60000 -- "$title" "$message"
