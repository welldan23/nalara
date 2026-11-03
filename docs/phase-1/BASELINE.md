# NALARA Phase 1 — Baseline audit dan rencana (P1-00, revisi 2)

| Field | Value |
|---|---|
| Fase | Phase 1 — Media + CMS + soft launch |
| Tanggal | 2026-11-04 (UTC). Revisi 1 tertanggal 2026-11-03 berbasis PRD v3 |
| Commit dasar | `main` @ `eeba6e2` |
| Sumber utama | [PRD v4 ringkas](../prd/NALARA_PRD_v4_ringkas.md) §1–§10 (menggantikan v3 untuk Phase 1, menunggu D-20) |
| Referensi | [VORSA × SENTINEL](REFERENCE-VORSA.md) (source code + database lama dari founder) |
| Status | **USULAN**: menunggu founder. Belum ada kode |

> Read-only: tidak ada kode aplikasi, migrasi, atau dependensi yang berubah.
> Implementasi dimulai setelah founder menyetujui dokumen ini dan [ADR-PROPOSALS.md](ADR-PROPOSALS.md) (D-19).

## 1. Apa yang berubah dari revisi 1

| Topik | Revisi 1 (PRD v3) | Revisi 2 (PRD v4 + VORSA) |
|---|---|---|
| Penomoran tiket | P01-001..010 + P02-001/002 | **P1-01..P1-10** (PRD v4 §10.1) |
| Source Registry manual | Ditunda | **Masuk Phase 1** (P1-05) |
| Deploy + soft launch | Di luar Phase 1 (D-18) | **Exit Phase 1** (P1-10). Butuh VPS, domain, dan backup offsite (D-04/D-08/D-09) |
| Prasyarat Phase 1 | Phase 0 diterima | Phase 0 diterima **+ hasil validasi pembaca** (PRD v4 §2, §3), lihat KP1-21 |
| Arsitektur | Fastify + Next (ADR-002) | PRD v4 default satu app Next.js. Usulan: **tetap Fastify** (KP1-22) |
| Verifikasi sumber | "Minimal satu sumber terverifikasi" | Label verifikasi yang **dihitung** dari sitasi (VORSA A-1) |
| Approval | Terikat `revision_id` | Terikat `revision_id` + **hash isi** (VORSA A-4) |
| Revisi immutable | Di kode | Juga di **database** (VORSA A-3) |
| RSS publik | Ditunda | Opsional di Phase 1 (PRD v4 §4.1) |

## 2. Gate masuk

| Gate (PRD v4 §3) | Status |
|---|---|
| Phase 0 diterima | ✅ D-16 |
| CI hijau di `main` | ✅ 6/6 |
| Hasil validasi pembaca (§2) | ❓ **Belum ada data**. Lihat KP1-21 dan D-21 |

## 3. Konflik dan ambiguitas (diperbarui)

Konflik revisi 1 yang tetap berlaku: KP1-02 (route Indonesia), KP1-03 (format isi), KP1-04 (model artikel), KP1-06 (approval per revisi), KP1-07 (founder = penulis = approver), KP1-08 (flag rollout), KP1-09 (render dinamis), KP1-12 (gate angka), KP1-13 (3 artikel ditulis founder), KP1-15 (`noindex`), KP1-16 (CSP nonce), KP1-19 (tanpa editor berat), KP1-20 (slug).

Yang berubah atau baru:

