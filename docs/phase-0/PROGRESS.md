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

### P0-006 — API skeleton
- Commit SHA: lihat PR `feat/P00-006-api-skeleton`
- Changed files: `apps/api/src/{app.ts,main.ts}`, `apps/api/src/routes/health.ts`, `apps/api/src/lib/{errors.ts,request-id.ts,validation.ts}`, `apps/api/src/db/{readiness.ts,migrations-dir.ts,migrate.ts,migrate-cli.ts}`, `apps/api/tests/unit/app.test.ts`, `apps/api/tests/integration/{startup.test.ts,db.test.ts}`, `apps/api/package.json` (fastify 5.12.7, @fastify/rate-limit 11.2.1), `pnpm-lock.yaml`
- Perilaku:
  - Fastify app factory (`buildApp`), tanpa state global.
  - Error envelope stabil `{"error":{"code","message","requestId"}}` dengan pesan tetap per kode, tanpa stack trace atau detail internal.
  - JSON-only: `text/plain`/form → 415. Body > 16 KiB → 413. JSON rusak → 400 `INVALID_JSON`.
  - Validasi Zod lewat `parseOrThrow` (path + aturan saja, tanpa nilai).
  - Request ID: `X-Request-ID` dari luar dipakai hanya jika `[A-Za-z0-9_-]{8,64}`, selain itu dibuat baru (anti log injection). Dikirim balik di header dan body error.
  - Log pino: redaksi cookie/authorization/password/token/secret, path tanpa query string, body tidak pernah di-log.
  - Rate limit global per IP (default 300/menit) → 429 + `Retry-After`. `/health/ready` dikecualikan.
  - Header `nosniff` dan `cache-control: no-store`. `requestTimeout` 10 detik. `trustProxy: false` (diatur di P0-013). Graceful shutdown pada SIGTERM/SIGINT.
  - `/health/live` publik `{status:"ok"}`. `/health/ready` 200 hanya jika DB menjawab dan semua migrasi diterapkan tanpa perubahan, selain itu 503 `NOT_READY` tanpa detail.
- **Bug yang ditemukan dan diperbaiki:** `nalara_app` tidak punya akses baca ke `nalara_schema_migrations` (P0-005), sehingga `/health/ready` di produksi **selalu 503**. Runner kini memberi `SELECT` saja ke `nalara_app`. INSERT/UPDATE/DELETE tetap ditolak (dites).
- Juga diperbaiki: opsi Fastify `requestIdLogLabel` sudah deprecated di 5.12 → `logController`.
- Tests run:
  - `pnpm run check` (PostgreSQL 18.6) → PASS **104/104**, tanpa warning
  - TEST-API-01..10 via `app.inject`, plus proses nyata: start → `/health/live` 200 → `/health/ready` 503 tanpa DB → SIGTERM → exit 0
  - End-to-end compose: `/health/ready` **503 sebelum migrasi → 200 setelah `db:migrate`**. Header keamanan ada. 0 secret di log API. `.env` sementara dihapus
- Security review: PASS (anti log injection, redaksi, tanpa detail error, rate limit, JSON-only, least privilege tetap)
- Known issues: tidak ada endpoint fitur (sesuai guardrail). Proxy trust diatur di P0-013
- Founder decision: PENDING

