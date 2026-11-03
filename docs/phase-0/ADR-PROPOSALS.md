# NALARA Phase 0 — ADR Proposals (input untuk P0-002)

**Status semua ADR: PROPOSED.** Belum ada yang diterima. Setelah founder menyetujui atau mengubah, P0-002 menulis versi final per file di `docs/adr/ADR-00X-*.md` memakai template PRD §17 (ID, status, tanggal, konteks, alternatif, keputusan, konsekuensi +/−, dampak keamanan, dampak biaya/performa, rollback, approver).

Versi paket di bawah adalah versi registry saat audit (2026-11-03) dan **belum dipin**. Pin final dilakukan di P0-003 setelah diverifikasi.

Ringkasan rekomendasi:

| ADR | Pertanyaan | Rekomendasi | Perlu input founder? |
|---|---|---|---|
| ADR-001 | Package manager, Node, workspace | pnpm workspaces · Node LTS aktif (v24 atau v26) · pnpm dipin via `packageManager` | Pilih v24 atau v26 |
| ADR-002 | Web vs API, framework | Next.js 16 (UI saja) + **Fastify** API terpisah sebagai satu-satunya pemilik logic dan DB · Zod | Ya (K-01) |
| ADR-003 | ORM/migrasi | **Drizzle** + file SQL hasil generate yang direview · 2 role DB · PostgreSQL major terbaru yang didukung | Tidak wajib |
| ADR-004 | Sesi, cookie, CSRF, rate limit | Sesi opaque di PostgreSQL · cookie `__Host-` · same-origin · cek Origin + token CSRF | Tidak wajib |
| ADR-005 | MFA | **TOTP** dulu + recovery code · enrolment-scoped challenge · WebAuthn opsional nanti | **Ya (D-03)** |
| ADR-006 | Reverse proxy | **Caddy** · `/api/*` → API, sisanya → web · `/health/ready` tidak dirute | Tidak wajib |
| ADR-007 | Backup | `pg_dump` + enkripsi `age` · retensi 7 harian/4 mingguan · restore drill terisolasi | **Ya (D-04 tujuan offsite)** |
| ADR-008 | CI & branch protection | GitHub Actions gratis · action dipin SHA · gitleaks + dependency review · protection di `main` | Founder aktifkan protection |
| ADR-009 | Bentuk tabel identitas & audit | `users` + `role` (dibatasi founder, maks. 1) · `audit_events` siap aktor system/AI | Ya (K-03, K-04) |

---

## ADR-001 — Package manager, Node.js, workspace

- **Konteks:** PRD merekomendasikan pnpm via Corepack dan monorepo `apps/*` + `packages/*`. Node LTS saat audit: v26.13.0 (Lithium) dan v24.22.2 (Krypton). Corepack dilaporkan tidak lagi dibawa Node 25+ (**NOT VERIFIED**, K-09).
- **Opsi:** (a) pnpm workspaces · (b) npm workspaces · (c) Bun/Yarn.
- **Rekomendasi:** (a) pnpm workspaces. Versi dipin di field `packageManager` dan `engines`, Node dipin di `.nvmrc`. Cara instal pnpm didokumentasikan: Corepack bila tersedia, kalau tidak `npm i -g pnpm@<versi>`.
- **Node:** v26 punya masa dukungan lebih panjang, v24 lebih matang dalam kompatibilitas modul native (argon2). Usulan: **v24** untuk Phase 0, naik ke v26 lewat ADR terpisah setelah dependensi terbukti kompatibel. Founder boleh memilih v26.
- **Tradeoff:** pnpm ketat soal dependensi hoisting. Ini bagus untuk keamanan, tapi kadang perlu penyesuaian di Next.js.
- **Rollback:** ganti ke npm workspaces cukup dengan menghapus lockfile dan membuat ulang. Belum ada kode yang bergantung.

## ADR-002 — Batas web/API dan framework API

- **Konteks:** K-01. PRD v1.0 menyarankan satu app Next.js. Phase 0 v2 (yang berlaku untuk Phase 0) meminta `apps/api` sebagai otoritas sesi dan otorisasi, plus batas API untuk worker, Hermes, dan Telegram nanti.
- **Opsi:**
  1. Satu app Next.js (route handlers + server actions), lebih sederhana untuk dioperasikan satu orang.
  2. Next.js (UI) + **Fastify** API: validasi schema bawaan, logger pino dengan redaksi, body limit, dan hook yang jelas.
  3. Next.js + Express: ekosistem terbesar, tapi validasi, logging, dan batasannya harus dirakit sendiri.
