# NALARA Phase 0 — Repository Baseline Audit (P0-001)

| Field | Value |
|---|---|
| Ticket | P0-001 — Repository reconnaissance |
| Audit date | 2026-11-03 (UTC) |
| Source PRD | `NALARA_Master_PRD_Full_Phases_0-9_v3.md` (v3.0, 2026-11-03), file dari founder, **belum** ada di repo |
| Repository | `github.com/welldan23/nalara` |
| Audited commit | `5ddf36b` (`main` = `master`) |
| Status | **PENDING founder review**: implementasi P0-002 dan seterusnya belum boleh dimulai |

> Dokumen ini hasil audit read-only. Tidak ada kode aplikasi yang dibuat atau diubah.
> Semua status di sini berasal dari perintah yang benar-benar dijalankan (lihat §9 Evidence).
> Hal yang belum bisa diverifikasi ditandai **NOT VERIFIED** atau **NOT RUN**.

---

## 1. Ringkasan

- Repo masih **greenfield**: belum ada kode aplikasi, `package.json`, lockfile, CI, `.gitignore`, `README.md`, atau `.env`.
- Isi repo saat ini hanya 10 Claude Code skill pihak ketiga di `.claude/skills/` (163 file, ±596 KB, semuanya Markdown, tanpa script). Asal dan lisensinya tercatat di `.claude/skills/SOURCES.md`.
- Branch `master` sudah dimigrasikan ke `main` (commit sama persis), default branch GitHub sudah `main`, dan `master` sudah dihapus (terverifikasi, §8).
- Lingkungan cloud session ini sanggup menjalankan hampir semua tes Phase 0 (Node, pnpm, Docker, PostgreSQL client). Pengecualiannya tes OPS yang butuh VPS dan domain asli.
- Ditemukan **16 konflik/ambiguitas spesifikasi** (§4). Lima di antaranya perlu diputuskan founder **sebelum P0-003**: K-01, K-03, K-04, K-11, dan K-14.

## 2. Kondisi repository saat audit

| Item | Temuan |
|---|---|
| Branch lokal | `main` (tracking `origin/main`), `master` (tracking `origin/master`) |
| Branch remote | `main` dan `master`, keduanya di `5ddf36b` |
| Default branch GitHub (`HEAD`) | `refs/heads/master` saat audit, sekarang `refs/heads/main` (§8) |
| Riwayat commit | `4645f81` (skill gelombang 1), `5ddf36b` (skill gelombang 2) |
| Worktree | Bersih sebelum audit (tidak ada perubahan atau file untracked) |
| File yang ter-track | 163, semuanya di `.claude/skills/**` |
| `README.md`, `package.json`, `pnpm-workspace.yaml` | Tidak ada |
| `.github/workflows/` | Tidak ada |
| `.gitignore` / `.env*` | Tidak ada |
| Dependensi terpasang | Tidak ada (belum ada manifest) |
| Secret scan (pola key/token/private key) | Tidak ada temuan |
| PR terbuka | Tidak ada |

### 2.1 Isi `.claude/skills/` (bukan kode aplikasi)

`the-pragmatic-programmer`, `a-philosophy-of-software-design`, `refactoring`, `release-it`, `designing-data-intensive-applications` (ciembor, MIT) · `vercel-react-best-practices` (Vercel, MIT) · `frontend-design` (Anthropic, Apache-2.0) · `supabase-postgres-best-practices` (Supabase, MIT) · `sharp-edges` (Trail of Bits, CC-BY-SA-4.0) · `verification-before-completion` (obra, MIT).

Isinya berupa instruksi untuk Claude Code, bukan bagian dari aplikasi. Skill ini tidak ikut ke image Docker selama nanti ada `.dockerignore` (P0-003/P0-012).

## 3. Lingkungan pengembangan (cloud session)

