#!/bin/sh
# Passed inline; no deployment. V2 arguments: path offset count expected-version.
set -eu
fail() { printf '%s\n' "$1" >&2; exit 1; }
p=$1
offset=${2:-0}
count=${3:-1048576}
expected=${4:-}
case $offset:$count in *[!0-9:]*|:*|*:) fail 'Invalid image range' ;; esac
[ "$offset" -le 5242880 ] && [ "$count" -le 1048576 ] || fail 'Invalid image range'
case $p in /*) ;; *) p=./$p ;; esac
[ -f "$p" ] || fail 'Image is not a regular file'
exec 3< "$p"
[ -f /dev/fd/3 ] || fail 'Image is not a regular file'
stamp() {
  stat -Lc '%d:%i:%s:%y:%z' "${1:-/dev/fd/3}" 2>/dev/null ||
    stat -Lf '%d:%i:%z:%m:%c' "${1:-/dev/fd/3}"
}
before=$(stamp) || fail 'Cannot stat image'
[ "$before" = "$(stamp "$p")" ] || fail 'Image changed during open'
size=$(stat -Lc %s /dev/fd/3 2>/dev/null) || size=$(stat -Lf %z /dev/fd/3) || fail 'Cannot stat image'
[ "$size" -le 5242880 ] || fail 'Image exceeds 5 MiB'
umask 077
tmp=$(mktemp -d "${TMPDIR:-/tmp}/files-plus.XXXXXXXX")
trap 'rm -rf "$tmp"' EXIT
trap 'exit 1' HUP INT TERM
# Bounded snapshot even if the file grows after stat.
dd bs=65536 count=81 <&3 > "$tmp/image" 2>/dev/null || fail 'Cannot read image'
actual=$(wc -c < "$tmp/image" | tr -d '[:space:]')
[ "$actual" -le 5242880 ] || fail 'Image exceeds 5 MiB during read'
[ "$actual" -eq "$size" ] && [ "$before" = "$(stamp)" ] || fail 'Image changed during read'
hash() {
  if command -v sha256sum >/dev/null 2>&1; then sha256sum;
  else shasum -a 256; fi
}
digest=$(hash < "$tmp/image") || fail 'Cannot hash image'
digest=${digest%% *}
# Hash metadata too: replacement, truncation and same-byte rewrites are versions.
version=$(printf '%s\n%s' "$before" "$digest" | hash) || fail 'Cannot hash version'
version=${version%% *}
[ -z "$expected" ] || [ "$expected" = "$version" ] || fail 'Image changed between chunks'
[ "$offset" -le "$size" ] || fail 'Invalid image offset'
length=$((size - offset))
[ "$length" -le "$count" ] || length=$count
chunks=$(((size + 1048575) / 1048576))
# Aligned requests avoid byte-at-a-time dd for multi-MiB files.
[ $((offset % 1048576)) -eq 0 ] || [ "$offset" -eq "$size" ] || fail 'Invalid image offset'
if [ "$length" -gt 0 ]; then
  dd if="$tmp/image" of="$tmp/range" bs=1048576 skip=$((offset / 1048576)) count=1 2>/dev/null || fail 'Cannot read chunk'
  dd if="$tmp/range" of="$tmp/chunk" bs="$length" count=1 2>/dev/null || fail 'Cannot read chunk'
else
  : > "$tmp/chunk"
fi
[ "$before" = "$(stamp)" ] && [ "$before" = "$(stamp "$p")" ] || fail 'Image changed during read'
printf 'FILES_PLUS_IMAGE_V2\n%s\n%s\n%s\n%s\n%s\n' "$offset" "$size" "$chunks" "$length" "$version"
base64 < "$tmp/chunk" | tr -d '\r\n'
printf '\n'