### P0-007 — Founder bootstrap
- Commit SHA: lihat PR `feat/P00-007-founder-bootstrap`
- Changed files: `apps/api/src/cli/bootstrap-founder.ts`, `apps/api/src/modules/auth/{password.ts,founder.ts}`, `apps/api/src/modules/audit/audit.ts`, `apps/api/src/config/env.ts` (`loadBootstrapConfig`), `apps/api/tests/unit/password.test.ts`, `apps/api/tests/integration/bootstrap.test.ts`, `apps/api/package.json` (`@node-rs/argon2` 2.2.2, script `founder:bootstrap`), `README.md`
- Perilaku:
  - `FOUNDER_EMAIL=… pnpm --filter @nalara/api run founder:bootstrap` membuat **tepat satu** founder.
  - Password dibaca dari terminal tanpa echo (dua kali) atau dari stdin bila di-pipe. **Tidak pernah** dari argumen atau env.
  - Founder sudah ada → exit 2, tidak menimpa. `NODE_ENV=production` tanpa `--production` → exit 2.
  - Insert user + audit `founder.bootstrap` (actor `system`) dalam satu transaksi. Race antar bootstrap ditangkap unique index → `FounderExistsError`.
  - Kebijakan password: 12–128 code point, NFC, bukan whitespace saja, tidak mengandung nama email.
  - Argon2id `m=64 MiB, t=3, p=1` (parameter tersimpan di PHC string, bisa di-tune ulang di VPS, S-10).
  - Audit memakai allowlist metadata per action.
- Keputusan teknis: `@node-rs/argon2` dipilih karena tanpa install script dan punya binary prebuilt (termasuk musl/Alpine). `argon2` memakai node-gyp install script yang diblokir policy. `Algorithm.Argon2id` (const enum) ditulis sebagai nilai `2` dengan pengecualian lint satu baris, dan dijaga tes yang memeriksa prefix `$argon2id$`.
- Belum dikerjakan: cek password bocor (HIBP k-anonymity) butuh akses jaringan keluar dari server. Dicatat sebagai pertimbangan, tidak diimplementasikan di Phase 0
- Tests run: `pnpm run check` (PostgreSQL 18.6) → PASS **120/120**
  - Unit: TEST-AUTH-04/05/06/09 (policy, oversized, NFC vs NFD, format PHC dan parameter, salt unik, hash rusak → false)
  - Integrasi CLI nyata: password lemah → exit 1 tanpa baris DB · production tanpa flag → exit 2 · password sebagai argumen → exit 1 · bootstrap sukses → 1 user (`email` di-lowercase, hash `$argon2id$`, `mfa_enabled=false`) + 1 audit · **TEST-AUTH-10** bootstrap kedua → exit 2, jumlah baris dan hash tidak berubah · tidak ada route bootstrap/signup/register di API (404)
  - Password tidak muncul di stdout/stderr pada semua skenario
- Security review: PASS
- Founder decision: PENDING

### P0-010 — Session & CSRF
- Commit SHA: lihat PR `feat/P00-010-session-csrf`
- Changed files: `apps/api/src/modules/auth/{session.ts,csrf.ts}`, `apps/api/src/plugins/auth.ts`, `apps/api/src/routes/{auth.ts,os.ts}`, `apps/api/src/app.ts`, `apps/api/src/main.ts`, `apps/api/src/modules/audit/audit.ts` (`session.logout`), `apps/api/tests/integration/session.test.ts`, penyesuaian config di tes lama, `apps/api/package.json` (`@fastify/cookie` 11.1.5)
- Perilaku:
  - **Sesi**: token acak 256-bit (base64url, 43 karakter). DB hanya menyimpan SHA-256-nya. Umur absolut 8 jam, idle 1 jam. `last_seen_at` diperbarui maksimal sekali per menit. Revoke dan `rotateSession` (revoke lama + buat baru dalam satu transaksi, dipakai login di P0-008). Token salah format ditolak sebelum menyentuh DB.
  - **Cookie**: `__Host-nalara_session`, `HttpOnly`, `Secure`, `SameSite=Lax`, `Path=/`, tanpa `Domain`, `Expires` = umur absolut.
  - **`requireFounder`**: 401 tanpa atau dengan sesi tidak valid. DB tidak bisa dicek → **503, fail closed**.
  - **`/api/v1/os/*`**: guard dipasang di level plugin, jadi setiap route baru di prefix ini otomatis butuh founder.
  - **CSRF**: (1) guard global menolak semua method unsafe dari origin lain (berdasarkan `Origin`, atau `Sec-Fetch-Site` bila `Origin` tidak ada) sebelum routing, termasuk login nanti. (2) Mutasi terautentikasi wajib same-origin **dan** `X-CSRF-Token` = HMAC-SHA256(`SESSION_SECRET`, session id), dibandingkan timing-safe. Tanpa CORS (deny by default).
  - Route: `GET /api/v1/auth/me` (profil + CSRF token, tanpa secret), `POST /api/v1/auth/logout` (founder + CSRF → revoke, audit `session.logout`, cookie dihapus, 204), `GET /api/v1/os/ping`.