| Tool | Versi terdeteksi | Catatan |
|---|---|---|
| OS | Ubuntu 24.04.5 LTS, kernel 6.18 | Container cloud sementara |
| Node.js | v22.23.4 | **Bukan** LTS terbaru. Rilis LTS saat audit: v26.13.0 "Lithium" dan v24.22.2 "Krypton" (dari `nodejs.org/dist/index.json`) |
| npm | 10.9.9 | Registry npm bisa diakses lewat proxy |
| Corepack | 0.36.0 | Bundling Corepack di Node 25+ **NOT VERIFIED**, lihat K-09 |
| pnpm | 10.28.0 terpasang; 12.16.1 terbaru di registry | Versi dipin di ADR-001 |
| Docker Engine / Compose | 29.9.2 / v5.6.1 | Daemon **tidak otomatis jalan**. Harus dijalankan manual (`dockerd`) tiap sesi. Setelah itu pull dan run `postgres:16-alpine` berhasil |
| PostgreSQL | client + server binaries 16.15 | Tes DB juga bisa memakai container |
| git | 2.43.0 | |

Versi paket di registry saat audit (referensi, belum dipilih): `next` 16.4.4 · `drizzle-orm` 0.45.4 · `argon2` 0.45.2 · `@node-rs/argon2` 2.2.2 · `otplib` 13.6.0 · `zod` 4.6.7.

## 4. Konflik dan ambiguitas spesifikasi

Prioritas: **Blocker** = harus diputuskan sebelum tiket terkait mulai · **Major** = berdampak ke fase berikutnya · **Minor** = cukup dicatat.