| ID | Temuan | Rekomendasi | Butuh founder? |
|---|---|---|---|
| KP1-01 | (diganti) Source Registry manual kini Phase 1 (P1-05) | Tabel `sources` dengan status + lisensi, tanpa fetch otomatis. Sitasi boleh menautkan ke sumber terdaftar (`source_id` opsional) | Tidak |
| KP1-05 | `scheduled` tidak ada di state machine v4 | Sesuai v4: `draft → in_review → approved → published → archived`, `in_review → draft` (ditolak) | Tidak |
| KP1-10 | Topik awal | Usulan: **Ekonomi, Teknologi, Kebijakan** (persona v4 §1.3) | **Ya (D-17)** |
| KP1-11 | (diganti) `article_sources.source_id` bisa merujuk Source Registry P1-05 | Kolom nullable. Sitasi tanpa registry tetap boleh (URL penerbit) | Tidak |
| KP1-14 | (diganti) Soft launch adalah exit Phase 1 | P1-10 butuh D-04 (offsite), D-08 (VPS + domain), dan D-09 (jadwal). Bisa diputuskan nanti; tiket P1-01..09 tidak terhambat | Ya, sebelum P1-10 |
| KP1-17 | (diganti) Koreksi + `/koreksi` di Phase 1 (v4 P1-07). RSS publik opsional | RSS publik dikerjakan di P1-08 bila murah (Atom/RSS dari query published yang sama) | Tidak |
| KP1-18 | (dihapus) P02-002 tidak ada di v4 | Modul kebijakan otorisasi tetap dibuat, di dalam P1-01, karena route OS data pertama muncul di sana | Tidak |
| **KP1-21** | PRD v4 menjadikan **hasil validasi pembaca** sebagai prasyarat Phase 1: tulis 5–10 artikel di platform gratis, sebar, ukur. Validasi ini tugas founder dan belum ada datanya | Validasi dijalankan **paralel**: tiket P1-01..P1-09 (alat internal) dikerjakan sekarang, karena artikel validasi nanti dipakai ulang sebagai konten awal. **Soft launch (P1-10)** baru jalan setelah founder memutuskan "lanjut" berdasar hasil validasi | **Ya (D-21)** |
| **KP1-22** | PRD v4 §5.1: default satu aplikasi Next.js; backend terpisah hanya lewat ADR bila kebutuhannya terukur. Repo sudah punya API Fastify terpisah (ADR-002, D-11), diterima di Phase 0 dengan 129/130 tes lulus | **Tetap Fastify** dan catat sebagai addendum ADR-002 (alasan di ADR-018). Menulis ulang ke Next.js = membuang auth, sesi, MFA, CSRF, dan tes yang sudah teruji, tanpa manfaat bagi pembaca. Pemisahan ini juga yang nanti dipakai tool gateway Hermes (Fase 3) | **Ya (D-20)** |
| **KP1-23** | Nama tabel v4 (`founders`, `mfa_credentials`, `target_*`, `occurred_at`) berbeda dengan repo (`users` + `role`, `recovery_codes`, `resource_*`, `created_at`) | v4 §5.3 sendiri bilang "sesuaikan dengan repo yang ada". Tetap pakai skema ADR-009 | Tidak |
| **KP1-24** | Path keputusan v4 `docs/decisions.md` vs repo `docs/decisions/DECISIONS.md` | Tetap path yang ada | Tidak |
| **KP1-25** | Label verifikasi (dari VORSA): RUMOR wajar untuk kanal kabar, tapi NALARA media penjelas | Label dihitung dari sitasi (ADR-019). Hanya **TERVERIFIKASI** dan **SEBAGIAN** yang boleh terbit; RUMOR dan BELUM_TERVERIFIKASI diblokir | Tidak (bisa diubah founder) |
| **KP1-26** | VORSA memakai foto dengan dasar "berita aktual" UU 28/2014 Ps. 43c, dan ilustrasi AI | NALARA default lebih ketat: hanya milik sendiri, domain publik, atau lisensi terbuka yang jelas. Ilustrasi AI boleh, wajib berlabel "Ilustrasi", tidak pernah sebagai foto kejadian. Dasar hukum lain menunggu review legal (R-04) | Tidak (default aman) |

## 4. Risiko keamanan

Tetap S1-01..S1-13 dari revisi 1 (XSS, draft bocor, enumerasi, IDOR, approval basi, race, tautan sitasi, upload, EXIF, audit, backup media, terindeks dini, payload besar). Tambahan:

| ID | Risiko | Mitigasi | Tes |
|---|---|---|---|
| S1-14 | Revisi lama diubah langsung di DB (bug atau penyusup dengan kredensial app) | `nalara_app` tanpa UPDATE/DELETE di `article_revisions` + trigger | Tes SQLSTATE 42501 seperti TEST-DB-07 |
| S1-15 | Isi berubah tanpa membuat revisi baru, padahal approval tetap berlaku | Approval menyimpan SHA-256 isi revisi. Publish menghitung ulang dan mencocokkan | Tes hash tidak cocok → ditolak |
| S1-16 | Label verifikasi "dinaikkan" lewat request klien | Label dihitung ulang di server dari sitasi tiap kali simpan dan publish | Tes request palsu |
| S1-17 | Deploy publik (P1-10): firewall, SSH, TLS, header | Runbook Phase 0 + TEST-OPS di VPS sungguhan | TEST-OPS-01..10 |

## 5. Rencana tiket (PRD v4 §10.1, urutan pengerjaan)

