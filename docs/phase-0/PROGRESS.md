# NALARA Phase 0 — Progress Log

Format mengikuti PRD §19 (Definition of done and evidence format).

### P0-001 — Repository reconnaissance
- Commit SHA: lihat PR `feat/P00-001-repo-baseline`
- Changed files: `docs/phase-0/BASELINE.md`, `docs/phase-0/ADR-PROPOSALS.md`, `docs/phase-0/PROGRESS.md`
- Tests run: perintah audit read-only (lihat `BASELINE.md` §9). Belum ada test suite karena belum ada kode
- Result: PASS (dokumen baseline lengkap: path, branch, versi runtime, gap, risiko)
- Security review: PASS (secret scan tanpa temuan, tanpa perubahan kode)
- Manual validation: NOT RUN (menunggu review founder)
- Known issues: migrasi `master` → `main` selesai (default branch `main`, `master` dihapus, protection dipasang founder; `BASELINE.md` §8). 16 konflik spesifikasi menunggu keputusan (`BASELINE.md` §4)
- Founder decision: ACCEPTED (2026-11-03, chat: "approve semua"; mencakup ADR-001..009 dan urutan tiket §6.1)

### P0-002 — Architecture decision records
- Commit SHA: lihat PR `feat/P00-002-adr`
- Changed files: `docs/adr/README.md`, `docs/adr/ADR-001..009-*.md`, `docs/decisions/DECISIONS.md`, `docs/prd/NALARA_Master_PRD_Full_Phases_0-9_v3.md` (setelah repo private), `docs/phase-0/ADR-PROPOSALS.md` (ditandai arsip), `docs/phase-0/PROGRESS.md`
- Tests run: validasi kelengkapan template PRD §17 di setiap ADR, validasi link relatif di `docs/**`, eksekusi SQL ADR-009 di `postgres:16-alpine`, secret scan (perintah dan hasil ada di deskripsi PR)
- Result: lihat deskripsi PR
- Security review: PASS (tanpa kode runtime, tanpa secret)
- Manual validation: NOT RUN (menunggu review founder)
- Known issues: D-04, D-07, D-08, D-09 masih OPEN (`docs/decisions/DECISIONS.md`). Repo sudah private (D-13) dan PRD sudah di-commit (D-05)
- Founder decision: PENDING

### P0-003 — Workspace scaffold
- Commit SHA: lihat PR `feat/P00-003-workspace-scaffold`
- Changed files: root `package.json`, `pnpm-lock.yaml`, `pnpm-workspace.yaml`, `tsconfig.base.json`, `tsconfig.json`, `eslint.config.mjs`, `.prettierrc.json`, `.prettierignore`, `vitest.config.ts`, `.gitignore`, `.dockerignore`, `.editorconfig`, `.nvmrc`, `README.md` · `apps/web/{package.json,next.config.ts,tsconfig.json,app/layout.tsx,app/page.tsx}` · `apps/api/{package.json,tsconfig.json,tsconfig.build.json,src/index.ts}` · `tests/repo/repo.test.ts`
- Tests run (Node 24.22.2, pnpm 12.16.1):
  - `pnpm run format:check` → PASS
  - `pnpm run lint` → PASS (setelah 1 temuan nyata di kode tes diperbaiki)
  - `pnpm run typecheck` → PASS (root, api, web)
  - `pnpm run test` → PASS 14/14
  - `pnpm run build` → PASS (api `tsc`, web `next build`)
  - TEST-REPO-09: clone bersih → `pnpm install --frozen-lockfile` → `pnpm run check` → PASS, worktree tetap bersih
- Negative tests (harus gagal, dan memang gagal): `.env.production` ter-track → TEST-REPO-05 FAIL · versi `^19.3.1` → TEST-REPO-03 FAIL · type error → `TS2322` · floating promise → `no-floating-promises` · install di Node 22 → `ERR_PNPM_UNSUPPORTED_ENGINE` (dengan `engineStrict`) · vitest di Node 22 → TEST-REPO-04 FAIL · dependensi dengan `postinstall` (esbuild, di folder probe terpisah) → `ERR_PNPM_IGNORED_BUILDS`
- Security review: PASS. Tanpa secret. Script install dependensi diblokir. Hanya versi ≥ 7 hari (`minimumReleaseAge: 10080`, tanpa exclusion). Semua versi dipin persis
- Manual validation: NOT RUN (menunggu review founder)
- Keputusan versi dan penyimpangan:
  - Node **24.22.2** (patch D-10). Node 24 masih membawa Corepack, jadi K-09 aman untuk Node 24 (diverifikasi).
  - pnpm **12.16.1**.
  - **TypeScript 6.0.3**, bukan 7.0.2 (`latest`), karena `typescript-eslint@8.72.1` mensyaratkan `typescript >=4.8.4 <6.1.0`.
  - Next.js **16.4.3**, bukan 16.4.4, karena 16.4.4 baru dirilis kurang dari 7 hari (begitu juga `vitest 5.0.5` dan `eslint 10.13.0`).
  - `packages/contracts` dan `packages/ui` belum dibuat (guardrail "avoid excessive shared packages"). Dibuat saat pertama dipakai (P0-006/P0-011).