| ID | Konflik | Lokasi di PRD | Dampak | Usulan | Prioritas |
|---|---|---|---|---|---|
| K-01 | **Satu app atau dua?** PRD v1.0 meminta business logic di dalam Next.js dan melarang backend kedua di MVP. Phase 0 v2 meminta `apps/web` + `apps/api` (Fastify/Express) dengan API sebagai otoritas | A §6.1, §6.3, R-07 vs B §0, §4, §5, DEC-002 | Menentukan seluruh struktur kode dan batas keamanan | Ikuti Phase 0 v2 (dokumen ini menggantikan panduan Phase 0 yang bertentangan): API terpisah sebagai **satu-satunya** pemilik business logic dan akses DB, Next.js tanpa akses DB. Detail di ADR-002 | Blocker (P0-003) |
| K-02 | Struktur folder beda: `packages/core`, `packages/db`, `services/*` (v1.0) vs `apps/api`, `db/`, `packages/{config,contracts,ui}` (v2) | A §6.3 vs B §4 | Kebingungan lokasi kode di fase berikutnya | Pakai pohon B §4 untuk Phase 0. Worker, AI adapter, dan Telegram nanti masuk `apps/*` atau `services/*` lewat ADR fase masing-masing | Major |
| K-03 | Tabel identitas: `founders` (v2) vs `users` + `role` (v1.0). Phase 02 juga punya tiket "Founder role-based authorization" | B §7 vs A §7.1, C P02-002 | Rename tabel di fase berikutnya = migrasi berisiko | ADR-009: tabel `users` dengan `role` dibatasi `CHECK (role = 'founder')` + partial unique index agar maksimal satu founder | Blocker (P0-005) |
| K-04 | Skema `audit_events` beda: `actor_founder_id/target_*/occurred_at` (v2) vs `actor_type/actor_id/resource_*/before_hash/after_hash/result/created_at` (v1.0). Phase 4 butuh aktor non-founder (system/AI) | B §7 vs A §7.3 | Audit Phase 0 tidak bisa mencatat aktor sistem/AI tanpa migrasi | ADR-009: pakai bentuk yang sudah siap untuk fase depan (`actor_type`, `actor_id`, `resource_*`, `result`, `request_id`, `metadata` allowlist) | Blocker (P0-005) |
| K-05 | Ada dua backlog: `NAL-001..018` (v1.0) vs `P0-001..016` (v2). NAL-002 (seed categories) dan NAL-005 (masthead prototype) bertentangan dengan out-of-scope Phase 0 | A §16 vs B §13, §10, §21 | Scope creep ke Phase 1 | `P0-*` jadi backlog resmi Phase 0. `NAL-*` dianggap referensi historis. Seed kategori dan masthead masuk Phase 1 | Major |
| K-06 | Penomoran fase beda. A §15: 0 Foundation · 1 Media+OS · 2 Ingestion+Hermes+Telegram · 3 Data · 4 Expansion. C: 01 Media CMS · 02 OS · 03 Ingestion · 04 Hermes+Telegram · 05 Data · 06 Tools · 07 Labs · 08 Hardening & launch · 09 Growth | A §15 vs C | (a) CMS di P01 butuh dashboard dan otorisasi yang baru dibangun di P02. (b) Launch publik baru di P08, setelah Tools dan Labs, padahal visi bilang "perluas hanya setelah media tervalidasi" | Founder pilih satu urutan resmi sebelum Phase 1. Usulan: pakai C, tapi P02-001/002 dikerjakan sebelum P01-004, dan pertimbangkan launch terbatas setelah P02 | Major (sebelum Phase 1) |
| K-07 | Konvensi branch: `phase/00-foundation` vs `feat/PXX-YYY-short-name`, plus "one ticket per PR" | B §3.4 vs D2, C | Riwayat PR tidak konsisten | `feat/P00-0XX-nama-singkat` per tiket, base `main`. PR audit ini sudah memakai pola tersebut | Minor |
| K-08 | Prompt tiket merujuk `NALARA_Phase_0_Claude_Code_Implementation_PRD_v2.md`, file yang tidak ada di repo | B §13 | Sesi Claude berikutnya tidak bisa membaca sumber yang sama | Commit PRD master ke `docs/prd/` (keputusan founder D-05) | Major |
| K-09 | PRD meminta "pnpm via Corepack". Node LTS terbaru (v26) dilaporkan tidak lagi membawa Corepack (**NOT VERIFIED** di sesi ini) | B §9.1 | Bootstrap command bisa gagal di mesin baru | ADR-001: pin pnpm lewat field `packageManager` + cara instal yang terdokumentasi, lalu verifikasi di P0-003 | Major |
| K-10 | Pohon repo memakai `apps/web/middleware.ts`. Di Next.js 16 konvensi ini dilaporkan berganti nama jadi `proxy.ts` (**NOT VERIFIED**) | B §4 | File bisa tidak terbaca atau deprecated | Verifikasi di P0-003/P0-011 dan ikuti konvensi versi Next yang dipin. Tetap **bukan** batas keamanan (B §5) | Minor |
| K-11 | Urutan tiket: CI (P0-014) baru di akhir. Sesi dan CSRF (P0-010) setelah login (P0-008) dan MFA (P0-009), padahal MFA harus menerbitkan sesi | B §13 | Tiket awal tidak ter-gate CI; ketergantungan melingkar login → MFA → sesi | Urutan eksekusi diubah (§6.1) tanpa mengubah ID tiket | Blocker (urutan) |
| K-12 | P0-005 butuh PostgreSQL untuk tes migrasi, tapi Compose baru dibuat di P0-012 | B §13, §9.1 | P0-005 tidak bisa diverifikasi | P0-005 menambah `compose.yaml` berisi service `db` saja untuk dev/test. P0-012 melengkapi topologi penuh | Major |
| K-13 | `SESSION_SECRET` ada di `.env.example`, padahal sesi memakai token opaque yang di-hash (tidak butuh secret) | B §9.1, §6.1 | Secret tanpa fungsi jelas jadi sharp edge (dipakai sembarangan atau tidak dirotasi) | ADR-004: tetapkan fungsinya (mis. HMAC token CSRF) atau hapus | Minor |
| K-14 | Login pertama setelah bootstrap: founder belum punya MFA, padahal sesi penuh baru boleh terbit setelah MFA. Alur enrolment pertama tidak didefinisikan | B §6.1, §8, DEC-007 | Bisa muncul jalan pintas tanpa MFA (bypass) | ADR-005: login pertama hanya menerbitkan **enrolment-scoped challenge** yang cuma bisa memanggil `mfa/setup` + `mfa/verify`, ber-TTL pendek, dan tidak bisa mengakses `/api/v1/os/*` | Blocker (P0-008/009) |
| K-15 | Nama env beda: `APP_BASE_URL`/`API_BASE_URL` (v2) vs `PUBLIC_BASE_URL` (v1.0) | B §9.1 vs A §13.2 | Minor | Pakai nama v2 | Minor |
| K-16 | `/health/ready` disebut "internal", tapi caranya tidak didefinisikan | B §8, §6.2 | Info kesiapan sistem bisa bocor ke publik | ADR-006: tidak dirute lewat reverse proxy, hanya bisa diakses dari jaringan Compose/healthcheck | Minor |

## 5. Risiko keamanan dan operasional

