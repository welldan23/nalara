# NALARA Phase 1 — Baseline audit dan rencana (P01-000)

| Field | Value |
|---|---|
| Fase | Phase 1 — NALARA Media + editorial CMS |
| Tanggal audit | 2026-11-03 (UTC) |
| Commit yang diaudit | `main` @ `fbe8dac` (Phase 0 diterima, D-16) |
| Sumber | [PRD master v3](../prd/NALARA_Master_PRD_Full_Phases_0-9_v3.md): bagian A §2–§9, §14–§16; bagian C Phase 01 dan P02-001/002; bagian D |
| Status | **USULAN**: menunggu review dan persetujuan founder. Belum ada kode yang ditulis |

> Audit ini read-only: tidak ada kode aplikasi, migrasi, atau dependensi yang diubah.
> Implementasi tiket Phase 1 baru dimulai setelah founder menyetujui dokumen ini dan [ADR-PROPOSALS.md](ADR-PROPOSALS.md).

## 1. Ringkasan

- **Gate masuk Phase 1 terpenuhi:**
  - Phase 0 diterima (D-16).
  - CI hijau di `main`.
  - Rencana backup dan migrasi terdokumentasi (ADR-007, ADR-010, runbook).
  - Advisory kritis di dependensi produksi = 0.
- **Target Phase 1 (PRD A §15):** homepage, halaman topik dan artikel, tipografi editorial, CMS (draft → revisi → review → approve → publish), sitasi sumber, SEO, mekanisme koreksi.
- **Exit:**
  - Founder menerbitkan **3 artikel orisinal bersumber** dari ujung ke ujung.
  - Pengunjung anonim tidak bisa melihat draft.
  - Halaman publik lolos cek mobile dan SEO.
  - Restore backup teruji.
- **12 tiket** diusulkan (§5), mengikuti urutan D-06: P02-001/002 sebelum P01-004.
- **20 konflik atau ambiguitas** ditemukan (§3). Hanya **3 yang butuh keputusan founder** (§7). Sisanya punya rekomendasi default yang bisa langsung jalan bila disetujui.
- **7 ADR baru** diusulkan (ADR-011..017) di [ADR-PROPOSALS.md](ADR-PROPOSALS.md).

## 2. Titik awal (warisan Phase 0)

| Sudah ada | Dipakai Phase 1 untuk |
|---|---|
| API Fastify sebagai satu-satunya pemilik logic dan DB (ADR-002) | Semua endpoint artikel, publik maupun OS |
| Next.js tanpa akses DB; `proxy.ts` hanya UX | Halaman publik dan OS mengambil data dari API secara server-side |
| Sesi + MFA + CSRF + rate limit (ADR-004/005) | Semua mutasi CMS di `/api/v1/os/*` |
| `users.role = 'founder'` (maks. 1), `audit_events` append-only (ADR-009) | `approved_by`, audit publikasi |
| Migrasi SQL + checksum (ADR-010), role `nalara_app` DML-only | Tabel konten baru |
| Token desain (`apps/web/lib/tokens.ts`), shell `/os`, `robots: noindex` | Desain editorial; noindex tetap aktif sampai launch |
| CI 6 job, e2e Playwright, compose smoke, backup drill | Gate setiap tiket |
| Backup `pg_dump` terenkripsi | **Belum** mencakup file media (lihat S1-11) |

## 3. Konflik, ambiguitas, dan rekomendasi