- Known issues: K-10 (nama file `middleware.ts` vs `proxy.ts` di Next 16) diverifikasi di P0-011. Telemetri Next.js aktif secara default (cara mematikan ada di README)
- Founder decision: PENDING

### P0-014a — CI baseline
- Commit SHA: lihat PR `feat/P00-014a-ci-baseline`
- Changed files: `.github/workflows/ci.yml`, `tests/repo/ci.test.ts`, `docs/phase-0/PROGRESS.md`
- Isi workflow: job `check` (install `--frozen-lockfile` → format → lint → typecheck → test → build, Node dari `.nvmrc`, pnpm via Corepack) dan job `secret-scan` (gitleaks 8.30.1, checksum SHA-256 diverifikasi, scan seluruh riwayat). `permissions: contents: read`, `persist-credentials: false`, trigger `pull_request` + `push` ke `main`, tanpa `pull_request_target`
- Action dipin SHA: `actions/checkout` v7.0.1 `3d3c42e5aac5ba805825da76410c181273ba90b1` · `actions/setup-node` v7.1.0 `949feb2413d6458794dcd2491c4babbbce0c15c1` (keduanya ≥ 7 hari)
- Tests run (lokal):
  - `actionlint 1.7.12` (binary, checksum diverifikasi) → PASS (0 temuan)
  - `pnpm run check` → PASS, **21/21** tes (7 tes baru untuk hardening workflow)
  - `gitleaks git` ke seluruh riwayat repo → `no leaks found` (10 commit)
- Negative tests: action tanpa pin SHA + `pull_request_target` + `contents: write` → 3 tes ✗ · token GitHub palsu di repo probe → gitleaks `leaks found: 1`, exit 1
- CI di GitHub: lihat status check di PR (diverifikasi setelah run selesai)
- Security review: PASS (token read-only, kredensial checkout tidak disimpan, tanpa action pihak ketiga selain milik `actions/*`, binary gitleaks diverifikasi checksum)
- Known issues: required status check di branch protection `main` harus ditambahkan founder (Settings), karena tidak bisa dari sesi ini. Uji "CI merah pada kode rusak" di GitHub dilakukan di P0-014b
- Founder decision: PENDING

### P0-004 — Environment validation
- Commit SHA: lihat PR `feat/P00-004-env-validation`
- Changed files: `apps/api/src/config/env.ts`, `apps/api/src/main.ts` (menggantikan placeholder `index.ts`), `apps/api/tests/unit/env.test.ts`, `apps/api/tests/integration/startup.test.ts`, `apps/api/{package.json,tsconfig.json}`, `.env.example`, `pnpm-lock.yaml` (zod 4.6.7), `docs/phase-0/PROGRESS.md`
- Perilaku:
  - `loadConfig()` bertipe (Zod) dan fail-fast. Semua masalah dilaporkan sekaligus, dan pesannya hanya memuat **nama variabel + aturan**, tidak pernah nilainya.
  - `NODE_ENV` wajib (tanpa default, supaya produksi tidak diam-diam berjalan sebagai dev).
  - Production lebih ketat: `APP_BASE_URL` wajib https, cookie wajib `__Host-`, `LOG_LEVEL` debug/trace ditolak. Di dev, http hanya boleh untuk localhost.
  - `SESSION_SECRET` ≥ 32 karakter. `MFA_ENCRYPTION_KEY` = base64 tepat 32 byte. Nilai placeholder (`REPLACE_WITH_…`) ditolak.
  - Penjaga typo: variabel tak dikenal dengan prefix NALARA (`SESSION_`, `DATABASE_`, `MFA_`, …) ditolak.
  - `describeConfig()` untuk log startup: secret jadi `[REDACTED]`, kredensial DB dihapus.
  - API bisa dijalankan langsung dari TypeScript (`node src/main.ts`, type stripping Node 24) dan dari build (`node dist/main.js`). `erasableSyntaxOnly` + `rewriteRelativeImportExtensions` aktif.
