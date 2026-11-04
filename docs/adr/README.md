# Architecture Decision Records

Format tiap ADR mengikuti PRD §17: ID, title, status, date, context, alternatives, decision, positive/negative consequences, security impact, performance/cost impact, rollback path, approver.

Status: `Proposed` → `Accepted` → `Superseded by ADR-XXX`. ADR yang sudah diterima tidak diedit isinya. Kalau keputusan berubah, buat ADR baru yang menggantikannya.

| ADR | Judul | Status |
|---|---|---|
| [ADR-001](ADR-001-package-manager-node-workspace.md) | Package manager, Node.js runtime, workspace convention | Accepted |
| [ADR-002](ADR-002-web-api-boundary-framework.md) | Web/API boundary and API framework | Accepted |
| [ADR-003](ADR-003-database-migrations-roles.md) | Database, migration tool, and database roles | Accepted |
| [ADR-004](ADR-004-session-cookie-csrf-ratelimit.md) | Session storage, cookie scope, CSRF, rate limiting | Accepted |
| [ADR-005](ADR-005-mfa-totp-recovery.md) | MFA method, login challenge flow, and recovery | Accepted |
| [ADR-006](ADR-006-reverse-proxy-tls-routing.md) | Reverse proxy, TLS, and same-origin routing | Accepted |
| [ADR-007](ADR-007-backup-restore.md) | Backup encryption, retention, restore, offsite destination | Accepted (approach) · destination pending D-04 |
| [ADR-008](ADR-008-ci-branch-protection.md) | GitHub Actions CI, security checks, and branch protection | Accepted |
| [ADR-009](ADR-009-identity-audit-schema.md) | Identity and audit schema shape | Accepted |
| [ADR-010](ADR-010-sql-first-migrations.md) | SQL-first migrations with a checksum-verifying runner | Accepted (delegated) · supersedes the drizzle-kit part of ADR-003 |
| [ADR-011..019](../phase-1/ADR-PROPOSALS.md) | Phase 1: content blocks, revision-bound approval, dynamic SSR, media storage, rollout flag, slugs, nonce CSP, keeping the Fastify API, citation and verification rules | Accepted (D-19) · kept in one file until each is used |
| [ADR-020](ADR-020-agent-gateway.md) | Agent AI behind a tool gateway, proposal-only, AI off by default | Accepted (delegated) |

Konteks audit: [`../phase-0/BASELINE.md`](../phase-0/BASELINE.md) · Usulan asli: [`../phase-0/ADR-PROPOSALS.md`](../phase-0/ADR-PROPOSALS.md) · Register keputusan founder: [`../decisions/DECISIONS.md`](../decisions/DECISIONS.md).
