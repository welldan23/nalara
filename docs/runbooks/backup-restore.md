# Runbook — Encrypted backups and restore drills (Phase 0)

Decision: [ADR-007](../adr/ADR-007-backup-restore.md). Scripts: [`infra/scripts`](../../infra/scripts). Automated drill: `pnpm run test:backup` (TEST-BACKUP-01..11).

**Offsite destination: Google Drive (D-04, decided 2026-11-04)**, through `rclone` ([§7](#7-offsite-copy-to-google-drive-d-04)). Only `age` ciphertext is uploaded; the decryption key never leaves the founder's own machines. The gate stays open until the first real upload and a restore from Drive are recorded on the VPS.

## 1. Keys (once, on the founder's own machine — not on the server)

```bash
age-keygen -o nalara-backup.key      # PRIVATE key: keep offline (password manager + paper/USB copy)
age-keygen -y nalara-backup.key > nalara-backup.pub
```

Copy **only** `nalara-backup.pub` to the server as `/srv/nalara/backup.pub`. The server can encrypt backups but never decrypt them, so a stolen server or stolen backup file reveals nothing.

If the private key is lost, every backup is unrecoverable. Keep two offline copies in different places.

## 2. Daily backup

```bash
cd /srv/nalara/app
AGE_RECIPIENTS_FILE=/srv/nalara/backup.pub BACKUP_DIR=/srv/nalara/backups infra/scripts/backup.sh
```

- `pg_dump --format=custom` runs inside the `db` container and is streamed straight into `age`. No unencrypted dump touches the disk.
- Output `nalara-<UTC>.dump.age`, mode `0600`, in a `0700` directory. Files are written as `.partial` and renamed when complete.

Schedule it (example cron for the deploy user, 02:17 UTC):

```cron
17 2 * * * cd /srv/nalara/app && AGE_RECIPIENTS_FILE=/srv/nalara/backup.pub infra/scripts/backup.sh && infra/scripts/prune.sh --apply && RCLONE_CONFIG=/srv/nalara/rclone.conf OFFSITE_REMOTE=gdrive:nalara-backups infra/scripts/offsite.sh || <notify founder>
*/30 * * * * /srv/nalara/app/infra/scripts/check-backup-age.sh || <notify founder>
```

## 3. Retention

`infra/scripts/prune.sh` keeps the newest backup of each of the last **7 days** and of the **4 ISO weeks** before those. It is a dry run unless `--apply` is given. Files it cannot parse are never deleted.

## 4. Freshness alert

`infra/scripts/check-backup-age.sh` exits `1` with `ALERT:` if there is no backup or the newest is older than `MAX_AGE_HOURS` (default 26). Wire that exit code to a notification.

## 5. Restore drill (monthly, and before launch)

On a machine that has the **private** key (never leave it on the server):

```bash
infra/scripts/restore.sh nalara-<UTC>.dump.age nalara-backup.key nalara-restore-drill
```

1. The whole archive is decrypted to `/dev/null` first. A wrong key, a corrupted or a tampered file stops here (exit 2) and nothing is created.
2. A **new** PostgreSQL container with **no network** is started. Roles are recreated, then the stream is decrypted into `pg_restore --single-transaction`.
3. Row counts are printed for a quick check. Inspect it, then remove it with `docker rm -f nalara-restore-drill`.

Record the date, archive name, duration and row counts in `docs/phase-0/ACCEPTANCE.md` (or the ops log).

## 6. Disaster recovery (real incident)

Never restore over the live database.

1. Stop public traffic: `docker compose -f compose.prod.yaml --env-file /srv/nalara/.env stop caddy`.
2. Restore the chosen archive into a new volume or database and verify it (steps above).
3. Point the stack at the restored data (new volume), run `migrate` (it must report up to date), start `api`/`web`, then `caddy`.
4. Revoke every session that existed in the restored data (`UPDATE sessions SET revoked_at = now() WHERE revoked_at IS NULL`). Rotating `SESSION_SECRET` alone is **not** enough: it only signs CSRF tokens, while sessions are checked against the database. Write an incident note ([incident runbook](incident.md)).

Targets (ADR-007, not SLAs): RPO ≤ 24 h, RTO ≤ 8 h.

## 7. Offsite copy to Google Drive (D-04)

`infra/scripts/offsite.sh` copies every `nalara-*.dump.age` from `BACKUP_DIR` to an rclone remote. What it does, in order:

1. **Refuses** to upload anything unless every file starts with the `age` header. A plaintext dump can never reach Drive, even by mistake.
2. Uploads with `--checksum --immutable`: an existing copy whose bytes differ is an **error**, never overwritten.
3. Checks every local archive against Drive by MD5 (`rclone check --one-way`).
4. Deletes Drive copies older than `OFFSITE_KEEP_DAYS` (default **90**). On Google Drive they go to the trash first, which Google keeps for 30 days.
5. Refuses an `RCLONE_CONFIG` that is not mode `600`, because it holds the Drive token.

Any failure exits non-zero for the cron alert. The drill (TEST-BACKUP-11) runs these exact commands against a local folder, including tampering, plaintext, retention and a restore from the copy.

### One-time setup (founder + server, about 15 minutes)

1. **Google account and folder.** Prefer a separate Google account just for NALARA backups, or at least a dedicated folder. Note the free 15 GB quota; one backup is a few MB to a few hundred MB (images are included).
2. **On the server:** `sudo apt-get install -y rclone`. Ubuntu 24.04 ships rclone 1.60, the same version the drill uses.
3. **Authorise on the founder's laptop** (the server has no browser). Install rclone there, then run:

   ```bash
   rclone authorize "drive" --drive-scope drive.file
   ```

   Sign in with the backup Google account. Scope `drive.file` lets rclone see **only the files it created itself**, not the rest of the Drive. Copy the JSON token it prints. Never paste it into chat, issues or tickets.
4. **On the server, as the deploy user:**

   ```bash
   install -m 600 /dev/null /srv/nalara/rclone.conf
   RCLONE_CONFIG=/srv/nalara/rclone.conf rclone config create gdrive drive scope drive.file token '<paste token>'
   RCLONE_CONFIG=/srv/nalara/rclone.conf rclone mkdir gdrive:nalara-backups
   ```

   `rclone.conf` is never committed (it lives outside the repo, in `/srv/nalara`).
5. **First upload and verify:** run the cron line from §2 by hand, then `rclone lsl gdrive:nalara-backups`.
6. **Restore from Drive once** (this is the gate), on the founder's machine with the private key:

   ```bash
   rclone copy gdrive:nalara-backups/nalara-<UTC>.dump.age .
   infra/scripts/restore.sh nalara-<UTC>.dump.age nalara-backup.key nalara-restore-offsite
   ```

   Record the date, archive and row counts in `docs/phase-1/ACCEPTANCE.md`.

### Residual risks

- **The server's token can delete what rclone uploaded.** An attacker on the server could remove the Drive copies. Deleted files stay in the Drive trash for 30 days, so check the folder from the founder's own login at least monthly. A Drive owned by a different account than any server-side credential limits the blast radius.
- **Losing the Google account means losing the offsite copies.** Enable 2-step verification on that account and keep its recovery codes offline, next to the backup key.
- **The token can expire or be revoked**, for example after a password change. The next run then fails and alerts; repeat steps 3–4.
