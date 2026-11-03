#!/usr/bin/env bash
# Backup retention (P0-015, ADR-007): keep the newest backup of each of the last 7 days that have
# backups, plus the newest of each of the 4 ISO weeks before those. Dry-run by default.
#
#   infra/scripts/prune.sh            # print what would be deleted
#   infra/scripts/prune.sh --apply    # delete it
set -euo pipefail

BACKUP_DIR="${BACKUP_DIR:-/srv/nalara/backups}"
KEEP_DAILY="${KEEP_DAILY:-7}"
KEEP_WEEKLY="${KEEP_WEEKLY:-4}"
apply=false
[[ "${1:-}" == "--apply" ]] && apply=true

mapfile -t backups < <(find "$BACKUP_DIR" -maxdepth 1 -type f -name 'nalara-*.dump.age' -printf '%f\n' | sort -r)

declare -A seen_day seen_week
keep=()
remove=()
days=0
weeks=0
for file in "${backups[@]}"; do
  stamp="${file#nalara-}"
  stamp="${stamp%%.dump.age}"
  if [[ ! "$stamp" =~ ^([0-9]{8})T[0-9]{6}Z$ ]]; then
    keep+=("$file") # never delete what we cannot parse
    continue
  fi
  day="${BASH_REMATCH[1]}"
  week="$(date -u -d "$day" +%G-W%V)"
  if [[ -n "${seen_day[$day]:-}" ]]; then
    remove+=("$file")
  elif ((days < KEEP_DAILY)); then
    seen_day[$day]=1
    seen_week[$week]=1
    days=$((days + 1))
    keep+=("$file")
  elif [[ -z "${seen_week[$week]:-}" ]] && ((weeks < KEEP_WEEKLY)); then
    seen_day[$day]=1
    seen_week[$week]=1
    weeks=$((weeks + 1))
    keep+=("$file")
  else
    seen_day[$day]=1
    remove+=("$file")
  fi
done

for file in "${keep[@]}"; do echo "keep   $file"; done
for file in "${remove[@]}"; do
  if $apply; then
    rm -f -- "$BACKUP_DIR/$file"
    echo "delete $file"
  else
    echo "would delete $file"
  fi
done
echo "prune: ${#keep[@]} kept, ${#remove[@]} $($apply && echo deleted || echo 'to delete (dry run)')"
