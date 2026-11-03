#!/usr/bin/env bash
# Replaces this VM's database with a pg_dump archive from db-export.sh (or any pg_dump -Fc).
#
#   ./db-import.sh render.dump
#   ./db-import.sh --yes render.dump    # skip the confirmation prompt
#
# The archive is restored into a scratch database first and only swapped in once the restore
# succeeds, so a bad archive leaves the current data untouched. The API and worker are stopped
# during the swap. On restart the API applies any migrations the archive is missing.
set -euo pipefail

confirm=true
if [ "${1:-}" = "--yes" ]; then confirm=false; shift; fi
if [ $# -ne 1 ] || [ ! -r "$1" ]; then
  echo "Usage: $0 [--yes] <archive.dump>" >&2
  exit 1
fi
# Resolve the archive before moving into this directory so relative paths keep working.
archive=$(cd "$(dirname "$1")" && pwd)/$(basename "$1")
cd "$(dirname "$0")"

if $confirm; then
  read -r -p "This replaces ALL data in the VM database with $archive. Type 'replace' to continue: " answer
  [ "$answer" = "replace" ] || { echo "Aborted." >&2; exit 1; }
fi

psql() { docker compose exec -T db psql -X -v ON_ERROR_STOP=1 -U common_room -d postgres "$@"; }

docker compose up -d --wait db
psql -c "DROP DATABASE IF EXISTS common_room_import" -c "CREATE DATABASE common_room_import"

# Ownership and grants refer to roles on the source server (Render's, for example) that do not
# exist here; everything is recreated as the local common_room user instead.
if ! docker compose exec -T db pg_restore --no-owner --no-acl --exit-on-error --single-transaction \
    -U common_room -d common_room_import < "$archive"; then
  psql -c "DROP DATABASE IF EXISTS common_room_import"
  echo "Restore failed; the existing database was not changed." >&2
  exit 1
fi

docker compose stop api worker
psql -c "DROP DATABASE common_room WITH (FORCE)" -c "ALTER DATABASE common_room_import RENAME TO common_room"
docker compose up -d api worker
echo "Imported $archive."
