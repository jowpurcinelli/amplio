#!/usr/bin/env bash
# Table-consistent hardlinked snapshots held throughout the existing restic job.
# This is an explicit backup hook, not a daemon. Install only after review.
set -euo pipefail
umask 077
if [ -f /etc/nellia/amplio-backup.env ]; then
  # This file only selects the exact runtime container and private state directory.
  source /etc/nellia/amplio-backup.env
fi
state_dir="${AMPLIO_BACKUP_STATE_DIR:-/var/lib/nellia/amplio-backup}"
mkdir -p "$state_dir"
chmod 700 "$state_dir"
marker="$state_dir/active-snapshot"
resolve_container() {
  if [ -n "${AMPLIO_APP_UUID:-}" ]; then
    [[ "$AMPLIO_APP_UUID" =~ ^[a-zA-Z0-9]+$ ]] || { echo 'Invalid Amplio application selector' >&2; return 1; }
    local candidate candidate_image
    local candidates=()
    while IFS= read -r candidate; do
      [ -n "$candidate" ] || continue
      candidate_image="$(docker inspect -f '{{.Config.Image}}' "$candidate")"
      if [[ "$candidate_image" == clickhouse/clickhouse-server:24.8* ]]; then candidates+=("$candidate"); fi
    done < <(docker ps --filter "name=$AMPLIO_APP_UUID" --filter status=running --format '{{.Names}}')
    [ "${#candidates[@]}" -eq 1 ] || { echo 'Expected exactly one running Amplio ClickHouse container' >&2; return 1; }
    container="${candidates[0]}"
  else
    container="${AMPLIO_CLICKHOUSE_CONTAINER:?set Amplio app UUID or exact QA ClickHouse container}"
  fi
  [[ "$container" =~ ^[a-zA-Z0-9][a-zA-Z0-9_.-]+$ ]] || return 1
}
ch() {
  docker exec "$container" sh -c 'exec clickhouse-client --user default --password "$CLICKHOUSE_PASSWORD" --query "$1"' sh "$1"
}
cleanup() {
  [ -f "$marker" ] || return 0
  local lines
  lines=()
  while IFS= read -r line; do lines+=("$line"); done < "$marker"
  container="${lines[0]:-}"
  snapshot="${lines[1]:-}"
  [[ "$container" =~ ^[a-zA-Z0-9][a-zA-Z0-9_.-]+$ ]] || { echo 'Invalid backup container marker' >&2; return 1; }
  [[ "$snapshot" =~ ^nellia_restic_[0-9TZ_]+$ ]] || { echo 'Invalid backup snapshot marker' >&2; return 1; }
  local table
  for table in "${lines[@]:2}"; do
    [[ "$table" == events || "$table" == replay_events ]] || return 1
    ch "ALTER TABLE amplio.$table UNFREEZE WITH NAME '$snapshot'" >/dev/null
  done
  rm -f "$marker"
  # Schema files are safe DDL, but keep only the active backup state on the host.
  rm -rf "$state_dir/$snapshot"
  echo 'Amplio frozen backup snapshot released'
}
case "${1:-}" in
  before)
    # Systemd serializes the existing backup job. Recover an interrupted old hook.
    cleanup
    resolve_container
    [[ "$container" =~ ^[a-zA-Z0-9][a-zA-Z0-9_.-]+$ ]] || exit 1
    image="$(docker inspect -f '{{.Config.Image}}' "$container")"
    [[ "$image" == clickhouse/clickhouse-server:24.8* ]] || { echo 'Unexpected ClickHouse image' >&2; exit 1; }
    snapshot="nellia_restic_$(date -u +%Y%m%dT%H%M%SZ)_$$"
    tables=()
    while IFS= read -r line; do tables+=("$line"); done < <(ch "SELECT name FROM system.tables WHERE database='amplio' AND name IN ('events','replay_events') AND engine LIKE '%MergeTree%' ORDER BY name")
    [ "${#tables[@]}" -gt 0 ] || { echo 'No Amplio event tables found' >&2; exit 1; }
    mkdir -p "$state_dir/$snapshot"
    printf '%s\n' "$container" "$snapshot" "${tables[@]}" > "$marker"
    for table in "${tables[@]}"; do
      ch "SHOW CREATE TABLE amplio.$table FORMAT TabSeparatedRaw" > "$state_dir/$snapshot/$table.sql"
      ch "SELECT toString(uuid) FROM system.tables WHERE database='amplio' AND name='$table'" > "$state_dir/$snapshot/$table.uuid"
      ch "ALTER TABLE amplio.$table FREEZE WITH NAME '$snapshot'" >/dev/null
    done
    echo "Amplio table snapshots prepared (${#tables[@]} tables)"
    ;;
  cleanup) cleanup ;;
  *) echo 'Usage: amplio-restic-hook.sh before|cleanup' >&2; exit 2 ;;
esac