- **Rekomendasi:** opsi 2. Next.js **tidak punya kredensial DB** dan hanya memanggil API (server-side lewat DNS internal Compose, browser lewat same-origin `/api`). Seluruh business logic hanya ada di `apps/api`, sehingga tidak ada dua sumber logic. Validasi memakai Zod (dibagikan lewat `packages/contracts`).
- **Tradeoff:** dua proses dan dua image. Sebagai gantinya batas kepercayaannya tegas, dan Hermes/Telegram nanti cukup memanggil API terbatas tanpa akses DB.
- **Keamanan:** satu titik `requireFounder()`. Middleware/proxy Next.js hanya untuk UX (redirect), bukan kontrol akses.
- **Rollback:** sebelum Phase 1, `apps/api` bisa dilebur ke route handlers Next.js karena kontraknya ada di `packages/contracts`.

## ADR-003 — ORM, migrasi, dan role database

- **Konteks:** PRD meminta migrasi SQL yang versioned, ada checksum, terdeteksi drift-nya, dan transaksional (TEST-DB-01..10).
- **Opsi:** (a) Drizzle ORM + drizzle-kit (generate SQL, query bertipe, ringan, tanpa engine binary) · (b) Prisma (DX bagus, tapi engine/binary lebih berat dan SQL kurang transparan) · (c) SQL murni + runner kecil (mis. node-pg-migrate) + Kysely untuk query bertipe.
- **Rekomendasi:** (a). File SQL hasil generate **wajib direview dan di-commit**. Migrasi dijalankan sebagai langkah eksplisit, bukan saat app start. Opsi (c) jadi fallback bila Drizzle tidak memenuhi tes checksum/drift.
- **Role DB:** `nalara_migrator` (DDL, hanya dipakai saat migrasi) dan `nalara_app` (DML). `nalara_app` **tidak punya `UPDATE`/`DELETE`** di `audit_events` (S-04).
- **ID:** UUID. Generate di aplikasi (UUIDv7 untuk urutan waktu) atau `gen_random_uuid()`, diputuskan di P0-005.
- **PostgreSQL:** pin major terbaru yang stabil dan didukung image resmi (versi dicek di P0-005). Probe audit memakai 16.
- **Rollback:** sebelum ada data produksi, migrasi bisa dibuat ulang. Setelah ada, hanya forward migration (PRD D3).

## ADR-004 — Sesi, cookie, CSRF, rate limit

- **Sesi:** token acak 256-bit, yang disimpan di `sessions.token_hash` hanya SHA-256-nya (token berentropi tinggi tidak perlu Argon2). TTL absolut dan idle, rotasi saat login atau perubahan hak, revoke saat logout. Kalau DB tidak bisa dicek → tolak (fail-closed).
- **Cookie:** `__Host-nalara_session`, `HttpOnly`, `Secure`, `SameSite=Lax`, `Path=/`, tanpa `Domain`. Dev lokal memakai `localhost` (browser memperlakukannya sebagai secure context) atau HTTPS Caddy lokal.
- **Topologi:** same-origin. Browser hanya bicara ke satu origin, dan Caddy meneruskan `/api/*` ke API.
- **CSRF:** semua mutasi wajib `Content-Type: application/json` + verifikasi header `Origin`/`Sec-Fetch-Site` + token CSRF (synchronizer token yang terikat sesi). Kalau `SESSION_SECRET` dipertahankan, fungsinya **hanya** HMAC token CSRF (K-13).
- **Rate limit:** per IP in-memory (`@fastify/rate-limit`) + penghitung kegagalan per akun dan lockout bertahap di PostgreSQL, supaya tidak reset saat restart (S-05). Tanpa Redis (DEC-008).
- **Rollback:** pindah penyimpanan rate limit ke Redis hanya bila ada kebutuhan yang terukur.

## ADR-005 — MFA dan recovery (perlu D-03)

- **Opsi:** (a) **TOTP** (Google Authenticator, Aegis, 1Password): sederhana, offline · (b) WebAuthn/passkey: tahan phishing, tapi lebih kompleks dan butuh perangkat pendukung · (c) keduanya.
- **Rekomendasi:** (a) untuk Phase 0, dengan (b) sebagai tambahan opsional di fase berikutnya.
- **Detail TOTP:** secret dienkripsi AES-256-GCM memakai `MFA_ENCRYPTION_KEY` (env runtime, tidak di DB). Toleransi ±1 time-step. Time-step terakhir yang dipakai disimpan untuk menolak replay. 10 recovery code dari acak kuat, disimpan dalam bentuk hash, sekali pakai, ditampilkan sekali, dan bisa dirotasi.
- **Alur login (K-14):** password benar → **challenge** ber-TTL pendek (bukan sesi), terikat founder, sekali pakai, dan di-rate-limit.
  - Kalau MFA belum aktif: challenge berscope `enrolment` dan **hanya** boleh memanggil `mfa/setup` + `mfa/verify`.
  - Kalau MFA aktif: challenge berscope `mfa` → verifikasi kode → baru sesi penuh terbit.
  - Challenge ke `/api/v1/os/*` wajib ditolak (tes negatif).