- Tests run: `pnpm run check` (PostgreSQL 18.6) → PASS **147/147**
  - TEST-SESSION-01..10: hash saja di DB · HttpOnly/Secure/SameSite/host-only · kedaluwarsa absolut + idle · revoke · logout dua kali (204 lalu 401, audit 1 baris) · 5 token rusak/palsu → 401 (bukan 500) · rotasi · DB mati → 503
  - TEST-CSRF-01..10: tanpa/salah token → 403 (sesi tetap hidup) · cross-origin → 403 sebelum routing · same-origin + token → 204 · `Sec-Fetch-Site: same-origin` diterima · beda port → 403 · GET logout → 404 · `text/plain` dengan body → 415 · token sesi lain → 403 · preflight tidak dapat header CORS · cross-site / tanpa header browser → 403
- Security review: PASS
- Catatan: TEST-CSRF-07 tanpa body diterima (204) karena origin dan token valid. Serangan form `text/plain` lintas situs sudah diblok oleh cek origin.
- Founder decision: PENDING

### P0-008 — Password login
- Commit SHA: lihat PR `feat/P00-008-password-login`
- Changed files: `db/migrations/0002_login_challenges_and_lockout.sql`, `apps/api/src/db/schema.ts`, `apps/api/src/modules/auth/login.ts`, `apps/api/src/routes/auth.ts`, `apps/api/src/app.ts`, `apps/api/src/lib/errors.ts` (`INVALID_CREDENTIALS`), `apps/api/src/modules/audit/audit.ts` (`auth.password`), `apps/api/tests/integration/{login.test.ts,db.test.ts}`
- Perilaku:
  - `POST /api/v1/auth/login {email, password}`: rate limit 10/menit/IP (lebih ketat dari global), ditolak bila cross-origin (login CSRF).
  - Email tak terdaftar, password salah, dan akun terkunci → **respons identik** (`401 INVALID_CREDENTIALS`) dan **biaya sama** (satu verifikasi Argon2, termasuk dummy hash untuk email tak dikenal).
  - Penghitung gagal per akun di DB, dinaikkan secara atomik di SQL. ≥ 5 kali → terkunci 15 menit (password benar pun ditolak). Login sukses mereset penghitung.
  - Sukses → **bukan sesi**, hanya challenge sekali pakai 5 menit (`__Host-nalara_challenge`, HttpOnly, Secure, SameSite=Strict). Scope `enrolment` bila MFA belum aktif, `mfa` bila sudah. Challenge lama yang belum terpakai dibatalkan.
  - Audit `auth.password` (success/failure/denied) tanpa password dan tanpa email yang dicoba.
- Migrasi 0002: tabel `login_challenges` (hash token, scope, expiry, used_at) + kolom `users.failed_login_attempts`, `users.locked_until`. Grant untuk `nalara_app`.
- Tests run: `pnpm run check` (PostgreSQL 18.6) → PASS **162/162**. `login.test.ts` dijalankan 3× berturut-turut, stabil
  - TEST-AUTH-01: cookie challenge saja (0 baris `sessions`), token tidak ada di body, challenge tidak berlaku sebagai sesi (401), scope `mfa` setelah MFA aktif, challenge lama dibatalkan, email case-insensitive
  - TEST-AUTH-02: 401 generik, penghitung +1 · TEST-AUTH-03: unknown = wrong (status, body, dan timing ≥ 40%) · TEST-AUTH-04: kosong → 400 · TEST-AUTH-05: 2000 karakter → 400, 500 karakter → 401 · TEST-AUTH-06: NFD ≡ NFC
  - TEST-AUTH-07: terkunci setelah 5 gagal, buka setelah expiry dan reset. Rate limit per IP → 429
  - TEST-AUTH-08: 8 percobaan paralel → `failure + denied = 8` dan penghitung = jumlah `failure` (tidak ada lost update)
  - TEST-AUTH-09: audit lengkap tanpa password atau email asing
