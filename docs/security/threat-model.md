# NALARA — Threat model Phase 0

Cakupan: apa yang benar-benar ada di Phase 0, yaitu satu akun founder, API auth, shell web, database, proxy, CI, dan backup. Ancaman untuk fitur fase berikutnya (ingestion, AI, Telegram, upload) dicatat di bagian akhir supaya tidak lupa. Arsitektur dan batas kepercayaan: [architecture/phase-0.md](../architecture/phase-0.md).

Skala dampak: **Kritis** (akses founder atau data bocor), **Tinggi** (layanan mati atau data hilang), **Sedang**, **Rendah**.

## 1. Aset yang dilindungi

| Aset | Kenapa penting |
|---|---|
| Akses founder ke NALARA OS | Siapa pun yang masuk bisa bertindak atas nama founder di fase berikutnya (menerbitkan, menyetujui) |
| Secret runtime (`SESSION_SECRET`, `MFA_ENCRYPTION_KEY`, password DB) | Bocor = sesi palsu, secret TOTP terbuka, atau DB terbuka |
| Database (identitas, sesi, audit) | Integritas audit dan identitas founder |
| Backup + kunci privat `age` | Backup bocor tanpa kunci aman; kunci hilang = backup tidak bisa dipakai |
| Repo + pipeline CI | Jalur masuk kode ke produksi |

## 2. Ancaman dan mitigasi

