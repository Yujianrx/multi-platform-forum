#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."
db_dump="${1:?Usage: bash deploy/restore.sh /absolute/database.dump /absolute/uploads.tar.gz}"
uploads_archive="${2:?Missing uploads archive}"
test -f "$db_dump"
test -f "$uploads_archive"
echo 'This replaces the current database. Take a backup first.'
read -r -p 'Type RESTORE to continue: ' confirmation
test "$confirmation" = RESTORE
docker compose stop app
docker compose exec -T db pg_restore -U community -d community --clean --if-exists --no-owner < "$db_dump"
# Restore only archives created by this application from a trusted backup store.
docker compose run --rm -T --no-deps --user root --entrypoint tar app -C /data -xzf - < "$uploads_archive"
docker compose run --rm -T --no-deps --user root --entrypoint chown app -R node:node /data
docker compose start app
echo 'Restore complete. Verify health, login, permissions and an attachment download.'