- Catatan desain tes: TEST-AUTH-08 sengaja memeriksa invarian "tidak ada update yang hilang", bukan angka tetap, karena percobaan yang datang setelah akun terkunci memang tidak dihitung
- Security review: PASS
- Founder decision: PENDING

### P0-009 — MFA enrolment & recovery
- Commit SHA: lihat PR `feat/P00-009-mfa`
- Changed files: `db/migrations/0003_mfa_totp_and_recovery.sql`, `apps/api/src/db/schema.ts`, `apps/api/src/modules/auth/{totp.ts,secret-box.ts,recovery-codes.ts,mfa.ts}`, `apps/api/src/routes/auth.ts`, `apps/api/src/app.ts`, `apps/api/src/plugins/auth.ts`, `apps/api/src/lib/errors.ts` (`INVALID_CODE`), `apps/api/src/modules/audit/audit.ts`, `apps/api/tests/unit/totp.test.ts`, `apps/api/tests/integration/mfa.test.ts`, penyesuaian `login.test.ts`/`db.test.ts`/`support/database.ts`
- Perilaku (ADR-005):
  - **TOTP** RFC 6238 (SHA-1, 6 digit, 30 detik, ±1 step), ditulis dengan `node:crypto` tanpa dependensi baru. Secret 160-bit **dienkripsi AES-256-GCM** dengan `MFA_ENCRYPTION_KEY` dan **diikat ke user** (AAD), sehingga ciphertext yang dipindah ke baris lain tidak bisa dibuka.
  - `POST /api/v1/auth/mfa/setup`: hanya untuk challenge `enrolment`. Membuat secret baru (pending di challenge) dan mengembalikan secret base32 + `otpauth://` URI.
  - `POST /api/v1/auth/mfa/verify {code}|{recoveryCode}`:
    - Enrolment: kode pertama benar → secret dipindah ke `users`, `mfa_enabled`, 10 recovery code (ditampilkan sekali), sesi.
    - Login: TOTP atau recovery code → sesi.
    - Cookie challenge dihapus setelah sukses.
  - `POST /api/v1/auth/mfa/recovery-codes` (sesi + CSRF): rotasi, semua kode lama mati.
  - **Anti-replay dan race:** challenge dikonsumsi dengan `UPDATE … WHERE used_at IS NULL`, dan `totp_last_step` dimajukan secara kondisional. Penolakan di tengah transaksi me-rollback semuanya, jadi tidak ada recovery code yang hangus tanpa sesi.
  - Challenge mati setelah 5 kode salah. Rate limit 10/menit/IP. Semua kegagalan memakai `401 INVALID_CODE`.
  - Recovery code: 16 karakter base32 (80 bit), disimpan SHA-256, sekali pakai, tidak peka tanda hubung, spasi, atau huruf besar.
  - Constraint DB `users_mfa_requires_secret`: `mfa_enabled` tidak bisa true tanpa secret.
- Tests run: `pnpm run check` (PostgreSQL 18.6) → PASS **198/198**, **3× berturut-turut**
  - Unit: HOTP RFC 4226 (10 vektor), TOTP RFC 6238 (6 vektor), base32 RFC 4648 (6 vektor), otpauth URI, AES-GCM (kunci, owner, dan tamper ditolak), recovery code
  - TEST-MFA-01..10 + alur penuh (password → challenge → TOTP → sesi → logout), challenge `enrolment` tidak bisa akses `/os` atau verify tanpa setup, setup dari challenge `mfa` ditolak, challenge mati setelah 5 salah, **3 verifikasi paralel dengan kode benar → tepat 1 sesi**, rate limit → 429, audit hanya metadata `method`
