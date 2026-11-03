#!/usr/bin/env bash
# Encrypted PostgreSQL backup (P0-015, ADR-007).
#
#   AGE_RECIPIENTS_FILE=/srv/nalara/backup.pub infra/scripts/backup.sh
#
# pg_dump (custom format) runs inside the db container and is piped straight into `age`, so an
# unencrypted dump never touches the disk. Only the PUBLIC key is needed here; the private key
# stays offline with the founder. Output: $BACKUP_DIR/nalara-<UTC timestamp>.dump.age, mode 0600.
set -euo pipefail
umask 077

: "${AGE_RECIPIENTS_FILE:?AGE_RECIPIENTS_FILE must point to the age public key file}"
BACKUP_DIR="${BACKUP_DIR:-/srv/nalara/backups}"
DB_NAME="${DB_NAME:-nalara}"
# Command prefix that runs a program inside the database container.
PG_EXEC="${PG_EXEC:-docker compose -f compose.prod.yaml --env-file /srv/nalara/.env exec -T db}"

command -v age >/dev/null || { echo "backup: age is not installed" >&2; exit 1; }
[[ -r "$AGE_RECIPIENTS_FILE" ]] || { echo "backup: cannot read AGE_RECIPIENTS_FILE" >&2; exit 1; }
grep -q '^age1' "$AGE_RECIPIENTS_FILE" || { echo "backup: AGE_RECIPIENTS_FILE holds no age public key" >&2; exit 1; }

mkdir -p "$BACKUP_DIR"
chmod 700 "$BACKUP_DIR"

stamp="$(date -u +%Y%m%dT%H%M%SZ)"
final="$BACKUP_DIR/nalara-$stamp.dump.age"
partial="$final.partial"
trap 'rm -f "$partial"' EXIT

# shellcheck disable=SC2086 # PG_EXEC is an intentional word-split command prefix.
$PG_EXEC pg_dump --username=postgres --dbname="$DB_NAME" --format=custom --no-password \
  | age --encrypt --recipients-file "$AGE_RECIPIENTS_FILE" --output "$partial"

[[ -s "$partial" ]] || { echo "backup: produced an empty archive" >&2; exit 1; }
chmod 600 "$partial"
mv "$partial" "$final"
trap - EXIT
echo "backup: wrote $final ($(wc -c <"$final") bytes)"