| # | Tiket | Isi utama | Exit criteria | Tes kunci |
|---|---|---|---|---|
| 1 | **P1-01** Skema artikel + revisi | Migrasi `categories` (+ seed D-17), `articles`, `article_revisions` (immutable di DB), `corrections`; modul kebijakan otorisasi OS; API baca/buat draft | Tiap simpan = revisi baru, versi naik; `nalara_app` tidak bisa UPDATE/DELETE revisi | DB, grant, kebijakan, semua route OS terlindungi |
| 2 | **P1-02** Editor draft | Navigasi `/os` (Newsroom), daftar + editor draft (Markdown terbatas → blok, ADR-011), template artikel v4 §7, preview, versi optimistik, peringatan gaya (VORSA A-7), `docs/editorial/PEDOMAN.md` | Edit basi → 409; `<script>` tidak pernah tereksekusi | e2e editor, XSS, 320 px |
| 3 | **P1-04** Sumber per artikel | `article_sources` (https saja, tolak agregator, flag primer, tanggal akses, catatan klaim, `verified_at`); blok angka (`stat`); label verifikasi dihitung (ADR-019) | Angka tanpa periode/satuan/sumber ditolak | Validasi URL, label, T-13 |
| 4 | **P1-03** State machine + gate publish | Submit, approve (revisi + hash), tolak, publish, arsip; `publication_events`; gate v4 §7 | Publish tanpa approval valid / revisi berubah / tanpa sumber / angka tanpa periode = ditolak; audit siapa, kapan, revisi | T-03, T-04, T-11, S1-15/16 |
| 5 | **P1-06** Halaman publik | API publik, `/`, `/topik/[slug]`, `/artikel/[slug]`, `/tentang`; SSR; daftar referensi bisa diklik | Draft → 404 identik untuk anonim | T-01, T-02, a11y, 320 px |
| 6 | **P1-07** Koreksi | Koreksi = revisi baru + catatan publik di artikel dan `/koreksi` | Riwayat lama tidak terhapus | Koreksi, audit |
| 7 | **P1-08** SEO | Title/description, canonical, Open Graph, `sitemap.xml`, `robots.txt`, RSS publik (opsional), flag `PUBLIC_SITE_ENABLED` | Sitemap hanya published dan langsung ikut publish; `/os` selalu disallow | Tes SEO |
| 8 | **P1-05** Source Registry manual | CRUD `sources` (status `candidate/verified/paused/disabled`, lisensi, atribusi), tanpa fetch | Hanya founder; perubahan tercatat audit | CRUD, negatif |
| 9 | **P1-09** Media | Upload PNG/JPEG/WebP (batas ukuran, cek magic bytes, buang EXIF), alt text + lisensi + atribusi + dasar pakai wajib, volume media ikut backup | Lisensi kosong → tidak bisa dipakai di artikel published | S1-08/09/11, TEST-BACKUP |
| 10 | **P1-10** Deploy + hardening + exit | Deploy VPS setelah D-08; HTTPS, header, UFW 22/80/443, SSH key-only, backup harian offsite (D-04), restore drill, runbook; CSP nonce (ADR-017); `docs/phase-1/ACCEPTANCE.md` | Exit v4 §10.3: 3 artikel founder terbit, semua tes §10.2 PASS, restore sukses, situs live | TEST-OPS di VPS, §10.2 |

**Bukan Phase 1:** search, jadwal publish, ingestion RSS, vault bukti otomatis, AI/Telegram, akun pembaca, editor visual.

**Tugas founder:** validasi pembaca (§2 v4, paralel), menulis 3 artikel orisinal, keputusan VPS/domain/backup sebelum P1-10, dan go/no-go **PHASE 1 ACCEPTED**.

## 6. Dependensi

Tetap seperti revisi 1: parser Markdown terbatas sendiri, validasi gambar sendiri (tanpa `sharp`), dan `Intl` bawaan. Tidak ada dependensi baru yang direncanakan untuk P1-01.

## 7. Keputusan founder (yang dibutuhkan sekarang)

| ID | Pertanyaan | Usulan |
|---|---|---|
| D-17 | Topik awal | **Ekonomi, Teknologi, Kebijakan** |
| D-19 | Setujui rencana ini + ADR-011..019 | — |
| D-20 | PRD v4 jadi acuan utama mulai Phase 1, **dengan pengecualian** tetap memakai API Fastify (ADR-002) dan skema Phase 0? | Ya |
| D-21 | Validasi pembaca jalan paralel, dan P1-01..P1-09 dikerjakan sekarang (soft launch menunggu hasil validasi)? | Ya |

D-04, D-08, dan D-09 baru dibutuhkan sebelum P1-10. D-18 (go-live) dijawab oleh PRD v4: soft launch adalah bagian dari Phase 1.

## 8. Bukti audit

- PRD v4 dibaca penuh (409 baris). Disalin ke `docs/prd/` tanpa perubahan (SHA-256 sama dengan file upload).
- VORSA dan Sentinel: struktur, README, ARCHITECTURE, pedoman editorial, SOP, migrasi, dan modul `editorial.py` / `netsafe.py` / `api.py` dibaca. Secret scan bersih. Tidak ada kode yang dijalankan.
- Database lama: hanya skema dan statistik agregat (§2 REFERENCE-VORSA).
- Revisi 1 dokumen ini (PR #22) dipakai sebagai dasar.
