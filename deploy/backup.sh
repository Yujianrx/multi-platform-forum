#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."
backup_dir="${1:?Usage: bash deploy/backup.sh /absolute/backup/directory}"
case "$backup_dir" in /*) ;; *) echo 'Backup destination must be absolute.' >&2; exit 1;; esac
mkdir -p "$backup_dir"
stamp="$(date -u +%Y%m%dT%H%M%SZ)"
# Pause writes to get a matching DB + attachment pair. Never prune live volumes.
docker compose stop app
trap 'docker compose start app >/dev/null' EXIT
docker compose exec -T db pg_dump -U community -d community -Fc > "$backup_dir/community-$stamp.dump"
docker compose run --rm -T --no-deps --user root --entrypoint tar app -C /data -czf - . > "$backup_dir/uploads-$stamp.tar.gz"
sha256sum "$backup_dir/community-$stamp.dump" "$backup_dir/uploads-$stamp.tar.gz" > "$backup_dir/checksums-$stamp.txt"
printf 'Backup complete: %s\n' "$stamp"
