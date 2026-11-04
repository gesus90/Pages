#!/usr/bin/env bash
# Takes one base backup of the running server and keeps the newest ones.
# Reads deploy/postgres/backup.env.example; the connection comes from PGHOST, PGPORT,
# PGUSER and PGPASSFILE.
set -euo pipefail

: "${PAGES_POSTGRES_BACKUP_ROOT:?}"
: "${PAGES_POSTGRES_BACKUP_UUID:?}"
programs=${PAGES_POSTGRES_PROGRAMS:-/usr/lib/postgresql/18/bin}
keep=${PAGES_POSTGRES_BACKUP_KEEP:-7}

if ! [[ "$keep" =~ ^[1-9][0-9]*$ ]]; then
  printf 'base-backup: PAGES_POSTGRES_BACKUP_KEEP must be a whole number from 1 on\n' >&2
  exit 2
fi

root=$PAGES_POSTGRES_BACKUP_ROOT
base_directory="$root/base"
wal_directory="$root/wal"

found_uuid=$(findmnt --noheadings --output UUID --target "$root" || true)
if [[ "$found_uuid" != "$PAGES_POSTGRES_BACKUP_UUID" ]]; then
  printf 'base-backup: %s lies on "%s", not on %s\n' "$root" "$found_uuid" "$PAGES_POSTGRES_BACKUP_UUID" >&2
  exit 1
fi

mkdir -p -- "$base_directory"

exec 9>"$root/base-backup.lock"
if ! flock --nonblock 9; then
  printf 'base-backup: another run holds %s/base-backup.lock\n' "$root" >&2
  exit 1
fi

# Only a backup that passed its check gets its final name, and the lock above says
# that a partial directory belongs to a run that died.
find "$base_directory" -mindepth 1 -maxdepth 1 -type d -name '.partial-*' -exec rm -rf -- {} +

name=$(date --utc +%Y%m%dT%H%M%SZ)
partial="$base_directory/.partial-$name"
final="$base_directory/$name"

"$programs/pg_basebackup" \
  --pgdata="$partial" \
  --format=plain \
  --wal-method=stream \
  --checkpoint=fast \
  --manifest-checksums=SHA256 \
  --label="pages-$name" \
  --no-password

"$programs/pg_verifybackup" "$partial"

# pg_basebackup has synchronized its files, only the rename is left.
mv --no-target-directory -- "$partial" "$final"
sync -- "$base_directory"

mapfile -t backups < <(find "$base_directory" -mindepth 1 -maxdepth 1 -type d -regextype posix-extended -regex '.*/[0-9]{8}T[0-9]{6}Z' -printf '%f\n' | sort)

surplus=$((${#backups[@]} - keep))
for ((index = 0; index < surplus; index += 1)); do
  rm -rf -- "${base_directory:?}/${backups[index]}"
done
if ((surplus < 0)); then
  surplus=0
fi

# The oldest backup still needs the WAL from its own start on, nothing before it.
oldest="$base_directory/${backups[surplus]}"
oldest_wal=$(sed -n 's/^START WAL LOCATION: .* (file \([0-9A-F]\{24\}\))$/\1/p' "$oldest/backup_label")
if [[ -z "$oldest_wal" ]]; then
  printf 'base-backup: no WAL start in %s/backup_label, the archive stays as it is\n' "$oldest" >&2
  exit 1
fi
"$programs/pg_archivecleanup" --clean-backup-history "$wal_directory" "$oldest_wal"

printf 'base-backup: %s finished, %d kept, WAL from %s on\n' "$name" "$((${#backups[@]} - surplus))" "$oldest_wal"