| ID | Ancaman | Dampak | Mitigasi yang sudah ada | Bukti | Sisa risiko |
|---|---|---|---|---|---|
| T-01 | Tebak / brute-force password founder | Kritis | Argon2id; lockout akun 5× gagal / 15 menit; rate limit per IP; dummy hash agar waktu respons sama; pesan gagal generik | TEST-AUTH-01..10 | Lockout bisa dipicu penyerang untuk mengunci founder sementara (DoS terbatas 15 menit) |
| T-02 | Password bocor dipakai ulang | Kritis | MFA TOTP wajib sebelum sesi diterbitkan, tidak ada jalan pintas | TEST-MFA-01..10, TEST-WEB-03 | Phishing real-time TOTP tetap mungkin (D-03). Passkey bisa jadi ADR nanti |
| T-03 | Pencurian / penebakan token sesi | Kritis | Token acak 256-bit; DB hanya simpan SHA-256; cookie `__Host-`, HttpOnly, Secure, SameSite=Lax; kedaluwarsa 8 jam / idle 1 jam; logout mencabut di server | TEST-SESSION-01..10 | Malware di perangkat founder tidak bisa dicegah di sisi server |
| T-04 | Replay kode TOTP atau challenge | Tinggi | `totp_last_step` menolak kode lama; challenge sekali pakai, 5 menit, maks. percobaan | TEST-MFA-03..06 | — |
| T-05 | Recovery code bocor atau dipakai ulang | Kritis | Hanya hash SHA-256, sekali pakai, ditampilkan sekali, bisa dirotasi | TEST-MFA-07..09 | Founder wajib menyimpannya offline |
| T-06 | CSRF pada endpoint yang mengubah state | Tinggi | Cek `Origin`/`Sec-Fetch-Site`, token CSRF HMAC, SameSite=Lax, wajib `application/json` | TEST-CSRF-01..10 | — |
| T-07 | XSS di web | Tinggi | React escaping, tanpa `dangerouslySetInnerHTML`, CSP dasar, cookie HttpOnly | TEST-WEB-09 | CSP masih `'unsafe-inline'` (Phase 8) |
| T-08 | Enumerasi akun | Sedang | Respons dan waktu sama untuk akun ada/tidak ada; tanpa registrasi | TEST-AUTH-03 | — |
| T-09 | Melewati otorisasi lewat UI | Kritis | API memeriksa sesi di setiap route `/api/v1/os/*`; `proxy.ts` hanya UX | TEST-SESSION-*, TEST-WEB-02/04 | — |
| T-10 | DB mati → sesi dianggap valid | Kritis | Lookup sesi gagal tertutup (503, bukan lolos) | TEST-SESSION-10 | — |
| T-11 | Database terbuka ke internet | Kritis | Tanpa `ports:`; network `backend` internal; web tidak bisa menjangkau DB; UFW (runbook) | TEST-COMPOSE-02, TEST-OPS-04 | Firewall VPS belum diuji (NOT RUN, D-08) |
| T-12 | Bug aplikasi menghapus/mengubah audit | Tinggi | Role `nalara_app` hanya SELECT + INSERT di `audit_events` | TEST-DB-07 | Superuser DB tetap bisa (akses server = akses penuh) |
| T-13 | Secret masuk git, image, atau log | Kritis | `.gitignore`, gitleaks di CI (seluruh histori), redaksi log (cookie, Authorization, password, token, kode, URL DB), env divalidasi tanpa mencetak nilai, image dicek bebas secret | TEST-ENV-07/08, TEST-COMPOSE-10, TEST-CI-07 | — |
| T-14 | Spoofing `X-Forwarded-For` untuk lolos rate limit | Sedang | API hanya percaya IP tetap Caddy (`TRUSTED_PROXIES`) | `app.test.ts` | — |
| T-15 | Spoofing `X-Request-ID` untuk mengacaukan log | Rendah | Caddy selalu membuat UUID baru | TEST-OPS-03, TEST-API-07/08 | — |
| T-16 | Container dibobol lalu menyebar | Tinggi | Non-root, FS read-only, `cap_drop: ALL`, `no-new-privileges`, tanpa Docker socket, tanpa privileged | TEST-COMPOSE-03/06/09 | Kernel host bersama |
| T-17 | Dependensi berbahaya (supply chain) | Kritis | Versi dipin persis + lockfile; `minimumReleaseAge` 7 hari; script install diblokir; `pnpm audit` + verifikasi tanda tangan registry di CI; action dipin SHA; Dependabot dengan cooldown 7 hari | TEST-REPO-03, TEST-CI-08 | Paket jahat yang lolos >7 hari tanpa ketahuan |
| T-18 | PR jahat mencuri secret CI | Tinggi | Tanpa `pull_request_target`; token read-only; tanpa secret produksi di CI | TEST-CI-10 | Required status checks belum dipasang founder (lihat ACCEPTANCE) |
| T-19 | Data hilang (disk rusak, salah hapus) | Tinggi | Backup harian terenkripsi, retensi 7 harian + 4 mingguan, restore drill teruji, alert umur backup dan disk | TEST-BACKUP-01..10, TEST-OPS-07 | **Offsite belum ada (D-04)**: server hilang = backup ikut hilang |
| T-20 | File backup dicuri | Tinggi | `age` dengan kunci publik saja di server; file 0600 di direktori 0700 | TEST-BACKUP-02/09 | — |
| T-21 | Migrasi diubah diam-diam | Tinggi | Checksum SHA-256 per migrasi; runner menolak jalan bila berbeda | TEST-DB-03 | — |
| T-22 | Founder kehilangan authenticator **dan** semua recovery code | Tinggi | Prosedur darurat dari shell server di [incident runbook](../runbooks/incident.md) §4 | — | Belum ada CLI break-glass yang teruji (lihat ACCEPTANCE, risiko R-05) |
| T-23 | `MFA_ENCRYPTION_KEY` hilang | Tinggi | Runbook: backup kunci offline | — | Tanpa kunci, founder harus enrol ulang MFA (prosedur T-22) |

## 3. Di luar cakupan Phase 0 (dicatat untuk fase berikutnya)

| Ancaman | Fase | Catatan |
|---|---|---|
| SSRF lewat URL sumber | Ingestion | Phase 0 tidak pernah mengambil URL eksternal |
| Prompt injection, persetujuan AI/Telegram palsu | Hermes / Telegram | Harus lewat API dengan nonce bertanda tangan, bukan kredensial DB |
| Upload berbahaya | Media | Belum ada upload sama sekali |
| Worker/agent dibobol | Worker | Identitas container terpisah, tanpa Docker socket |

## 4. Kapan dokumen ini ditinjau ulang

Setiap ada endpoint baru, peran pengguna baru, integrasi pihak ketiga, atau sebelum deploy publik pertama.
