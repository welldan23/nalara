# Runbook — Encrypted backups and restore drills (Phase 0)

Decision: [ADR-007](../adr/ADR-007-backup-restore.md). Scripts: [`infra/scripts`](../../infra/scripts). Automated drill: `pnpm run test:backup` (TEST-BACKUP-01..10).

**Offsite destination is still open (D-04).** Until the founder decides, backups exist only on the VPS, so a lost server means lost backups. The production gate for P0-015 stays open until offsite copies run.

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
17 2 * * * cd /srv/nalara/app && AGE_RECIPIENTS_FILE=/srv/nalara/backup.pub infra/scripts/backup.sh && infra/scripts/prune.sh --apply
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
