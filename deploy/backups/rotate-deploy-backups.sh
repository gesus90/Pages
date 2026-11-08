#!/usr/bin/env bash
# Keeps only the newest deploy backup, once the deploy flow has written it completely.
# Usage: rotate-deploy-backups.sh <new backup directory below PAGES_DEPLOY_BACKUP_ROOT>
# Reads deploy/backups/deploy-backup.env.example; README.md beside it names the contract.
set -euo pipefail
export LC_ALL=C

if (($# != 1)); then
  printf 'Usage: %s <new deploy backup directory>\n' "$0" >&2
  exit 2
fi

root=${PAGES_DEPLOY_BACKUP_ROOT:-/mnt/Data/PagesBackups}
postgres_root=${PAGES_POSTGRES_BACKUP_ROOT:-/mnt/Data/PagesPostgres}
pages_home=${PAGES_HOME:-$HOME/.pages}
programs=${PAGES_POSTGRES_PROGRAMS:-/usr/lib/postgresql/18/bin}
# deploy-20261108-bc4c39c, pages-main-deploy-20261108-1540: a deploy names itself so.
deploy_name='^([A-Za-z0-9_.]+-)*deploy-[A-Za-z0-9_.-]+$'

fail() {
  printf 'rotate-deploy-backups: %s\n' "$1" >&2
  exit 1
}

if [[ ! -d "$root" || -L "$root" ]]; then
  fail "$root is no directory"
fi
root=$(realpath -- "$root")

# The continuous PostgreSQL backup has its own rotation (base-backup.sh); never reach into it.
if [[ -e "$postgres_root" ]]; then
  postgres_root=$(realpath -- "$postgres_root")
  if [[ "$root" == "$postgres_root" || "$root/" == "$postgres_root/"* || "$postgres_root/" == "$root/"* ]]; then
    fail "$root overlaps the PostgreSQL backup $postgres_root"
  fi
fi

if [[ -n "${PAGES_DEPLOY_BACKUP_UUID:-}" ]]; then
  found_uuid=$(findmnt --noheadings --output UUID --target "$root" || true)
  if [[ "$found_uuid" != "$PAGES_DEPLOY_BACKUP_UUID" ]]; then
    fail "$root lies on \"$found_uuid\", not on $PAGES_DEPLOY_BACKUP_UUID"
  fi
fi

name=$(basename -- "$1")
backup="$root/$name"
if [[ ! "$name" =~ $deploy_name ]]; then
  printf 'rotate-deploy-backups: %s is no deploy backup name\n' "$name" >&2
  exit 2
fi
if [[ "$(dirname -- "$(realpath -m -- "$1")")" != "$root" && "$1" != "$name" ]]; then
  fail "$1 does not lie directly in $root"
fi
if [[ ! -d "$backup" || -L "$backup" ]]; then
  fail "$backup is no directory"
fi

exec 9>"$root/.deploy-backup-rotation.lock"
if ! flock --nonblock 9; then
  fail "another run holds $root/.deploy-backup-rotation.lock"
fi

# The check: a checksum list that names every file of the backup, every checksum
# matches, and every dump and archive can be read. Nothing is removed before it passed.
manifest=
for candidate in SHA256SUMS sha256.txt; do
  if [[ -f "$backup/$candidate" && ! -L "$backup/$candidate" ]]; then
    manifest=$candidate
    break
  fi
done
if [[ -z "$manifest" ]]; then
  fail "$name has no SHA256SUMS or sha256.txt; every older backup stays"
fi

listed=$(sed -E -n 's#^[0-9a-f]{64} [ *](\./)?##p' "$backup/$manifest" | sort)
if [[ -z "$listed" ]]; then
  fail "$name/$manifest lists no file; every older backup stays"
fi
present=$(cd -- "$backup" && find . -type f ! -path "./$manifest" -printf '%P\n' | sort)
unlisted=$(comm -13 <(printf '%s\n' "$listed") <(printf '%s\n' "$present"))
if [[ -n "$unlisted" ]]; then
  fail "$name holds files its $manifest does not list: ${unlisted//$'\n'/, }; every older backup stays"
fi
if ! (cd -- "$backup" && sha256sum --check --strict --quiet -- "$manifest" >/dev/null 2>&1); then
  fail "$name does not match its $manifest; every older backup stays"
fi

while IFS= read -r -d '' file; do
  case "$file" in
    *.dump)
      if [[ -x "$programs/pg_restore" ]] && ! "$programs/pg_restore" --list -- "$file" >/dev/null 2>&1; then
        fail "$file is no readable PostgreSQL dump; every older backup stays"
      fi
      ;;
    *.tar)
      if ! tar --list --file "$file" >/dev/null 2>&1; then
        fail "$file is no readable tar archive; every older backup stays"
      fi
      ;;
  esac
done < <(find "$backup" -type f \( -name '*.dump' -o -name '*.tar' \) -print0)

sync -- "$backup"

removed=0
while IFS= read -r -d '' older; do
  older_name=$(basename -- "$older")
  if [[ "$older_name" == "$name" || ! "$older_name" =~ $deploy_name ]]; then
    continue
  fi
  rm -rf -- "${root:?}/$older_name"
  removed=$((removed + 1))
done < <(find "$root" -mindepth 1 -maxdepth 1 -type d -print0)
sync -- "$root"

# A deploy leaves nothing behind in the instance home; its backup lives in $root.
staged=0
if [[ -d "$pages_home" && ! -L "$pages_home" ]]; then
  while IFS= read -r -d '' leftover; do
    rm -rf -- "$leftover"
    staged=$((staged + 1))
  done < <(find "$pages_home" -mindepth 1 -maxdepth 1 -type d -name 'deploy-*' -print0)
fi

printf 'rotate-deploy-backups: %s checked and kept, %d older deploy backups and %d deploy folders in %s removed\n' "$name" "$removed" "$staged" "$pages_home"
