#!/usr/bin/env bash
# Offsite copy of the encrypted backups (P1-10c, D-04: Google Drive through rclone).
#
#   OFFSITE_REMOTE=gdrive:nalara-backups RCLONE_CONFIG=/srv/nalara/rclone.conf \
#     infra/scripts/offsite.sh
#
# Only `age` ciphertext ever leaves the server: every file is checked for the age header before
# upload, so Google never sees a readable dump, and the decryption key stays offline with the
# founder (ADR-007). Uploads never overwrite (--immutable), and every local archive is then checked
# against the remote by hash. Remote copies older than OFFSITE_KEEP_DAYS (default 90) are deleted;
# on Google Drive they go to the trash first (30 days), so a mistake can still be undone there.
# Exit code is non-zero on any problem, for the cron alert.
set -euo pipefail
umask 077

: "${OFFSITE_REMOTE:?OFFSITE_REMOTE must name the rclone remote and folder, e.g. gdrive:nalara-backups}"
BACKUP_DIR="${BACKUP_DIR:-/srv/nalara/backups}"
OFFSITE_KEEP_DAYS="${OFFSITE_KEEP_DAYS:-90}"
PATTERN='nalara-*.dump.age'

command -v rclone >/dev/null || { echo "offsite: rclone is not installed" >&2; exit 1; }
[[ "$OFFSITE_KEEP_DAYS" =~ ^[0-9]+$ ]] || { echo "offsite: OFFSITE_KEEP_DAYS must be a whole number" >&2; exit 1; }
if [[ -n "${RCLONE_CONFIG:-}" ]]; then
  [[ -r "$RCLONE_CONFIG" ]] || { echo "offsite: cannot read RCLONE_CONFIG" >&2; exit 1; }
  # The config holds the Drive token: refuse to run if anyone but the owner can read it.
  mode="$(stat -c '%a' "$RCLONE_CONFIG")"
  [[ "$mode" =~ ^[0-7]00$ ]] || { echo "offsite: RCLONE_CONFIG must be mode 600 (is $mode)" >&2; exit 1; }
fi

mapfile -t archives < <(find "$BACKUP_DIR" -maxdepth 1 -type f -name "$PATTERN" -printf '%f\n' | sort)
((${#archives[@]} > 0)) || { echo "offsite: no backups in $BACKUP_DIR" >&2; exit 1; }

# Defence in depth: never upload anything that is not age ciphertext, whatever its name says.
for file in "${archives[@]}"; do
  header="$(head -c 21 "$BACKUP_DIR/$file")"
  if [[ "$header" != "age-encryption.org/v1" ]]; then
    echo "offsite: $file is not an age archive; refusing to upload anything" >&2
    exit 1
  fi
done

# Compare by content hash (Google Drive keeps MD5), not by time: a copy whose bytes differ is an
# error and is never overwritten.
rclone copy "$BACKUP_DIR" "$OFFSITE_REMOTE" --include "$PATTERN" --checksum --immutable --quiet

# Every local archive must exist remotely with the same content (hash where the remote has one,
# size otherwise). --one-way: remote copies older than the local retention are expected.
rclone check "$BACKUP_DIR" "$OFFSITE_REMOTE" --include "$PATTERN" --one-way --quiet

if ((OFFSITE_KEEP_DAYS > 0)); then
  rclone delete "$OFFSITE_REMOTE" --include "$PATTERN" --min-age "${OFFSITE_KEEP_DAYS}d" --quiet
fi

count="$(rclone lsf "$OFFSITE_REMOTE" --include "$PATTERN" | wc -l)"
echo "offsite: ${#archives[@]} local archive(s) verified at $OFFSITE_REMOTE ($count kept there)"
