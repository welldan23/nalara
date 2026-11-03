# Database

PostgreSQL 18 (pinned image in [`compose.yaml`](../compose.yaml)). Decisions: [ADR-003](../docs/adr/ADR-003-database-migrations-roles.md), [ADR-009](../docs/adr/ADR-009-identity-audit-schema.md), [ADR-010](../docs/adr/ADR-010-sql-first-migrations.md).

## Roles

| Role | Used by | Can do |
|---|---|---|
| `nalara_migrator` | `db:migrate` only | Owns the database and runs DDL |
| `nalara_app` | the API | Read/write `users` and `sessions`. Only `SELECT`/`INSERT` on `audit_events`. No DDL |

Local roles are created by [`init/01-roles.sh`](init/01-roles.sh) the first time the `db` container starts with an empty volume. On a VPS, create them once with the same SQL as a superuser, using passwords generated on the host.

## Local workflow

```bash
cp .env.example .env          # then replace every REPLACE_WITH_ value
docker compose up -d db       # first start creates roles + database
pnpm --filter @nalara/api run db:status    # exit 1 while migrations are pending
pnpm --filter @nalara/api run db:migrate   # apply pending migrations
```

`DATABASE_MIGRATOR_URL` and `DATABASE_URL` in `.env` must use the same passwords as `DB_MIGRATOR_PASSWORD` and `DB_APP_PASSWORD`.

## Writing a migration

1. Add `db/migrations/NNNN_short_name.sql` with the next number. Never edit a file that has been applied anywhere.
2. Grant table privileges to `nalara_app` explicitly in the same file (least privilege).
3. Update `apps/api/src/db/schema.ts` to match. The drift test fails otherwise.
4. Run the integration tests against a throwaway server:
   `TEST_DATABASE_ADMIN_URL=postgres://postgres:<pw>@127.0.0.1:5432/postgres pnpm run test`

The runner refuses to migrate if an applied file was edited or deleted, or if a new file is numbered below the latest applied one. Destructive migrations need a separate founder approval and a tested restore (PRD D3).