| ID | Temuan | Sumber | Rekomendasi | Butuh founder? |
|---|---|---|---|---|
| KP1-01 | Isi Phase 1 di A §15 mencakup "OS dashboard" dan "initial manual Source Registry". Di C, keduanya ada di Phase 02 (P02-001, P02-005), dan exit Phase 01 hanya menyebut P01-001..010 | A §15 vs C | Ikuti D-06: P02-001/002 masuk Phase 1. Source Registry manual (P02-005) **tidak** masuk; sitasi Phase 1 berdiri sendiri (KP1-11) | Tidak (sudah D-06) |
| KP1-02 | Nama route: A memakai `/artikel/[slug]` dan `/topik/[slug]` (Indonesia), C menyebut "category listing" | A §4.1 vs C P01-002 | Route publik berbahasa Indonesia (`/artikel`, `/topik`). Tabel tetap `categories` (A §7.1). UI menyebutnya "Topik" | Tidak |
| KP1-03 | Format isi artikel dan editor belum dipilih (R-06). AC-OS-03 mewajibkan sanitasi, tanpa script | A §3.2, §17 | ADR-011: isi disimpan sebagai **blok JSON tervalidasi**, bukan HTML. Penulis mengetik Markdown terbatas di textarea, API mengubahnya jadi blok, React merender (auto-escape). Tanpa rich-text editor berat dan tanpa HTML mentah | Setujui ADR |
| KP1-04 | Model artikel §9 (headline, dek, lead, konteks, inti fakta, dampak, sumber, catatan metode) tidak sama dengan tabel §7.1 (title, excerpt, body) | A §7.1 vs §9 | `title`, `dek` (= excerpt), `body` (blok), `article_type` (`explainer`/`analysis`/`opinion`, untuk label D11), `method_note` opsional. Bagian konteks/dampak cukup jadi heading di body | Tidak |
| KP1-05 | Status `scheduled` butuh worker/scheduler, yang baru ada di fase ingestion. "Schedule publish" juga prioritas P1 di A §2 | A §7.1, §2 | Status `scheduled` **ditunda**. Phase 1: `draft → in_review → approved → published → archived`, plus `rejected → draft` | Tidak |
| KP1-06 | Approval harus terikat revisi tertentu; edit setelah approve membatalkan approval (§7.1, T-03) | A §7.1, §9 | ADR-012: approval menyimpan `revision_id`. Publish hanya bila revisi terbaru = revisi yang di-approve. Optimistic concurrency lewat `version` (T-11) | Setujui ADR |
| KP1-07 | Satu founder adalah penulis sekaligus approver. "Approve" tidak boleh cuma formalitas | AC-OS-02 | Approve dan publish adalah aksi terpisah yang tercatat (`approved_by`, waktu, revision ID, audit). Re-auth (step-up) **tidak** diwajibkan di Phase 1, karena semua sesi sudah lewat MFA dan idle 1 jam. Ditinjau lagi saat ada AI/Telegram | Tidak |
| KP1-08 | C meminta "controlled rollout flag" untuk perubahan publik, tapi feature flag DB baru ada di P02-006 | C P01-*, P02-006 | ADR-015: flag lewat env (`PUBLIC_SITE_ENABLED`, default `false`). Selama `false`, halaman publik baru hanya tampil di non-produksi, dan `noindex` tetap aktif | Tidak |
| KP1-09 | Web tidak punya akses DB. Publish harus "invalidate cache, update sitemap" (§9) | ADR-002, A §9 | ADR-013: halaman publik dirender dinamis dari API tiap request, tanpa ISR. Sitemap juga dinamis. Cache HTTP pendek (`s-maxage` kecil) bisa ditambah nanti setelah diukur | Setujui ADR |
| KP1-10 | Daftar topik awal (NAL-002 seed categories) belum ditentukan | A §16, persona §1.3 | Usulan: **Ekonomi, Teknologi, Kebijakan** (dari persona). Ditambah lewat migrasi atau CRUD nanti | **Ya (D-17)** |
| KP1-11 | `article_sources.source_id` merujuk Source Registry yang belum ada | A §7.1 | Kolom `source_id` nullable disiapkan tapi belum dipakai. Phase 1: sitasi berisi URL (http/https saja), judul, penerbit, tanggal akses, catatan klaim, `verified_at` | Tidak |
| KP1-12 | "Minimal satu sumber terverifikasi" dan "angka penting dengan periode, unit, rujukan" (AC-MEDIA-02/03, T-13) perlu bisa ditegakkan, bukan cuma imbauan | A §3.1, §9, D11 | Blok `stat` khusus: nilai, unit, periode, dan rujukan sitasi wajib diisi. Gate publish memblokir: tanpa sumber terverifikasi, `stat` tanpa sumber, atau sumber belum `verified_at`. Pengecualian butuh alasan editorial tertulis yang ikut tercatat di audit | Tidak |
| KP1-13 | Exit A mensyaratkan 3 artikel orisinal oleh founder. AI dilarang mengarang kutipan, sumber, atau angka (§9, D7) | A §15, D7 | Isi 3 artikel ditulis founder. Claude hanya membangun alat dan fixture tes yang jelas palsu (`example.invalid`, ditandai TEST), dan tidak pernah masuk DB produksi | Tidak (info) |
| KP1-14 | Phase 1 membuat situs layak publik, tapi gate produksi R-01 (offsite backup) dan R-02 (VPS/TLS) masih terbuka | ACCEPTANCE §6 | Phase 1 dibangun dan dites lokal + CI. Go-live publik tetap butuh D-04/D-08/D-09 | **Ya (D-18)** |
| KP1-15 | Layout saat ini memaksa `noindex` untuk seluruh situs | `apps/web/app/layout.tsx` | `noindex` dicabut hanya bila `PUBLIC_SITE_ENABLED=true` (P01-008). `/os/*` selalu `noindex` + `Disallow` | Tidak |
| KP1-16 | CSP masih `'unsafe-inline'`. Konten artikel menaikkan taruhan XSS | ACCEPTANCE R-04 | ADR-017: CSP berbasis nonce dimajukan ke P01-010, karena halaman sudah dinamis (KP1-09). Dibuktikan lewat tes e2e | Setujui ADR |
| KP1-17 | Koreksi: A §2 menaruh "koreksi publik" di P1, tapi AC-MEDIA-05 (P0) dan C P01-007 memasukkannya ke Phase 1 | A §2 vs §3.1, C | Catatan koreksi per artikel + halaman `/koreksi` (murah karena datanya sama). Search, RSS publik, dan jadwal tayang ditunda | Tidak |
| KP1-18 | P02-002 "role-based authorization", padahal hanya ada satu role | C P02-002, ADR-009 | P02-002 jadi modul **kebijakan otorisasi** eksplisit: peta aksi → izin, deny-by-default, cek objek. Belum ada role baru | Tidak |
| KP1-19 | Rich-text editor (TipTap/ProseMirror dll.) membawa banyak dependensi, bertabrakan dengan kebijakan supply chain | ADR-001, A §17 R-06 | Textarea + preview server-side (ADR-011). Editor visual bisa jadi ADR terpisah bila benar-benar dibutuhkan | Tidak |
| KP1-20 | Slug artikel bisa berubah dan memutus tautan atau SEO | A §7.1, P01-008 | ADR-016: slug unik, huruf kecil, `[a-z0-9-]`, bisa diubah **hanya sebelum publish pertama**. Setelah itu dikunci; redirect slug ditunda | Tidak |