- **Rollback:** kehilangan kunci enkripsi berarti semua founder harus enrol ulang lewat bootstrap CLI lokal yang terdokumentasi.

## ADR-006 — Reverse proxy dan TLS

- **Opsi:** (a) **Caddy**: TLS otomatis, konfigurasi ringkas · (b) Nginx + certbot: lebih familiar, tapi lebih banyak bagian yang harus diurus.
- **Rekomendasi:** (a). Routing: `/api/*` → `api:PORT`, sisanya → `web:PORT`. `/health/ready` **tidak** dirute (K-16) dan cuma dipakai healthcheck Compose. Header keamanan: HSTS (produksi), `X-Content-Type-Options`, `Referrer-Policy`, CSP dasar. Request ID diteruskan ke API sebagai `X-Request-ID`. API membuat ID sendiri bila ID dari luar tidak valid. Hanya port 80/443 yang publik.
- **Rehearsal:** CA internal Caddy di lokal. TLS publik NOT RUN sampai D-08.
- **Rollback:** Caddyfile bisa diganti konfigurasi Nginx yang setara tanpa mengubah app.

## ADR-007 — Backup dan restore (perlu D-04)

- **Rekomendasi:** `pg_dump -Fc` → enkripsi `age` (kunci publik di host, kunci privat **offline** dipegang founder) → upload ke storage offsite S3-compatible (tujuan ditentukan founder). File lokal berizin 0600. Retensi awal: 7 harian + 4 mingguan (dry-run pruning dulu). Restore drill selalu ke container DB terpisah, **tidak pernah** ke DB produksi. Alert bila backup terakhir lebih tua dari ambang.
- **Target awal (PRD A §12.2):** RPO ≤ 24 jam, RTO ≤ 8 jam (target, bukan SLA).
- **Alternatif:** GPG (lebih umum, tapi lebih rumit), restic (deduplikasi, perlu tool tambahan).
- **Rollback:** format `pg_dump` custom tetap bisa dibaca `pg_restore` apa pun alat enkripsinya.

## ADR-008 — CI dan branch protection

- **Rekomendasi:** GitHub Actions (tanpa layanan berbayar). Job: install `--frozen-lockfile` → format/lint → typecheck → unit → integration (service container PostgreSQL) → build → secret scan (gitleaks) → dependency review/audit. `permissions: contents: read` sebagai default. Semua action dipin ke commit SHA. Dependabot untuk npm, Docker, dan Actions. Workflow hanya untuk `pull_request` dan `push` ke `main`, tanpa `pull_request_target`.
- **Branch protection `main`** (dilakukan founder di Settings): wajib PR, wajib status check CI, larang force push dan delete.
- **Rollback:** workflow bisa dinonaktifkan per file tanpa memengaruhi kode.

## ADR-009 — Bentuk tabel identitas dan audit (K-03, K-04)

- **Konteks:** Phase 0 v2 memakai `founders` dan `audit_events(actor_founder_id, …)`. PRD v1.0 dan Phase 02/04 butuh `users.role` serta aktor non-founder (system, AI proposal, Telegram).
- **Opsi:**
  1. Ikuti v2 apa adanya, lalu rename dan migrasi di Phase 1/2 (risiko migrasi data audit).
  2. **Bentuk siap-masa-depan sekarang** dengan perilaku Phase 0 yang tetap founder-only.
- **Rekomendasi:** opsi 2:
  - `users(id, email UNIQUE, password_hash, role TEXT NOT NULL CHECK (role IN ('founder')), mfa_enabled, created_at, updated_at)` + `CREATE UNIQUE INDEX users_single_founder ON users (role) WHERE role = 'founder'`, sehingga maksimal satu founder dan tidak ada self-signup. *(Diuji saat audit di `postgres:16-alpine`: insert founder kedua → `duplicate key … users_single_founder`, role lain → `violates check constraint users_role_check`.)*
  - `sessions(…, user_id → users.id …)` sama seperti v2.
  - `audit_events(id, actor_type TEXT NOT NULL CHECK (actor_type IN ('founder','system')), actor_id, action, resource_type, resource_id, result, request_id, metadata JSONB (allowlist), created_at)`. Nilai `actor_type` baru (mis. `ai_proposal`) ditambah lewat migrasi di fase terkait.
- **Keamanan:** tidak ada endpoint registrasi. Satu-satunya pembuat founder adalah bootstrap CLI. Audit append-only lewat role DB (ADR-003).
- **Rollback:** sebelum ada data produksi, kembali ke skema v2 cukup dengan regenerasi migrasi.