| ID | Risiko | Level | Mitigasi yang diusulkan | Tiket |
|---|---|---|---|---|
| S-01 | Bypass MFA lewat alur login pertama (K-14) | High | Enrolment-scoped challenge + tes negatif `/os/*` dengan challenge | P0-008, P0-009 |
| S-02 | `.env` ter-commit karena `.gitignore` belum ada | High (sampai P0-003) | `.gitignore` jadi file pertama di P0-003 + secret scan di CI | P0-003, P0-014 |
| S-03 | Branch protection `main` dipasang founder, tapi belum diverifikasi dari sesi ini. Required status check CI belum ada | Low | Tambah required check setelah P0-014a | Founder, P0-014a |
| S-04 | Audit "append-only" hanya di level aplikasi | Medium | Role DB terpisah: `nalara_migrator` (DDL) dan `nalara_app` (tanpa `UPDATE`/`DELETE` di `audit_events`) | P0-005 |
| S-05 | Rate limit in-memory reset saat restart (tidak ada Redis, DEC-008) | Medium | Rate limit IP in-memory + penghitung kegagalan per akun di PostgreSQL | P0-008 |
| S-06 | Kunci enkripsi TOTP (`MFA_ENCRYPTION_KEY`) hilang = founder terkunci, bocor = MFA tidak berarti | Medium | AES-256-GCM, key hanya di env runtime, prosedur rotasi, recovery code | P0-009 |
| S-07 | Bootstrap CLI tidak sengaja jalan di produksi | Medium | Tolak bila sudah ada founder, wajib flag eksplisit, tidak ada endpoint HTTP | P0-007 |
| S-08 | Topologi cookie dan CSRF salah (beda subdomain, `SameSite` keliru) | Medium | Same-origin via proxy (`/api/*`), cookie `__Host-`, cek `Origin`/`Sec-Fetch-Site` + token CSRF | P0-010, P0-013 |
| S-09 | Supply chain: modul native (`argon2`) di image Alpine/musl, GitHub Action tanpa pin | Medium | Lockfile, `--frozen-lockfile`, pin action ke SHA, dependency review, Dependabot | P0-003, P0-014 |
| S-10 | Parameter Argon2id belum bisa di-tune karena spek VPS belum diketahui | Low | Default aman (OWASP) dulu, tune ulang di VPS sebelum produksi | P0-008 |
| S-11 | Kunci backup dan lokasi offsite belum ditentukan | Medium (gate produksi) | ADR-007 + keputusan founder D-04 | P0-015 |
| S-12 | Skill pihak ketiga di `.claude/skills/` mengarahkan perilaku Claude | Low | Sudah direview, tanpa script, dicatat di `SOURCES.md`, dikecualikan dari image | — |
| S-13 | Docker daemon di cloud session tidak persisten, jadi tes Compose bisa terlewat | Low | Tiket Compose/backup wajib menjalankan `dockerd` dan mencatat bukti. Kalau gagal ditulis NOT RUN | P0-012, P0-015 |

## 6. Rencana 16 tiket Phase 0

### 6.1 Urutan eksekusi yang diusulkan

ID tiket **tidak diubah**. Yang diubah hanya urutan kerjanya (K-11, K-12):

```text
P0-001 → P0-002 → P0-003 → P0-014a → P0-004 → P0-005 → P0-006 → P0-007
       → P0-010 → P0-008 → P0-009 → P0-011 → P0-012 → P0-013 → P0-015
       → P0-014b → P0-016
```

- **P0-014a** = CI dasar (lint, typecheck, test, build, secret scan) dipasang segera setelah scaffold, supaya semua tiket berikutnya ter-gate CI.
- **P0-014b** = melengkapi CI: tes integrasi DB, dependency audit, Dependabot, dan uji "CI gagal pada kode rusak".
- **P0-010 sebelum P0-008/009**: infrastruktur sesi (buat, validasi, cabut, cookie, CSRF, `requireFounder`) dibangun dan dites dengan fixture dulu. Setelah itu login menerbitkan challenge, lalu MFA menerbitkan sesi lewat interface yang sudah ada.

### 6.2 Detail tiket