## 4. Risiko keamanan Phase 1

| ID | Risiko | Mitigasi yang direncanakan | Tes |
|---|---|---|---|
| S1-01 | XSS lewat isi artikel, judul, atau sitasi | Blok JSON tanpa HTML (ADR-011), React escaping, URL sitasi hanya http/https, CSP nonce (ADR-017) | T-05, e2e payload XSS di semua field |
| S1-02 | Draft bocor ke publik (API publik, SSR, sitemap, preview) | API publik hanya membaca `status = 'published'` lewat satu fungsi query; preview hanya di `/os` (auth); sitemap dari query yang sama | T-02, tes "draft tidak muncul" di 4 jalur |
| S1-03 | Enumerasi draft lewat slug/ID (status 403 vs 404 berbeda) | Publik selalu 404 identik untuk yang tidak ada dan yang belum terbit | Tes perbandingan respons |
| S1-04 | IDOR / akses objek | Kebijakan otorisasi P02-002 dipakai di setiap route OS | Tes negatif per endpoint |
| S1-05 | Publish tanpa approval, atau approval basi (edit setelah approve) | Backend memeriksa state + `revision_id` + `version` dalam satu transaksi | T-03, T-04, T-11 |
| S1-06 | Race dua tab editor | Optimistic concurrency (`version`), 409 bila basi | T-11 |
| S1-07 | Tautan sitasi berbahaya (`javascript:`, open redirect) | Validasi skema URL di API; `rel="noopener noreferrer nofollow"`; tanpa fetch otomatis URL (tanpa SSRF di Phase 1) | Unit + e2e |
| S1-08 | Upload media berbahaya (polyglot, SVG berisi script, file raksasa) | Hanya PNG/JPEG/WebP; cek magic bytes + dimensi; batas ukuran; SVG ditolak; disajikan dengan `Content-Type` tetap + `nosniff` | Tes file palsu |
| S1-09 | Metadata EXIF/GPS bocor dari foto | Segmen metadata JPEG/PNG/WebP dibuang sebelum disimpan | Tes fixture ber-GPS |
| S1-10 | Audit kurang lengkap untuk aksi editorial | Audit untuk create, edit, submit, approve, reject, publish, archive, correction, upload | Tes audit per aksi |
| S1-11 | **Backup belum mencakup media** | `backup.sh` diperluas untuk volume media (terenkripsi `age`); restore drill memeriksa file | Perluasan TEST-BACKUP |
| S1-12 | Situs terindeks mesin pencari sebelum siap | `noindex` + flag `PUBLIC_SITE_ENABLED` default `false` | Tes header/meta per mode |
| S1-13 | Payload besar di editor (DoS) | Batas body API saat ini 16 KiB (global), Caddy 1 MB. Route simpan draft butuh batas per-route lebih besar (usulan 256 KiB, ADR-011), ditambah batas jumlah blok, sitasi, dan panjang field | Tes batas |

