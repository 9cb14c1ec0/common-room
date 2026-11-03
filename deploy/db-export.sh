#!/usr/bin/env bash
# Writes a pg_dump archive of a Common Room database to stdout.
#
#   ./db-export.sh > backup.dump                  # this VM's database
#   ./db-export.sh "$SOURCE_URL" > render.dump    # any reachable PostgreSQL, e.g. Render's External Database URL
#
# Uses pg_dump from the db container, so the stack's db service must be running.
set -euo pipefail
cd "$(dirname "$0")"

if [ -t 1 ]; then
  echo "Redirect the output to a file: $0 [database-url] > backup.dump" >&2
  exit 1
fi

if [ $# -eq 0 ]; then
  exec docker compose exec -T db pg_dump --format=custom -U common_room -d common_room
fi

# The URL goes in through the environment so it does not appear in the host's process list.
# pg_dump refuses servers newer than itself; check up front for a clearer error.
docker compose exec -T -e SOURCE_URL="$1" db sh -euc '
  server=$(psql -X -At -d "$SOURCE_URL" -c "SHOW server_version_num")
  client=$(pg_dump --version | sed -E "s/[^0-9]*([0-9]+).*/\1/")
  if [ "$((server / 10000))" -gt "$client" ]; then
    echo "Source is PostgreSQL $((server / 10000)) but the db image is $client. Raise the postgres image in compose.yaml first." >&2
    exit 1
  fi
  exec pg_dump --format=custom -d "$SOURCE_URL"
'