| # | Tiket | Bergantung pada | Exit criteria (ringkas dari PRD) | Test spec PRD | Bisa diverifikasi di cloud session? |
|---|---|---|---|---|---|
| 1 | **P0-001** Repository reconnaissance | — | BASELINE berisi path, branch, versi runtime, gap, dan risiko yang akurat | TEST-REPO-01, 06 | Ya (dokumen ini) |
| 2 | **P0-002** ADR | P0-001 disetujui | ADR-001..009 punya konteks, opsi, tradeoff, keputusan, rollback, dan disetujui founder | — | Ya |
| 3 | **P0-003** Workspace scaffold | P0-002 | `pnpm install --frozen-lockfile` reproducible dari clone bersih. TS strict. Script lint/typecheck/test/build ada. `.gitignore`, `.editorconfig`, `.nvmrc`, `.dockerignore` | TEST-REPO-03, 04, 05, 08, 09, 10 | Ya |
| 4 | **P0-014a** CI dasar | P0-003 | Workflow PR menjalankan lint/typecheck/test/build + secret scan. `permissions: contents: read`. Action dipin SHA | TEST-CI-01..03, 05, 07, 10 | Sebagian (perlu GitHub Actions aktif di repo, **NOT VERIFIED**) |
| 5 | **P0-004** Environment validation | P0-003 | Config bertipe dan fail-fast. Secret yang hilang menghentikan startup dengan pesan aman. `.env.example` berisi placeholder saja. Redaksi aktif | TEST-ENV-01..10 | Ya |
| 6 | **P0-005** Database & migrations | P0-004 | DB kosong bisa dimigrasi, rerun aman, checksum dan drift terdeteksi, role DB terpisah. Tidak ada tabel artikel/sumber. `compose.yaml` khusus `db` | TEST-DB-01..10 | Ya (Docker manual) |
| 7 | **P0-006** API skeleton | P0-005 | `/health/live` publik minimal. `/health/ready` internal. Error envelope stabil. Validasi schema dan batas ukuran body. Request ID. Log ter-redaksi. Tanpa stack trace | TEST-API-01..10 | Ya |
| 8 | **P0-007** Founder bootstrap | P0-005 | CLI lokal membuat tepat satu founder. Bootstrap kedua ditolak. Password tidak pernah di-log. Tidak ada endpoint HTTP | TEST-AUTH-10 | Ya |
| 9 | **P0-010** Session & CSRF | P0-006, P0-007 | Token opaque di-hash. Cookie `HttpOnly`/`Secure`/`SameSite`. Rotasi, expiry, dan revoke berjalan. Logout server-side. CSRF ditolak. Fail-closed saat DB mati | TEST-SESSION-01..10, TEST-CSRF-01..10 | Ya |
| 10 | **P0-008** Password login | P0-010 | Argon2id. Pesan gagal generik. Tanpa enumerasi akun. Rate limit + lockout. Hanya menerbitkan challenge (tanpa sesi penuh) | TEST-AUTH-01..09 | Ya |
| 11 | **P0-009** MFA enrolment & recovery | P0-008 | Enrol, tolak kode salah/kedaluwarsa/replay, recovery code sekali pakai dan di-hash. Sesi baru terbit setelah MFA. Alur enrolment pertama aman (K-14) | TEST-MFA-01..10 | Ya |
| 12 | **P0-011** Protected web shell | P0-009 | Landing publik, `/os/login`, `/os` placeholder. Anonim di-redirect. API tetap menolak tanpa sesi. Baseline aksesibilitas (fokus, kontras AA, 320px, reduced motion) | TEST-WEB-01..10 | Ya (Playwright tersedia) |
| 13 | **P0-012** Compose topology | P0-011 | `docker compose config` valid. Web/API/DB berjalan. DB tanpa `ports:`. User non-root. Healthcheck. Tanpa tag `latest`. Tanpa secret di image | TEST-COMPOSE-01..10 | Ya (Docker manual) |
| 14 | **P0-013** Reverse proxy & TLS | P0-012 | Konfigurasi Caddy valid, routing same-origin, header keamanan, rehearsal HTTPS (CA lokal) terdokumentasi. DNS live tidak disentuh | TEST-OPS-01..04 | Sebagian: TLS publik **NOT RUN** sampai ada VPS + domain |
| 15 | **P0-015** Backup & recovery | P0-012 | Backup terenkripsi, kunci salah ditolak, restore ke DB terisolasi merekonstruksi skema dan data, permission 0600, retensi terdokumentasi | TEST-BACKUP-01..10 | Ya untuk lokal. Offsite **NOT RUN** sampai D-04 diputuskan |
| 16 | **P0-014b** CI lengkap | P0-015 | Tes integrasi dengan service Postgres, dependency audit, Dependabot, lockfile mismatch memblokir, kode rusak sengaja → CI merah | TEST-CI-04, 06, 08, 09 | Perlu GitHub Actions |
| 17 | **P0-016** Exit audit & handoff | Semua | `ACCEPTANCE.md` memuat semua gate PASS/FAIL/NOT RUN + bukti, runbook, risiko yang tersisa. Founder menulis **PHASE 0 ACCEPTED** | Seluruh matriks (130 spec) + TEST-OPS-05..10 | Sebagian (OPS di VPS) |