## 5. Rencana tiket Phase 1 (urutan pengerjaan)

Satu tiket per PR, branch `feat/P01-0XX-nama` (atau `feat/P02-0XX-nama`), merge otomatis setelah CI hijau (D-14).

| # | Tiket | Isi | Exit criteria | Tes utama |
|---|---|---|---|---|
| 1 | **P02-001** Shell dashboard OS + navigasi | Layout `/os` dengan navigasi (Ringkasan, Newsroom, Audit, Pengaturan), state kosong/loading/error | Semua route OS di balik sesi (server-side); keyboard + 320 px OK | e2e akses anonim, a11y |
| 2 | **P02-002** Kebijakan otorisasi | Modul izin deny-by-default, dipakai semua route `/api/v1/os/*`, cek objek | Route OS tanpa kebijakan = tes gagal | Unit kebijakan, tes "semua route terlindungi" |
| 3 | **P01-004** Skema konten + riwayat revisi | Migrasi `categories` (+ seed D-17), `articles`, `article_revisions`; API buat/edit draft (versi optimistik); editor textarea + preview | Setiap simpan = revisi immutable baru; konflik versi = 409 | DB, API, revisi, XSS (S1-01) |
| 4 | **P01-006** Sitasi dan provenance | `article_sources`, blok `stat`, verifikasi sitasi oleh founder | Blok `stat` tanpa sitasi ditolak | Validasi, URL skema, T-13 |
| 5 | **P01-005** State machine + gate publish | Submit, approve (terikat revisi), reject, publish, archive; `publication_events`; gate §9 | Publish tanpa approval valid / revisi berubah / tanpa sumber = ditolak | T-03, T-04, T-11, audit |
| 6 | **P01-003** Halaman baca artikel | `GET /api/v1/public/articles/:slug`, `/artikel/[slug]`, tampilan sitasi dan tanggal | Draft = 404 identik; hanya published | T-01, T-02, S1-02/03 |
| 7 | **P01-001** Homepage + navigasi | Beranda editorial, navigasi topik, `/tentang` | Tanpa data admin di HTML publik | e2e, a11y, 320 px |
| 8 | **P01-002** Halaman topik + paginasi | `/topik/[slug]`, cursor pagination di API | Cursor tidak bisa memunculkan draft; limit dibatasi | Paginasi, negatif |
| 9 | **P01-007** Koreksi + changelog | Koreksi sebagai revisi baru + catatan publik, `/koreksi` | Riwayat internal tidak terhapus (AC-MEDIA-05) | Koreksi, audit |
| 10 | **P01-008** SEO | Metadata, canonical, Open Graph, `sitemap.xml`, `robots.txt`, flag `noindex` | Sitemap hanya artikel published; `/os` selalu disallow | Tes SEO, S1-12 |
| 11 | **P01-009** Media, lisensi, alt text | Upload gambar ke volume lokal, validasi, buang EXIF, wajib lisensi + alt text, backup media | Media tanpa lisensi/alt diblokir dari publish | S1-08/09/11, TEST-BACKUP |
| 12 | **P01-010** Desain responsif + aksesibilitas + CSP nonce, lalu exit audit Phase 1 | Tipografi editorial, kontras AA, reduced motion, CSP nonce, `docs/phase-1/ACCEPTANCE.md` | Semua gate exit A §15 + C Phase 01 dengan bukti | e2e lengkap, a11y, CSP |

