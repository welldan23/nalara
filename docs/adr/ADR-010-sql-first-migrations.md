# ADR-010 — SQL-first migrations with a checksum-verifying runner

- **Status:** Accepted (delegated: founder asked to proceed with minimal questions on 2026-11-03; open for review in the P0-005 PR)
- **Date:** 2026-11-03
- **Approver:** Founder (delegated, see status)
- **Supersedes:** the "drizzle-kit generate" part of [ADR-003](ADR-003-database-migrations-roles.md). The rest of ADR-003 (PostgreSQL, Drizzle ORM for queries, two DB roles, explicit migration step) still holds.
- **Related:** PRD B §7 · TEST-DB-01..10 · S-04, S-09

## Context

ADR-003 planned to generate migrations with drizzle-kit. During P0-005 two facts surfaced:

1. `drizzle-kit@0.31.11` pulls `esbuild` (which has an install script, blocked by our pnpm policy), `tsx`, and the deprecated `@esbuild-kit/esm-loader`. That means a larger supply chain for a code generator we would run rarely.
2. Drizzle's own migrator records applied migrations but does not refuse an applied file that was later **edited** or **deleted**, which TEST-DB-03 (checksum) and TEST-DB-04 (drift) require.

## Alternatives

1. Keep drizzle-kit + Drizzle migrator, then add an exception for esbuild's install script and write checksum checks on top.
2. **Hand-written SQL migrations + a small runner of our own; Drizzle ORM only for typed queries.**
3. node-pg-migrate or another migration library (another dependency, still needs our own checksum policy).

## Decision

- Migrations are hand-written, reviewed SQL files `db/migrations/NNNN_name.sql`. Once applied anywhere, a file is never edited, only superseded by a new file.
- `apps/api/src/db/migrate.ts` applies them in order, each in its own transaction together with a bookkeeping row (`nalara_schema_migrations`: version, filename, SHA-256, applied_at). It holds a PostgreSQL advisory lock so concurrent runners serialise, and it refuses to run if an applied file changed, an applied file is missing, or a new file is numbered below the latest applied one.
- `migrationStatus()` is read-only and will back `/health/ready` (P0-006).
- Drizzle ORM table definitions (`apps/api/src/db/schema.ts`) mirror the SQL. An integration test compares them column by column with the migrated database, so drift fails CI.
- Migrations run explicitly (`pnpm --filter @nalara/api run db:migrate`) as `nalara_migrator`. The API connects as `nalara_app`.

## Positive consequences

- No code generator or install-script exception in the dependency tree.
- Tamper, drift and out-of-order checks are enforced and tested.
- The SQL that runs in production is exactly the SQL reviewed in the PR.

## Negative consequences

- Schema changes are written twice (SQL + Drizzle definition). The drift test catches mismatches, but it is manual work.
- The runner is our code to maintain (~150 lines, covered by TEST-DB-01..04, 08).

## Security impact

Edited or missing migrations cannot be applied silently. Least privilege from ADR-003 is kept and tested: `nalara_app` has no DDL and can only `SELECT`/`INSERT` on `audit_events`.

## Performance / cost impact

None measurable. One extra bookkeeping query per migration.

## Rollback path

Generate a Drizzle baseline from the live schema and switch to drizzle-kit via a new ADR. `nalara_schema_migrations` can be kept or dropped, since it does not affect application tables.