PRD §14 berisi **130 test spec** di 13 kategori (REPO, ENV, DB, API, AUTH, MFA, SESSION, CSRF, WEB, COMPOSE, OPS, BACKUP, CI; masing-masing 10). Setiap spec dihitung NOT RUN sampai ada file tes dan output nyata.

### 6.3 Exit criteria Phase 0 (gabungan B §1, §12, A §15)

1. Clone bersih → copy `.env.example` → isi secret lokal → **satu** perintah bootstrap → landing publik dan `/os` (redirect ke login) bisa diakses.
2. Founder bisa login dengan password + MFA lewat sesi lokal yang aman. Anonim ditolak di `/os` dan `/api/v1/os/ping`.
3. Migrasi berjalan di DB kosong dan setelah restart. Bootstrap aman dan sekali jalan.
4. Cookie flags, CSRF, rate limit, dan revoke sesi sudah dites. Tidak ada enumerasi akun.
5. DB tidak bisa diakses publik. Tidak ada secret plaintext di Git. Log ter-redaksi dan memuat request ID.
6. CI lint/typecheck/unit/integration/build hijau.
7. Backup dibuat (terenkripsi sesuai ketentuan) dan berhasil di-restore ke DB terisolasi.
8. Reverse proxy HTTPS tervalidasi di lingkungan deploy (atau NOT RUN dengan alasan, bila VPS belum ada).
9. `docs/phase-0/ACCEPTANCE.md` lengkap dan founder menulis **PHASE 0 ACCEPTED**.

**Stop rule:** gate wajib gagal → perbaiki atau tandai BLOCKED. Phase 1 tidak dimulai otomatis.

## 7. Dependensi

### 7.1 Teknis

| Dependensi | Status | Ditangani di |
|---|---|---|
| Node.js LTS (v24 atau v26) | Belum dipilih. Sesi ini memakai v22 | ADR-001 / P0-003 |
| pnpm (versi + cara instal) | Belum dipilih (K-09) | ADR-001 |
| Next.js 16.x, Fastify/Express, Zod | Belum dipin | ADR-002 / P0-003 |
| ORM/migrasi (Drizzle / Prisma / SQL) | Belum dipilih | ADR-003 |
| Library Argon2id + TOTP | Belum dipilih | ADR-004/005 |
| PostgreSQL major version | Belum dipilih. Probe memakai 16 | ADR-003 |
| Caddy | Belum dipilih | ADR-006 |
| Docker daemon di cloud session | Bisa, tapi manual | Setiap tiket Compose/DB |
| GitHub Actions di repo | **NOT VERIFIED** | P0-014a |

### 7.2 Keputusan founder

| ID | Pertanyaan | Dibutuhkan sebelum |
|---|---|---|
| D-01 | Setujui ADR-001..009 (lihat `ADR-PROPOSALS.md`) | P0-003 |
| D-02 | Setujui urutan eksekusi §6.1 | P0-003 |
| D-03 | MFA: TOTP (authenticator app) atau passkey/WebAuthn? Proses recovery? | P0-009 |
| D-04 | Lokasi backup offsite terenkripsi dan siapa yang memegang kredensial | P0-015 |
| D-05 | Boleh commit PRD master ke `docs/prd/`? (K-08) | P0-002 |
| D-06 | Urutan fase resmi pasca-Phase 0 (K-06) | Phase 1 |
| D-07 | OS lokal founder dan apakah Docker terpasang (PRD §20 Q2) | P0-003 (dokumentasi) |
| D-08 | Provider VPS, spek, versi Ubuntu, domain & DNS (PRD §20 Q3) | P0-013 / produksi |
| D-09 | Deploy produksi masuk scope Phase 0 sekarang atau cukup fondasi lokal? (PRD §20 Q6) | P0-013 |