**Bukan Phase 1 (ditunda):** search `/cari`, RSS publik, jadwal publish, Source Registry, ingestion, AI/Telegram, akun pembaca, feature flag di DB (P02-006), editor visual.

**Tugas founder di akhir Phase 1:** menulis dan menerbitkan 3 artikel orisinal bersumber lewat CMS, lalu memberi go/no-go tertulis.

## 6. Dependensi baru yang diperkirakan

Semua tetap mengikuti kebijakan: dipin persis, lolos `minimumReleaseAge` 7 hari, tanpa install script, dan alasannya ditulis di PR.

| Kebutuhan | Rencana | Alasan |
|---|---|---|
| Parsing Markdown terbatas → blok | Parser kecil sendiri (subset: paragraf, heading, daftar, kutipan, tautan, tebal/miring, blok `stat`) | Hindari HTML sama sekali dan pohon dependensi besar |
| Validasi gambar + buang EXIF | Parsing header PNG/JPEG/WebP sendiri, tanpa re-encode | `sharp` butuh binary native dan install script (diblokir) |
| Tanggal/zona waktu | `Intl` bawaan Node | Tanpa dependensi |

Kalau parser sendiri ternyata terlalu berisiko, alternatifnya `micromark`/`mdast` dengan **tanpa** HTML. Keputusan ini masuk ADR-011.

## 7. Keputusan founder yang dibutuhkan (hanya 3)

| ID | Pertanyaan | Usulan default |
|---|---|---|
| D-17 | Topik awal apa saja? | **Ekonomi, Teknologi, Kebijakan** |
| D-18 | Setelah Phase 1, langsung go-live terbatas (butuh D-04/D-08/D-09 diputuskan di tengah Phase 1), atau tetap internal sampai fase berikutnya? | Tetap internal dulu. Go-live diputuskan saat exit Phase 1 |
| D-19 | Setujui rencana ini + ADR-011..017? | — |

## 8. Bukti audit (yang dijalankan)

- `git log --oneline -1` di `main` → `fbe8dac Merge PR #21: record PHASE 0 ACCEPTED (D-16)`
- Pembacaan PRD: A §1–§9, §14–§17; C Phase 01 (P01-001..010 + gate exit) dan P02-001..010; D1–D12
- Status CI `main` terakhir: hijau (PR #21, 6/6)
- Kode sumber, migrasi, dan layout web saat ini dibaca untuk §2 dan KP1-15

**Tidak dilakukan:** tidak ada kode, migrasi, atau dependensi baru. Tidak ada riset online tentang lisensi sumber atau gambar (belum relevan sebelum ada konten nyata).
