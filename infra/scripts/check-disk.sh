#!/usr/bin/env bash
# Disk space alert (P0-016, TEST-OPS-07, PRD deploy gate "disk free alerts"). Exit 0 while every
# checked filesystem is below the limit, exit 1 (and print ALERT:) as soon as one reaches it.
# Run from cron next to check-backup-age.sh and wire the exit code to a notification.
#
#   MAX_USED_PERCENT=85 infra/scripts/check-disk.sh [path ...]     # default path: /
set -euo pipefail

MAX_USED_PERCENT="${MAX_USED_PERCENT:-85}"
[[ "$MAX_USED_PERCENT" =~ ^[0-9]+$ ]] && ((MAX_USED_PERCENT <= 100)) || {
  echo "check-disk: MAX_USED_PERCENT must be an integer 0..100" >&2
  exit 2
}
(($# > 0)) || set -- /

status=0
for path in "$@"; do
  if ! used="$(df -P -- "$path" 2>/dev/null | awk 'NR == 2 { sub(/%/, "", $5); print $5 }')" || [[ -z "$used" ]]; then
    echo "ALERT: cannot read disk usage for $path" >&2
    status=1
    continue
  fi
  if ((used >= MAX_USED_PERCENT)); then
    echo "ALERT: $path is ${used}% full (limit ${MAX_USED_PERCENT}%)" >&2
    status=1
  else
    echo "ok: $path is ${used}% full (limit ${MAX_USED_PERCENT}%)"
  fi
done
exit "$status"