Jangan pernah mengirim password, recovery code, SSH private key, atau token lewat chat. Cukup kirim nama atau status konfigurasinya.

## 8. Status migrasi branch `master` → `main`

| Langkah | Status | Bukti |
|---|---|---|
| Buat `main` dari `master` (tanpa force) | PASS | `git branch main master` |
| Push `main` + set upstream | PASS | `* [new branch] main -> main` · `branch 'main' set up to track 'origin/main'` |
| Verifikasi SHA identik | PASS | local `main` = `origin/main` = `origin/master` = `5ddf36b64991e4aed7de2e49c3575bdc20464cad` |
| Riwayat commit utuh | PASS | `git log main`: `5ddf36b`, `4645f81` |
| Ganti default branch GitHub ke `main` | **PASS**: diubah manual oleh founder di Settings, lalu diverifikasi | Sebelum: `ref: refs/heads/master HEAD` · Sesudah: `git ls-remote --symref https://github.com/welldan23/nalara HEAD` → `ref: refs/heads/main HEAD` |
| Hapus `master` | **PASS**: disetujui founder. Lokal dihapus Claude (`git branch -d master`). Remote dihapus manual oleh founder karena push delete dari sesi ditolak `HTTP 403` | `git ls-remote origin` → hanya `main` + branch fitur · `[pruned] origin/master` |

**Langkah manual founder:**
1. ~~GitHub → `welldan23/nalara` → **Settings → General → Default branch** → ganti ke `main` → konfirmasi.~~ Selesai dan terverifikasi.
2. **Settings → Branches/Rules** untuk `main`: wajib PR, larang force push dan delete. Founder menyatakan sudah dipasang (tidak bisa diverifikasi dari sesi ini). "Wajib CI hijau" ditambahkan setelah P0-014a.
3. ~~Hapus `master`~~ Selesai dan terverifikasi.

## 9. Evidence (perintah yang dijalankan)

| Perintah | Output (ringkas) |
|---|---|
| `git status --short` | kosong (bersih) |
| `git ls-remote origin` (sebelum migrasi) | `5ddf36b… HEAD`, `5ddf36b… refs/heads/master` |
| `git ls-remote --symref origin HEAD` (setelah migrasi) | `ref: refs/heads/master HEAD` |
| `git ls-files \| wc -l` | `163`, semuanya `.claude/skills/**` |
| `git grep` pola secret (key/token/private key, AWS, GitHub, OpenAI) | tidak ada temuan |
| `node --version` · `npm --version` · `corepack --version` · `pnpm --version` | `v22.23.4` · `10.9.9` · `0.36.0` · `10.28.0` |
| `docker --version` · `docker compose version` | `29.9.2` · `v5.6.1` |
| `docker info` (sebelum `dockerd`) | `failed to connect to the docker API … no such file or directory` |
| `dockerd` lalu `docker pull postgres:16-alpine` + `docker run` + `psql select version()` | `PostgreSQL 16.15 on x86_64-pc-linux-musl`. Container probe dihapus lagi (`docker ps -a` = 0) |
| `npm view <pkg> version` | `next 16.4.4`, `drizzle-orm 0.45.4`, `argon2 0.45.2`, `@node-rs/argon2 2.2.2`, `otplib 13.6.0`, `zod 4.6.7`, `pnpm 12.16.1` |
| `curl https://nodejs.org/dist/index.json` (3 LTS teratas) | `v26.13.0 Lithium`, `v24.22.2 Krypton`, `v24.22.1 Krypton` |

## 10. Yang sengaja tidak dilakukan

- Tidak ada scaffold, `package.json`, kode aplikasi, migrasi, atau CI. Semua itu menunggu approval ADR dan urutan tiket.
- Tidak mengubah setting GitHub dan tidak menghapus branch `master`.
- Tidak menyalin PRD ke repo (menunggu D-05).
- Tidak membaca detail Phase 1–9 baris per baris. Yang diperiksa hanya struktur dan daftar tiketnya, untuk mendeteksi konflik K-06.
