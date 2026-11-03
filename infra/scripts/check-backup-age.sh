#!/usr/bin/env bash
# Backup freshness alert (P0-015, TEST-BACKUP-10). Exit 0 if the newest backup is recent enough,
# exit 1 (and print why) if there is none or it is too old. Run from cron/monitoring.
set -euo pipefail

BACKUP_DIR="${BACKUP_DIR:-/srv/nalara/backups}"
MAX_AGE_HOURS="${MAX_AGE_HOURS:-26}"

newest="$(find "$BACKUP_DIR" -maxdepth 1 -type f -name 'nalara-*.dump.age' -printf '%T@ %f\n' 2>/dev/null | sort -rn | head -1)"
if [[ -z "$newest" ]]; then
  echo "ALERT: no backup found in $BACKUP_DIR" >&2
  exit 1
fi
age_hours=$((($(date +%s) - ${newest%%.*}) / 3600))
if ((age_hours > MAX_AGE_HOURS)); then
  echo "ALERT: newest backup ${newest#* } is ${age_hours}h old (limit ${MAX_AGE_HOURS}h)" >&2
  exit 1
fi
echo "ok: newest backup ${newest#* } is ${age_hours}h old"
