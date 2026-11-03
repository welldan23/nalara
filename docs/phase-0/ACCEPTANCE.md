# NALARA — Phase 0 Acceptance Report

**Status: SIAP DITINJAU FOUNDER.** Fondasi lokal dan CI lengkap serta terbukti. Gate yang butuh VPS, domain, dan backup offsite masih **NOT RUN** karena menunggu keputusan founder (D-04, D-08, D-09). Detailnya ada di §6.

> **Phase 1 diblokir** sampai founder menulis persis: **PHASE 0 ACCEPTED**. Tidak ada pekerjaan Phase 1 yang dimulai otomatis.

- Tanggal audit: 2026-11-03 (UTC)
- Commit dasar yang diaudit: `main` @ `4a64b72` (setelah PR #16), ditambah perubahan PR P0-016 ini
- Status yang dipakai:
  - **PASS**: dijalankan dan lulus
  - **PASS (lokal)**: lulus di rehearsal lokal (CA lokal, Docker lokal), belum di VPS
  - **NOT RUN**: tidak dijalankan, alasannya ditulis
  - **FAIL**: dijalankan dan gagal (saat ini tidak ada)

## 1. Ringkasan

| Area | Hasil |
|---|---|
| Matriks tes PRD (130 kasus) | **129 PASS** (7 di antaranya dengan catatan lokal/statis/container) · **1 NOT RUN** (TEST-OPS-09, butuh VPS) · **0 FAIL** |
| Gate sign-off founder (PRD §12, 15 butir) | 12 PASS · 1 NOT RUN (HTTPS di lingkungan deploy) · 2 menunggu founder (review ADR, tulisan PHASE 0 ACCEPTED) |
| Deploy gate (PRD §9.3) | Semua PASS di rehearsal lokal. Deploy nyata ke domain: NOT RUN (sengaja, sesuai aturan PRD) |
| CI merah saat kode rusak | **Terbukti** di 6 jenis kerusakan (§3) |
| Risiko terbuka | 11 risiko tercatat, tidak ada yang Kritis untuk pemakaian lokal (§6) |

## 2. Bukti eksekusi (dijalankan untuk audit ini)

Semua perintah di bawah benar-benar dijalankan. Lingkungannya Linux, Node 24.22.2, pnpm 12.16.1, PostgreSQL 18.6 (container), Docker 29.9.2, Chromium (Playwright 1.63.0), dan age 1.1.1.

| # | Perintah | Hasil |
|---|---|---|
| E-1 | Clone bersih `main` (4a64b72) → `pnpm install --frozen-lockfile` → `pnpm run check` (dengan DB) | **PASS** 223/223 tes. Build web sukses. `git status` tetap bersih (0 file) |
| E-2 | `pnpm run check` di branch P0-016 (dengan DB) | **PASS** 226/226 (§2.1) |
| E-3 | `pnpm run test:e2e` | **PASS** 10/10 |
| E-4 | `pnpm run test:compose` (image produksi baru di-build dari tree ini, `SMOKE_SKIP_BUILD=1`) | **PASS** 15/15 (TEST-COMPOSE-01..10, TEST-OPS-01..04, bootstrap founder, backup ke DB produksi) |
| E-5 | `pnpm run test:backup` | **PASS** 10/10 |
| E-6 | CI GitHub Actions di PR #16 (head `869184c`) | **PASS** 6/6 job: check, supply-chain, e2e, compose-smoke, backup-smoke, gitleaks |
| E-7 | CI GitHub Actions di PR P0-016 ini | Lihat status check PR (wajib hijau sebelum merge) |
| E-8 | `pnpm audit --prod --audit-level low` | 0 advisory di dependensi produksi |
| E-9 | `pnpm audit signatures` | 358/358 paket bertanda tangan valid |

### 2.1 Jumlah tes di `pnpm run check`

E-2: **226/226** tes di 14 file (unit, integrasi PostgreSQL asli, aturan repo, token web), ditambah build produksi web dan API.

## 3. Bukti CI memblokir kode rusak (TEST-CI-01..06)

Draft PR **#17** (ditutup, tidak di-merge) berisi satu jenis kerusakan per commit. Setiap ronde mengembalikan kerusakan ronde sebelumnya, jadi tiap ronde menguji tepat satu hal.

| Ronde | Kerusakan yang disengaja | Run Actions | Hasil |
|---|---|---|---|
| 1 | `debugger;` di kode API + judul landing diubah | `41661077328` | **check FAIL di Lint** (`errors.ts 68:3 no-debugger`); **e2e FAIL** TEST-WEB-01 "headline missing" (9/10). Job lain hijau |
| 2 | Type error (`string` ke `number`) | `41661638869` | **check FAIL di Typecheck** (`totp.ts(17,3) TS2322`); compose FAIL (build image API ikut menjalankan `tsc`) |
| 3 | Bug base32 di level unit | `41661932335` | **check FAIL di Test** (`unit/totp.test.ts:70`, vektor RFC 4648). e2e tetap lulus karena secret 20 byte tidak kena bug ini: hanya unit test yang menangkapnya |
| 4 | Off-by-one di SQL lockout | `41662496306` | **check FAIL di Test** (`integration/login.test.ts:219`, TEST-AUTH-07 melawan PostgreSQL asli) |
| 5 | `'use client'` di layout yang mengekspor `metadata` | `41662948517` | **check FAIL di Build** (format/lint/typecheck/test lulus); e2e dan compose juga FAIL saat `next build` |
| 6 | Dependensi ditambah tanpa update lockfile | `41663349960` | **ERR_PNPM_OUTDATED_LOCKFILE** di semua job yang install (check, supply-chain, e2e, compose, backup) |

Run pertama juga menemukan **dua bug nyata di job CI baru**: backup-smoke kurang `pnpm install`, dan compose smoke crash setelah build image. Satu lagi muncul di run berikutnya: `age` belum ter-install untuk cek runbook. Ketiganya diperbaiki di PR #16 sebelum merge. Jadi CI hijau sekarang memang berarti suite-nya jalan sampai selesai.

## 4. Checklist sign-off founder (PRD §12)

| # | Gate | Status | Bukti |
|---|---|---|---|
| 1 | Arsitektur/ADR ditinjau dan disetujui | **Menunggu founder** (ADR-001..010 disetujui lewat D-01 "approve semua"; ADR-010 dan dokumen arsitektur/threat model baru perlu dibaca) | [ADR](../adr/README.md), [arsitektur](../architecture/phase-0.md), [threat model](../security/threat-model.md) |
| 2 | Tidak ada fitur Phase 1 | **PASS** | Endpoint hanya health, auth, MFA, `os/ping` ([arsitektur §4](../architecture/phase-0.md)). Tanpa CMS, ingestion, Hermes, Telegram |
| 3 | Setup dari clone bersih berhasil | **PASS** | E-1 |
| 4 | Migrasi jalan di DB kosong dan setelah restart | **PASS** | TEST-DB-01/02 (`db.test.ts`), TEST-COMPOSE (`migrate` di stack produksi), restore drill (TEST-BACKUP-05) |
| 5 | Bootstrap founder aman dan sekali saja | **PASS** | TEST-AUTH-10 (`bootstrap.test.ts`), RUNBOOK di compose smoke (bootstrap kedua exit 2) |
| 6 | MFA jalan, recovery teruji, tanpa enumerasi akun | **PASS** | TEST-MFA-01..10, TEST-AUTH-03, TEST-WEB-03/03b |
| 7 | Akses anonim ke `/os` dan `/api/v1/os/ping` ditolak | **PASS** | TEST-WEB-02 (redirect), TEST-SESSION-* (401 di API) |
| 8 | Cookie flags, CSRF, rate limit, pencabutan sesi teruji | **PASS** | TEST-SESSION-01..10, TEST-CSRF-01..10, TEST-API-10, TEST-AUTH-07/08 |
| 9 | DB tidak bisa diakses publik; tidak ada secret plaintext di repo | **PASS** | TEST-COMPOSE-02, TEST-OPS-04/05 (lokal), gitleaks seluruh histori, TEST-REPO-05 |
| 10 | CI lint/typecheck/unit/integration/build lulus | **PASS** | E-6, §3 |
| 11 | Backup dibuat, terenkripsi, dan di-restore ke DB terisolasi | **PASS** (lokal). Offsite **NOT RUN** (D-04) | TEST-BACKUP-01..10, E-5 |
| 12 | Reverse proxy HTTPS tervalidasi di lingkungan deploy | **NOT RUN**: belum ada VPS/domain (D-08, D-09). Rehearsal CA lokal PASS | TEST-OPS-01..04 (lokal), [deploy-vps.md](../runbooks/deploy-vps.md) |
| 13 | Log meredaksi secret dan memuat request ID | **PASS** | TEST-ENV-07/08, TEST-API-07/08, TEST-OPS-03 (log Caddy tanpa cookie) |
| 14 | `ACCEPTANCE.md` memuat bukti perintah dan risiko | **PASS** | Dokumen ini |
| 15 | Founder menulis **PHASE 0 ACCEPTED** | **Menunggu founder** | — |

## 5. Deploy gate (PRD §9.3)

| Gate | Status | Bukti |
|---|---|---|
| Sertifikat TLS valid, HTTP → HTTPS, header keamanan | PASS (lokal) | TEST-OPS-01..03 dengan CA lokal Caddy |
| Cookie produksi `Secure` + `HttpOnly`; trust proxy eksplisit | PASS | TEST-SESSION-02..04, `TRUSTED_PROXIES` = IP tetap Caddy (`app.test.ts`) |
| Tanpa port Postgres publik atau route admin dev | PASS (lokal) | TEST-COMPOSE-02, TEST-OPS-04 |
| Migrasi sebagai langkah deploy eksplisit sebelum trafik | PASS | Service `migrate` (profile `tools`), runbook deploy §3 |
| Backup aktif + bukti restore tercatat | PASS (lokal), offsite NOT RUN | TEST-BACKUP-*, §3 di atas |
| Restart policy, resource limit, alert disk, rotasi log terdokumentasi | PASS | `compose.prod.yaml` (`unless-stopped`, `mem_limit`, `json-file` 10 MB × 3), `check-disk.sh`, [incident.md](../runbooks/incident.md) |
| Jangan deploy ke domain live sebelum founder konfirmasi DNS dan VPS | **Dipatuhi** | Belum ada deploy |

## 6. Risiko dan item terbuka

| ID | Risiko / item | Severity | Owner | Remediasi |
|---|---|---|---|---|
| R-01 | **Belum ada backup offsite** (D-04). Server hilang berarti backup ikut hilang | Tinggi (produksi) | Founder: pilih tujuan + pemegang kredensial | Tambah upload terenkripsi ke tujuan pilihan, lalu uji restore dari offsite |
| R-02 | **Deploy VPS, TLS publik, UFW, SSH belum diuji** (TEST-OPS-09, sebagian OPS-01..08) | Tinggi (produksi) | Founder: D-08 (VPS + domain), D-09 (deploy di Phase 0 atau tidak) | Jalankan [deploy-vps.md](../runbooks/deploy-vps.md) §0–4, catat hasilnya di sini |
| R-03 | **Required status checks belum dipasang.** CI merah terlihat tapi tidak memblokir merge secara teknis | Sedang | Founder (butuh akses admin repo) | Ruleset `main` + 6 status check ([ci-and-dependencies.md](../runbooks/ci-and-dependencies.md) §2) |
| R-04 | CSP masih `'unsafe-inline'` (kebutuhan Next.js) | Sedang | Claude, Phase 8 | CSP berbasis nonce |
| R-05 | Belum ada CLI break-glass atau reset password founder. Jalur darurat hanya SQL dari shell server (teruji otomatis) | Sedang | Claude, tiket lanjutan | CLI `founder:reset-mfa` / `founder:reset-password` yang hanya jalan di server, dengan audit |
| R-06 | Lockout akun bisa dipicu penyerang (DoS 15 menit ke founder) | Rendah | — | Diterima untuk Phase 0. Tinjau ulang bila ada serangan nyata (mis. lockout per IP + akun) |
| R-07 | 1 advisory moderate di tooling dev (`minimatch` lewat ESLint). Tidak ikut dikirim ke produksi | Rendah | Dependabot | Hilang saat ESLint versi berikutnya lolos cooldown 7 hari |
| R-08 | Base image Node (`ARG NODE_IMAGE`) tidak di-update Dependabot | Rendah | Founder/Claude, bulanan | Review manual ([ci-and-dependencies.md](../runbooks/ci-and-dependencies.md) §3) |
| R-09 | Parameter Argon2id (64 MiB, t=3, p=1) belum di-tuning di VPS nyata (PRD §6.1) | Rendah | Saat deploy | Ukur waktu hash di VPS, target sekitar 0,5 detik |
| R-10 | Belum ada cek password bocor (breached-password). Minimal 12 karakter sudah wajib | Rendah | Tiket lanjutan | Cek k-anonymity offline atau daftar lokal, tanpa mengirim password ke pihak ketiga |
| R-11 | Repo sempat publik sekitar 1 jam (D-13). Isinya tanpa secret | Rendah | — | Sudah private. Tidak ada secret yang perlu dirotasi |

Pertanyaan lama yang belum dijawab: hapus salinan PRD duplikat di root repo (`NALARA_Master_PRD_Full_Phases_0-9_v3.md`, isinya identik dengan `docs/prd/`)?

## 7. Inventaris environment variable (nama saja)

| Nama | Dipakai oleh | Wajib |
|---|---|---|
| `NODE_ENV` | api | Ya |
| `APP_BASE_URL` | api, web | Ya (https di produksi) |
| `API_BASE_URL` | web (server-side) | Ya |
| `DATABASE_URL` | api (role `nalara_app`) | Ya |
| `DATABASE_MIGRATOR_URL` | migrate (role `nalara_migrator`) | Untuk migrasi |
| `SESSION_SECRET` | api (HMAC token CSRF) | Ya |
| `SESSION_COOKIE_NAME` | api | Opsional (`__Host-` di produksi) |
| `MFA_ENCRYPTION_KEY` | api (AES-256-GCM secret TOTP) | Ya. **Backup offline** |
| `LOG_LEVEL` | api | Opsional (debug/trace ditolak di produksi) |
| `PORT` | api | Opsional |
| `TRUSTED_PROXIES` | api | Diset oleh `compose.prod.yaml` |
| `FOUNDER_EMAIL` | CLI bootstrap saja | Sekali pakai |
| `BACKUP_DESTINATION` | cadangan untuk offsite (D-04) | Belum dipakai |
| `POSTGRES_PASSWORD`, `DB_MIGRATOR_PASSWORD`, `DB_APP_PASSWORD` | db / Compose | Ya |
| `SITE_ADDRESS`, `CADDY_TLS` | caddy | Ya |
| `AGE_RECIPIENTS_FILE`, `BACKUP_DIR`, `MAX_AGE_HOURS`, `MAX_USED_PERCENT` | script ops (`infra/scripts`) | Untuk cron |

Nilai asli hanya ada di `/srv/nalara/.env` (mode 0600) di server. API menolak start bila variabel wajib hilang atau tidak valid, nama variabel salah ketik (mirip nama yang dikenal), atau nilainya masih placeholder `REPLACE_WITH_` (TEST-ENV-01..10).

## 8. Serah terima (handoff)

- **Setup dan perintah:** [README](../../README.md)
- **Keputusan:** [ADR-001..010](../adr/README.md) · [register keputusan founder](../decisions/DECISIONS.md) (D-04, D-07, D-08, D-09 masih OPEN)
- **Arsitektur dan keamanan:** [arsitektur Phase 0](../architecture/phase-0.md) · [threat model](../security/threat-model.md) · [SECURITY.md](../../SECURITY.md)
- **Runbook:** [deploy VPS](../runbooks/deploy-vps.md) · [backup & restore](../runbooks/backup-restore.md) · [insiden & rollback](../runbooks/incident.md) · [CI & dependensi](../runbooks/ci-and-dependencies.md)
- **Riwayat per tiket:** [PROGRESS.md](PROGRESS.md)

### Permintaan sign-off

Founder, mohon tinjau §4 dan §6. Lalu pilih salah satu:

1. Terima fondasi ini dengan gate produksi R-01/R-02 tetap terbuka (deploy nyata menunggu D-04/D-08/D-09): tulis **PHASE 0 ACCEPTED**.
2. Minta deploy VPS dikerjakan dulu di Phase 0: putuskan D-08 dan D-09, lalu laporan ini diperbarui dengan hasil TEST-OPS di VPS.

Sampai salah satunya terjadi, tidak ada pekerjaan Phase 1.

## 9. Matriks tes lengkap (PRD §14, 130 kasus)

Kolom bukti menyebut file tes dan suite yang menjalankannya: `check` = `pnpm run check` (unit + integrasi DB), `e2e` = `pnpm run test:e2e`, `compose` = `pnpm run test:compose`, `backup` = `pnpm run test:backup`. Semua suite ini juga jalan di CI pada setiap PR.

#### API

| ID | Kasus | Status | Bukti |
|---|---|---|---|
| TEST-API-01 | public liveness | PASS | `unit/app.test.ts` (check) |
| TEST-API-02 | private readiness | PASS | `unit/app.test.ts` (check) |
| TEST-API-03 | unknown route | PASS | `unit/app.test.ts` (check) |
| TEST-API-04 | invalid JSON | PASS | `unit/app.test.ts` (check) |
| TEST-API-05 | oversized payload | PASS | `unit/app.test.ts` (check) |
| TEST-API-06 | invalid schema | PASS | `unit/app.test.ts` (check) |
| TEST-API-07 | request ID generation | PASS | `unit/app.test.ts` (check) |
| TEST-API-08 | request ID propagation | PASS | `unit/app.test.ts` (check) |
| TEST-API-09 | no stack traces | PASS | `unit/app.test.ts` (check) |
| TEST-API-10 | rate limit response | PASS | `unit/app.test.ts` (check) |

#### AUTH

| ID | Kasus | Status | Bukti |
|---|---|---|---|
| TEST-AUTH-01 | valid password | PASS | `integration/login.test.ts` (check) |
| TEST-AUTH-02 | wrong password | PASS | `integration/login.test.ts` (check) |
| TEST-AUTH-03 | unknown account | PASS | `integration/login.test.ts` (check) |
| TEST-AUTH-04 | empty password | PASS | `integration/login.test.ts`, `unit/password.test.ts` (check) |
| TEST-AUTH-05 | oversized password | PASS | `integration/login.test.ts`, `unit/password.test.ts` (check) |
| TEST-AUTH-06 | unicode password | PASS | `integration/login.test.ts`, `unit/password.test.ts` (check) |
| TEST-AUTH-07 | rapid failures | PASS | `integration/login.test.ts` (check) |
| TEST-AUTH-08 | parallel login attempts | PASS | `integration/login.test.ts` (check) |
| TEST-AUTH-09 | hash verification | PASS | `integration/login.test.ts`, `unit/password.test.ts` (check) |
| TEST-AUTH-10 | bootstrap once | PASS | `integration/bootstrap.test.ts` (check) |

#### BACKUP

| ID | Kasus | Status | Bukti |
|---|---|---|---|
| TEST-BACKUP-01 | backup created | PASS | `tests/smoke/backup.smoke.mjs` (backup) |
| TEST-BACKUP-02 | backup encrypted | PASS | `tests/smoke/backup.smoke.mjs` (backup) |
| TEST-BACKUP-03 | wrong key rejected | PASS | `tests/smoke/backup.smoke.mjs` (backup) |
| TEST-BACKUP-04 | restore isolated | PASS | `tests/smoke/backup.smoke.mjs` (backup) |
| TEST-BACKUP-05 | restore schema | PASS | `tests/smoke/backup.smoke.mjs` (backup) |
| TEST-BACKUP-06 | restore data | PASS | `tests/smoke/backup.smoke.mjs` (backup) |
| TEST-BACKUP-07 | corrupted archive rejected | PASS | `tests/smoke/backup.smoke.mjs` (backup) |
| TEST-BACKUP-08 | retention pruning dry run | PASS | `tests/smoke/backup.smoke.mjs` (backup) |
| TEST-BACKUP-09 | permissions 0600 | PASS | `tests/smoke/backup.smoke.mjs` (backup) |
| TEST-BACKUP-10 | backup missing alert | PASS | `tests/smoke/backup.smoke.mjs`, `infra/scripts/check-backup-age.sh` (backup) |

#### CI

| ID | Kasus | Status | Bukti |
|---|---|---|---|
| TEST-CI-01 | lint failure blocks | PASS | Bukti merah PR #17 ronde 1 (§3) + `tests/repo/ci.test.ts` |
| TEST-CI-02 | type error blocks | PASS | Bukti merah PR #17 ronde 2 (§3) |
| TEST-CI-03 | unit failure blocks | PASS | Bukti merah PR #17 ronde 3 (§3) |
| TEST-CI-04 | integration failure blocks | PASS | Bukti merah PR #17 ronde 4 (§3) |
| TEST-CI-05 | build failure blocks | PASS | Bukti merah PR #17 ronde 5 (§3) |
| TEST-CI-06 | lockfile mismatch blocks | PASS | Bukti merah PR #17 ronde 6 (§3) |
| TEST-CI-07 | secret scan warning | PASS | Job gitleaks (checksum terverifikasi, seluruh histori) + `tests/repo/ci.test.ts` |
| TEST-CI-08 | dependency audit | PASS | Job `supply-chain` (`pnpm audit` + signatures) + `tests/repo/ci.test.ts` |
| TEST-CI-09 | cache correctness | PASS | Tanpa cache CI sama sekali (`package-manager-cache: false`); tiap job install dari lockfile beku, jadi tidak ada cache basi |
| TEST-CI-10 | PR workflow scope | PASS | Tanpa `pull_request_target`, token read-only: `tests/repo/ci.test.ts` |

#### COMPOSE

| ID | Kasus | Status | Bukti |
|---|---|---|---|
| TEST-COMPOSE-01 | config valid | PASS | `tests/smoke/compose.smoke.mjs` (compose) |
| TEST-COMPOSE-02 | private DB network | PASS | `tests/repo/ci.test.ts`, `tests/smoke/compose.smoke.mjs` (check, compose) |
| TEST-COMPOSE-03 | nonroot app user | PASS | `tests/smoke/compose.smoke.mjs` (compose) |
| TEST-COMPOSE-04 | no latest tags | PASS | `tests/repo/ci.test.ts` (check) |
| TEST-COMPOSE-05 | healthcheck | PASS | `tests/smoke/compose.smoke.mjs` (compose) |
| TEST-COMPOSE-06 | restart policy | PASS | `tests/repo/ci.test.ts`, `tests/smoke/compose.smoke.mjs` (check, compose) |
| TEST-COMPOSE-07 | container stop | PASS | `tests/smoke/compose.smoke.mjs` (compose) |
| TEST-COMPOSE-08 | container restart | PASS | `tests/smoke/compose.smoke.mjs` (compose) |
| TEST-COMPOSE-09 | read-only mounts | PASS | `tests/smoke/compose.smoke.mjs` (compose) |
| TEST-COMPOSE-10 | no secrets in image | PASS | `tests/smoke/compose.smoke.mjs` (compose) |

#### CSRF

| ID | Kasus | Status | Bukti |
|---|---|---|---|
| TEST-CSRF-01 | missing token | PASS | `integration/session.test.ts` (check) |
| TEST-CSRF-02 | invalid token | PASS | `integration/session.test.ts` (check) |
| TEST-CSRF-03 | cross-origin POST | PASS | `integration/session.test.ts` (check) |
| TEST-CSRF-04 | same-origin POST | PASS | `integration/session.test.ts` (check) |
| TEST-CSRF-05 | Origin header mismatch | PASS | `integration/session.test.ts` (check) |
| TEST-CSRF-06 | unsafe GET side effects | PASS | `integration/session.test.ts` (check) |
| TEST-CSRF-07 | content type spoof | PASS | `integration/session.test.ts` (check) |
| TEST-CSRF-08 | double-submit replay | PASS | `integration/session.test.ts` (check) |
| TEST-CSRF-09 | preflight unexpected origin | PASS | `integration/session.test.ts` (check) |
| TEST-CSRF-10 | logout CSRF | PASS | `integration/session.test.ts` (check) |

#### DB

| ID | Kasus | Status | Bukti |
|---|---|---|---|
| TEST-DB-01 | empty migration | PASS | `integration/db.test.ts` (check) |
| TEST-DB-02 | repeat migration | PASS | `integration/db.test.ts` (check) |
| TEST-DB-03 | migration checksum | PASS | `integration/db.test.ts` (check) |
| TEST-DB-04 | schema version drift | PASS | `integration/db.test.ts` (check) |
| TEST-DB-05 | unique founder email | PASS | `integration/db.test.ts` (check) |
| TEST-DB-06 | session FK integrity | PASS | `integration/db.test.ts` (check) |
| TEST-DB-07 | audit event append | PASS | `integration/db.test.ts` (check) |
| TEST-DB-08 | transaction rollback | PASS | `integration/db.test.ts` (check) |
| TEST-DB-09 | DB connection timeout | PASS | `integration/db.test.ts` (check) |
| TEST-DB-10 | pool exhaustion | PASS | `integration/db.test.ts` (check) |

#### ENV

| ID | Kasus | Status | Bukti |
|---|---|---|---|
| TEST-ENV-01 | missing DATABASE_URL | PASS | `unit/env.test.ts` (check) |
| TEST-ENV-02 | invalid DATABASE_URL | PASS | `unit/env.test.ts` (check) |
| TEST-ENV-03 | empty SESSION_SECRET | PASS | `unit/env.test.ts` (check) |
| TEST-ENV-04 | invalid APP_BASE_URL | PASS | `unit/env.test.ts` (check) |
| TEST-ENV-05 | production debug flag | PASS | `unit/env.test.ts` (check) |
| TEST-ENV-06 | unknown env rejected | PASS | `unit/env.test.ts` (check) |
| TEST-ENV-07 | redaction on error | PASS | `unit/env.test.ts` (check) |
| TEST-ENV-08 | secret absent in startup log | PASS | `unit/env.test.ts` (check) |
| TEST-ENV-09 | different dev/prod config | PASS | `unit/env.test.ts` (check) |
| TEST-ENV-10 | env example placeholders | PASS | `unit/env.test.ts` (check) |

#### MFA

| ID | Kasus | Status | Bukti |
|---|---|---|---|
| TEST-MFA-01 | valid TOTP | PASS | `integration/mfa.test.ts` (check) |
| TEST-MFA-02 | wrong TOTP | PASS | `integration/mfa.test.ts` (check) |
| TEST-MFA-03 | expired challenge | PASS | `integration/mfa.test.ts` (check) |
| TEST-MFA-04 | replayed challenge | PASS | `integration/mfa.test.ts` (check) |
| TEST-MFA-05 | wrong founder challenge | PASS | `integration/mfa.test.ts` (check) |
| TEST-MFA-06 | clock drift boundary | PASS | `integration/mfa.test.ts` (check) |
| TEST-MFA-07 | invalid recovery code | PASS | `integration/mfa.test.ts` (check) |
| TEST-MFA-08 | reused recovery code | PASS | `integration/mfa.test.ts` (check) |
| TEST-MFA-09 | recovery code rotation | PASS | `integration/mfa.test.ts` (check) |
| TEST-MFA-10 | MFA setup cancellation | PASS | `integration/mfa.test.ts` (check) |

#### OPS

| ID | Kasus | Status | Bukti |
|---|---|---|---|
| TEST-OPS-01 | HTTP to HTTPS | PASS (lokal) | compose smoke dengan CA lokal Caddy. Domain publik: NOT RUN (D-08) |
| TEST-OPS-02 | TLS cert validity | PASS (lokal) | compose smoke dengan CA lokal. Sertifikat ACME publik: NOT RUN (D-08) |
| TEST-OPS-03 | reverse proxy headers | PASS (lokal) | compose smoke |
| TEST-OPS-04 | API direct port closed | PASS (lokal) | compose smoke (port host 3000/4000/5432 tertutup). Firewall VPS: NOT RUN |
| TEST-OPS-05 | Postgres direct port closed | PASS (lokal) | compose smoke OPS-04 memeriksa 5432 tertutup di host. Di VPS: NOT RUN |
| TEST-OPS-06 | log rotation | PASS (statis) | Semua 5 service `json-file` 10 MB × 3: `tests/repo/ci.test.ts`. Di VPS: NOT RUN |
| TEST-OPS-07 | disk threshold | PASS | `infra/scripts/check-disk.sh` + `tests/repo/repo.test.ts`. Cron di VPS: NOT RUN |
| TEST-OPS-08 | restart recovery | PASS (container) | TEST-COMPOSE-08 (proses mati → restart otomatis). Reboot host VPS: NOT RUN |
| TEST-OPS-09 | SSH access preservation | NOT RUN | Butuh VPS (D-08/D-09). Prosedur: `docs/runbooks/deploy-vps.md` §0–1 |
| TEST-OPS-10 | incident runbook exists | PASS | `docs/runbooks/incident.md`; SQL daruratnya dijalankan sungguhan oleh `integration/runbook.test.ts` |

#### REPO

| ID | Kasus | Status | Bukti |
|---|---|---|---|
| TEST-REPO-01 | dirty worktree preserved | PASS | Audit P0-001 read-only; status awal tercatat di `docs/phase-0/BASELINE.md` |
| TEST-REPO-02 | existing README respected | PASS | README lama dipertahankan dan diperluas (BASELINE, P0-003) |
| TEST-REPO-03 | lockfile pinned | PASS | `tests/repo/repo.test.ts` (check) |
| TEST-REPO-04 | node version pinned | PASS | `tests/repo/repo.test.ts` (check) |
| TEST-REPO-05 | no gitignored secrets tracked | PASS | `tests/repo/repo.test.ts` (check) |
| TEST-REPO-06 | branch name recorded | PASS | Branch `main` tercatat di `DECISIONS.md` D-00 |
| TEST-REPO-07 | CI config reviewed | PASS | Review CI di BASELINE + ADR-008; dijaga `tests/repo/ci.test.ts` |
| TEST-REPO-08 | duplicate config avoided | PASS | `tests/repo/repo.test.ts` (check) |
| TEST-REPO-09 | fresh clone install works | PASS | Clone bersih `main` 4a64b72 → `pnpm install --frozen-lockfile` → `pnpm run check` 223/223, worktree tetap bersih (§2) |
| TEST-REPO-10 | documentation paths resolve | PASS | `tests/repo/repo.test.ts` (check) |

#### SESSION

| ID | Kasus | Status | Bukti |
|---|---|---|---|
| TEST-SESSION-01 | session issuance | PASS | `integration/session.test.ts` (check) |
| TEST-SESSION-02 | session cookie HttpOnly | PASS | `integration/session.test.ts` (check) |
| TEST-SESSION-03 | session cookie Secure | PASS | `integration/session.test.ts` (TEST-SESSION-02..04) |
| TEST-SESSION-04 | SameSite enforcement | PASS | `integration/session.test.ts` (check) |
| TEST-SESSION-05 | expired session | PASS | `integration/session.test.ts` (check) |
| TEST-SESSION-06 | revoked session | PASS | `integration/session.test.ts` (check) |
| TEST-SESSION-07 | logout twice | PASS | `integration/session.test.ts` (check) |
| TEST-SESSION-08 | stolen malformed token | PASS | `integration/session.test.ts` (check) |
| TEST-SESSION-09 | session rotation | PASS | `integration/session.test.ts` (check) |
| TEST-SESSION-10 | database outage fail closed | PASS | `integration/session.test.ts` (check) |

#### WEB

| ID | Kasus | Status | Bukti |
|---|---|---|---|
| TEST-WEB-01 | public landing | PASS | `tests/e2e/web.e2e.mjs` (e2e) |
| TEST-WEB-02 | private route redirect | PASS | `tests/e2e/web.e2e.mjs` (e2e) |
| TEST-WEB-03 | logged in private shell | PASS | `tests/e2e/web.e2e.mjs` (e2e) |
| TEST-WEB-04 | expired session redirect | PASS | `tests/e2e/web.e2e.mjs` (e2e) |
| TEST-WEB-05 | keyboard navigation | PASS | `tests/e2e/web.e2e.mjs` (e2e) |
| TEST-WEB-06 | mobile viewport | PASS | `tests/e2e/web.e2e.mjs` (e2e) |
| TEST-WEB-07 | visible focus | PASS | `tests/e2e/web.e2e.mjs` (e2e) |
| TEST-WEB-08 | contrast | PASS | `tokens.test.ts` (check) |
| TEST-WEB-09 | no unescaped HTML | PASS | `tokens.test.ts`, `tests/e2e/web.e2e.mjs` (check, e2e) |
| TEST-WEB-10 | error boundary | PASS | `tests/e2e/web.e2e.mjs` (e2e) |
