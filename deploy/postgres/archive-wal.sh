#!/usr/bin/env bash
# archive_command of PostgreSQL: stores one finished WAL file on the backup disk.
# PostgreSQL keeps the file and retries while this fails, so a failure loses nothing.
set -euo pipefail

if [[ $# -ne 4 ]]; then
  printf 'Usage: %s <mount-uuid> <archive-directory> <wal-path> <wal-name>\n' "$0" >&2
  exit 2
fi

mount_uuid=$1
archive_directory=$2
wal_path=$3
wal_name=$4

# Without the disk the path lies on the system disk, and the archive would fill it
# and be gone once the disk is back.
found_uuid=$(findmnt --noheadings --output UUID --target "$archive_directory" || true)
if [[ "$found_uuid" != "$mount_uuid" ]]; then
  printf 'archive-wal: %s lies on "%s", not on %s\n' "$archive_directory" "$found_uuid" "$mount_uuid" >&2
  exit 1
fi

target="$archive_directory/$wal_name"

# The server repeats a file when it did not see the last success. Never replace a
# different file: that one can be the only copy left.
if [[ -e "$target" ]]; then
  if cmp --silent -- "$wal_path" "$target"; then
    exit 0
  fi
  printf 'archive-wal: %s exists with other content\n' "$target" >&2
  exit 1
fi

partial="$archive_directory/.$wal_name.partial.$$"
trap 'rm -f -- "$partial"' EXIT

# The rename makes the file appear whole, and the server may recycle its own copy
# as soon as this ends, so both the file and the directory must reach the disk.
cp -- "$wal_path" "$partial"
sync --data -- "$partial"
mv --no-target-directory -- "$partial" "$target"
sync -- "$archive_directory"