- Tests run:
  - `pnpm run check` → PASS, **58/58** (TEST-ENV-01..10 + startup integration)
  - `node dist/main.js` dengan env produksi valid → exit 0, log ter-redaksi. Dengan env produksi salah → exit 1, 4 masalah dilaporkan tanpa nilai
  - gitleaks `dir` ke `apps`, `tests`, `.env.example` → temuan hanya di `apps/web/.next/**` (output build Next, gitignored, tidak di-commit). Source bersih
- Security review: PASS (tanpa secret nyata. Fixture tes sengaja berentropi rendah)
- Known issues: `API_BASE_URL` belum divalidasi karena itu milik `apps/web` (P0-011). `FOUNDER_EMAIL` divalidasi oleh bootstrap CLI (P0-007)
- Founder decision: PENDING

### P0-005 — Database & migrations
- Commit SHA: lihat PR `feat/P00-005-db-migrations`
- Changed files: `db/migrations/0001_identity_and_audit.sql`, `db/init/01-roles.sh`, `db/README.md`, `compose.yaml` (service `db` saja), `apps/api/src/db/{migrate.ts,migrate-cli.ts,client.ts,schema.ts}`, `apps/api/src/config/env.ts` (`DATABASE_MIGRATOR_URL`, `loadMigratorConfig`, typo guard baru), `apps/api/tests/{integration/db.test.ts,support/database.ts,unit/env.test.ts}`, `.github/workflows/ci.yml` (service PostgreSQL), `tests/repo/ci.test.ts`, `.env.example`, `docs/adr/ADR-010-sql-first-migrations.md`, `docs/adr/{README.md,ADR-003…}`, `docs/decisions/DECISIONS.md` (D-14, D-15)
- Keputusan:
  - PostgreSQL **18.6** (`postgres:18.6-alpine3.24@sha256:10a5c69a…`, sama persis di compose dan CI, dijaga tes). ID memakai `uuidv7()` bawaan PG 18.
  - **ADR-010** (didelegasikan, D-15): migrasi SQL tulis tangan + runner checksum sendiri. Drizzle ORM hanya untuk query. Alasan: drizzle-kit membawa esbuild/tsx/loader deprecated, dan migrator Drizzle tidak menolak file yang diedit atau dihapus.
- **Temuan saat verifikasi:** penjaga typo berbasis prefix dari P0-004 menolak variabel platform `SESSION_INGRESS_URL` di cloud session. Ini bisa terjadi juga di VPS/CI. Diganti dengan deteksi *near-miss* (edit distance ≤ 2 untuk nama ≥ 8 karakter, atau beda huruf besar/kecil). Diuji tanpa false positive terhadap 175 variabel env nyata. `RESERVED_ENV_PREFIXES` dihapus.
- Tests run:
  - `pnpm run check` dengan PostgreSQL 18.6 → PASS, **85/85** (19 tes DB: TEST-DB-01..10 + concurrency + drift)
  - Tanpa DB secara lokal → 18 tes DB di-skip dengan jelas. Dengan `CI=true` tanpa DB → **FAIL** (tidak ada skip diam-diam di CI)
  - Database tes sisa setelah run: 0
  - Jalur compose: `docker compose config` valid → `up -d db` healthy → `db:status` (pending, exit 1) → `db:migrate` → `db:migrate` lagi (no-op) → `db:status` (up to date). Grant `nalara_app` pada `audit_events` = `INSERT,SELECT`. Port hanya `127.0.0.1:5432`. Password salah → log `code 28P01` tanpa URL/password
  - `actionlint` → PASS
- Security review: PASS. Least privilege dites (`UPDATE`/`DELETE`/`TRUNCATE` audit → 42501, DDL oleh app → 42501, bookkeeping migrasi tidak terbaca oleh app). Error driver tidak di-log mentah. Kredensial hanya placeholder
- Known issues: role DB produksi dibuat manual di VPS (didokumentasikan di `db/README.md`), dan dikerjakan bersama P0-012/013
- Founder decision: PENDING

**Next ticket:** P0-006 — API skeleton (urutan D-02).
