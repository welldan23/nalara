# Runbook — CI gates and dependency updates (Phase 0)

Decision: [ADR-008](../adr/ADR-008-ci-branch-protection.md). Workflow: [`.github/workflows/ci.yml`](../../.github/workflows/ci.yml). Update bot: [`.github/dependabot.yml`](../../.github/dependabot.yml).

## 1. What runs on every pull request

| Job (status check name)                     | What it proves                                                                                                                                    |
| ------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------- |
| `Format, lint, typecheck, test, build`      | Frozen lockfile install, Prettier, ESLint, `tsc`, unit and integration tests against a real PostgreSQL 18.6, production build                     |
| `Dependency audit and registry signatures`  | No known advisory in shipped dependencies (any severity), no high/critical advisory anywhere, every package carries a valid npm registry signature |
| `Browser end-to-end (Chromium)`             | TEST-WEB-01..10 against the real API, a fresh database and a production web build                                                                |
| `Production Compose smoke`                  | Builds both images and checks the real production stack (TEST-COMPOSE, TEST-OPS-01..04, founder bootstrap)                                         |
| `Backup and restore drill`                  | TEST-BACKUP-01..10 with real `age` and PostgreSQL containers                                                                                      |
| `Secret scan (gitleaks)`                    | No secret anywhere in git history (checksum-verified gitleaks)                                                                                    |

Every suite exits non-zero if any check fails **or if fewer checks ran than expected**, so a crash can never look like a pass. No step uses `continue-on-error` or `|| true` (guarded by `tests/repo/ci.test.ts`).

All jobs are free GitHub-hosted runners. No production secret exists in CI: databases and keys are generated per run and thrown away.

## 2. Required status checks (founder, once)

CI only blocks a merge if GitHub is told to require it. In **Settings → Rules → Rulesets → New branch ruleset**:

1. Target: the default branch (`main`).
2. Enable **Restrict deletions** and **Block force pushes**.
3. Enable **Require a pull request before merging** (0 approvals is fine while the founder works alone).
4. Enable **Require status checks to pass** and add the six check names from the table above. Turn on **Require branches to be up to date before merging**.

Until this is set, a red check is visible but does not technically stop a merge.

## 3. Dependency updates

- Dependabot opens weekly PRs (Monday) for npm packages, GitHub Actions (pinned SHAs) and the images in `compose.prod.yaml`.
- `cooldown: 7 days` matches pnpm's `minimumReleaseAge` (7 days), so freshly published versions, the usual window for a hijacked release, are never proposed.
- Major updates of `@types/node` are ignored: the types follow the Node runtime major (`.nvmrc`), and a Node major upgrade is an ADR decision.
- Each update PR must pass the full CI above before merging. Read the changelog for major versions.
- **PostgreSQL** appears in `compose.yaml`, `compose.prod.yaml`, `ci.yml` (two jobs), `infra/scripts/restore.sh` and `tests/smoke/backup.smoke.mjs`. The repo test that requires one PostgreSQL version everywhere fails until all of them match, so update them together in the same PR.
- **Node base image** (`ARG NODE_IMAGE` in both Dockerfiles) and the Node version in `.nvmrc` are not handled by Dependabot. Review monthly: pick the newest LTS patch image that is at least 7 days old, pin tag **and** digest, update both Dockerfiles, `.nvmrc` and `engines`.

## 4. Audit failures

- **Shipped dependency advisory:** upgrade to a patched version in the same PR. If no fix exists, the founder decides (remove the package, or accept the risk with a written note in `docs/decisions/DECISIONS.md` and a review date).
- **Dev-tooling advisory, moderate or lower:** reported but not blocking. Fix through the next Dependabot update.
- **Signature failure:** stop. Do not merge. Treat it as a possible supply-chain incident and check the package on the registry before doing anything else.
- **Registry error:** the job fails rather than passing silently. Re-run later.