- Ditemukan saat verifikasi:
  - (1) Tes lama yang menyalakan `mfa_enabled` tanpa secret kini ditolak constraint baru, dan tes disesuaikan.
  - (2) Helper tes: `ALTER ROLE` paralel dari banyak file tes bisa gagal `tuple concurrently updated`. Kini diserialkan dengan advisory lock.
- Security review: PASS
- Founder decision: PENDING

### P0-011 — Protected web shell
- Commit SHA: lihat PR `feat/P00-011-web-shell`
- Changed files: `apps/web/app/{layout.tsx,page.tsx,globals.css,error.tsx,not-found.tsx}`, `apps/web/app/os/{page.tsx,logout-button.tsx}`, `apps/web/app/os/login/{page.tsx,login-flow.tsx}`, `apps/web/lib/{tokens.ts,api.ts}`, `apps/web/proxy.ts`, `apps/web/next.config.ts`, `apps/web/tests/tokens.test.ts`, `tests/e2e/web.e2e.mjs`, `eslint.config.mjs`, `package.json` (`test:e2e`), `apps/web/package.json` (`server-only`)
- Perilaku:
  - `/`: placeholder publik.
  - `/os/login`: alur password → (pertama kali) aktivasi TOTP + recovery code sekali tampil → `/os`, atau (berikutnya) TOTP/recovery code → `/os`.
  - `/os`: server-side bertanya ke API `/auth/me` dengan meneruskan cookie (web tanpa kredensial DB, tanpa keputusan auth sendiri), lalu redirect ke login bila 401. Tombol keluar memakai CSRF token.
  - `proxy.ts` hanya redirect UX. **K-10 terverifikasi**: Next 16 menamai ulang `middleware` menjadi `proxy` (`middleware-to-proxy`).
  - Token brand dari satu sumber (`lib/tokens.ts` → CSS variables). Font sistem saja (tanpa file font berlisensi).
  - Aksesibilitas: `lang="id"`, skip link, fokus terlihat, label input, `role="alert"` untuk error, 320px, `prefers-reduced-motion`.
- Temuan:
  - `brass` (2.03) dan `sage` (1.81) **gagal AA di atas ivory**, jadi hanya dipakai di atas forest atau sebagai dekorasi (dijaga tes).
  - Rewrites `/api` di Next dievaluasi saat **build**. Di produksi `/api` dilayani Caddy (P0-013), jadi ini hanya penting untuk dev/e2e.
- Tests run:
  - `pnpm run check` (PostgreSQL 18.6) → PASS **208/208**: TEST-WEB-08 kontras 7 pasangan teks · TEST-WEB-09 tanpa `dangerouslySetInnerHTML`/`innerHTML`
  - `pnpm run test:e2e` (Chromium + API asli + build produksi web) → PASS **10/10**: TEST-WEB-01 landing (`lang=id`, tanpa `x-powered-by`) · 02 anonim → login · 03 login pertama + aktivasi MFA + 10 recovery code + `/os` + logout · 03b login berikutnya dengan TOTP · 04 cookie palsu → login (cek server-side, bukan proxy) · 05/07 Tab → skip link → email, outline fokus ≥ 2px, Enter submit · 06 tanpa scroll horizontal di 320px · 09 payload XSS tidak dieksekusi atau dirender · 10 API mati → halaman error tanpa detail internal · console browser bersih (kecuali laporan React minified yang memang diharapkan saat TEST-WEB-10)
- **Belum di CI:** e2e butuh Playwright dan Chromium. Dijalankan lokal sekarang, dan masuk CI di P0-014b.
- Security review: PASS
- Founder decision: PENDING

**Next ticket:** P0-012 — Compose topology (urutan D-02).
