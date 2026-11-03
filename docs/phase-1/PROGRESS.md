# NALARA Phase 1 — Progress

Format per tiket mengikuti PRD v4 §13. Rencana: [BASELINE.md](BASELINE.md) · Keputusan: [DECISIONS.md](../decisions/DECISIONS.md) (D-17..D-22).

### P1-00 — Audit dan rencana Phase 1
- Commit: PR #22 (revisi 1, PRD v3), PR #23 (revisi 2, PRD v4 + referensi VORSA)
- File berubah: `docs/phase-1/{BASELINE,ADR-PROPOSALS,REFERENCE-VORSA}.md`, `docs/prd/NALARA_PRD_v4_ringkas.md`, `docs/decisions/DECISIONS.md`
- Test: docs only; repo tests 28/28, CI 6/6 → PASS
- Keputusan founder: **ACCEPTED** (D-17, D-19, D-20, D-21)

### P1-01 — Skema artikel + revisi
- Commit: lihat PR `feat/P1-01-article-schema`
- File berubah:
  - `db/migrations/0004_editorial_core.sql`, `apps/api/src/db/schema.ts`
  - `apps/api/src/modules/articles/{content,articles}.ts`
  - `apps/api/src/plugins/policy.ts`, `apps/api/src/routes/os.ts`
  - `apps/api/src/lib/errors.ts`, `apps/api/src/modules/audit/audit.ts`
  - Tes: `apps/api/tests/{integration/articles,unit/content,unit/policy}.test.ts`, `integration/db.test.ts`
  - `docs/brand/` (logo beringin, D-22), `docs/adr/README.md`
- Perilaku:
  - Tabel `categories` (seed **Ekonomi, Teknologi, Kebijakan**, D-17), `articles` (identitas + status), `article_revisions` (isi).
  - Setiap simpan = revisi baru dengan versi +1, `content_sha256` kanonik (ADR-012), dan audit `article.create` / `article.revise`.
  - Revisi **immutable di database**: `nalara_app` hanya SELECT/INSERT, ditambah trigger yang juga menghentikan migrator dan superuser (UPDATE, DELETE, TRUNCATE → 42501). Pola dari VORSA × SENTINEL.
  - FK komposit: artikel hanya bisa menunjuk revisinya sendiri (current dan approved).
  - CHECK di DB: approval harus lengkap (revisi + hash + siapa + kapan); status `approved`/`published` mustahil tanpa approval; format slug.
  - Versi optimistik + row lock: editor basi → `VERSION_CONFLICT` (409), tanpa menulis apa pun.
  - Simpan tanpa perubahan ditolak. Slug otomatis dari judul dengan akhiran `-2`, `-3` bila sudah terpakai; slug eksplisit yang terpakai → `SLUG_TAKEN`.
  - Model blok (ADR-011): paragraph, heading (2–3), list, quote, `stat` (nilai, satuan, periode, label, sitasi wajib). Link hanya `https` tanpa kredensial. Objek strict, tanpa HTML, dengan batas ukuran.
  - **Kebijakan otorisasi** (pengganti v3 P02-002): setiap route `/api/v1/os/*` wajib menyatakan `permission`, kalau tidak, API menolak start. Role tanpa izin → 403.
- Test:
  - `pnpm exec vitest run apps/api` (PostgreSQL 18.6) → PASS **217/217**, termasuk:
    - 5 tes skema konten, 3 tes hash, 6 tes slug, 3 tes kebijakan;
    - 12 tes integrasi artikel: seed, revisi, versi basi, balapan 3 editor (T-11, tepat satu menang), validasi, slug, status, jaminan DB untuk app/migrator/superuser, FK silang, invariant approval.
  - Hasil `pnpm run check`, `test:backup`, dan e2e: lihat deskripsi PR.
- Security review: PASS. Belum ada endpoint baru yang terbuka; API HTTP CMS dibuat di P1-02.
- Masalah diketahui: penyimpanan sementara hanya untuk status `draft`. Transisi lain dan edit setelah approve (yang membatalkan approval) dikerjakan di P1-03.
- Keputusan founder: PENDING

### P1-02 — Editor draft
- Commit: lihat PR `feat/P1-02-draft-editor`
- File berubah:
  - API: `apps/api/src/modules/articles/{markdown,warnings}.ts`, `apps/api/src/routes/{articles,os}.ts`, `apps/api/src/app.ts`, `apps/api/src/modules/articles/articles.ts` (list)
  - Web: `apps/web/app/os/(shell)/{layout,page,logout-button}.tsx`, `apps/web/app/os/(shell)/newsroom/{page,editor}.tsx`, `.../newsroom/{baru,[id]}/page.tsx`, `apps/web/components/article-body.tsx`, `apps/web/lib/{api,editor-messages}.ts`, `apps/web/app/globals.css`, `apps/web/public/brand/*`
  - Tes: `apps/api/tests/{unit/markdown,integration/newsroom-api}.test.ts`, `tests/e2e/web.e2e.mjs`
- Perilaku:
  - **API Newsroom** (`/api/v1/os/*`, semua di balik sesi + kebijakan izin; mutasi wajib CSRF + same-origin):
    - `GET /categories`, `GET /articles` (filter status), `GET /articles/:id` (+ riwayat revisi + saran gaya)
    - `POST /articles` (draft baru), `PATCH /articles/:id` (revisi, `expectedVersion` wajib), `POST /articles/preview`
    - Batas body editor 256 KiB (global tetap 16 KiB). Id yang rusak dijawab 404, sama seperti yang tidak ada.
  - **Parser Markdown terbatas** (ADR-011): `##`/`###`, tebal, miring, tautan https, daftar, kutipan dengan atribusi wajib. HTML, gambar, kode, tabel, `#` (H1), dan tautan non-https **ditolak dengan nomor baris**. Semua masalah dilaporkan sekaligus. Teks yang cuma mirip markup (`5 < 10`, `snake_case`, `**` tanpa penutup) tetap teks biasa.
  - **Saran gaya** (pola VORSA, tidak memblokir): frasa klise, judul kapital semua / >14 kata / tanda baca berlebihan, dek kosong, artikel panjang tanpa subjudul.
  - **Web:**
    - Shell `/os` dengan navigasi (Ringkasan, Newsroom), logo beringin (D-22), dan tombol keluar.
    - Daftar Newsroom (status, topik, versi, waktu WIB).
    - Editor dengan template PRD v4 §7, pratinjau server-side, catatan perubahan, riwayat revisi, dan pesan konflik versi.
    - Renderer blok tanpa HTML string; tautan dicek ulang harus https.
- Test:
  - `pnpm exec vitest run apps/api` → PASS **246/246**, termasuk 21 tes parser/saran dan 9 tes HTTP: semua route 401 untuk anonim; CSRF salah, tidak ada, atau beda origin → 403; buat/baca/revisi/daftar; 409 editor basi; 404 id rusak; HTML ditolak dengan baris; field asing/status dari klien ditolak; batas 16 KiB vs 256 KiB.
  - `pnpm run test:e2e` → PASS **11/11**. Cek baru TEST-P1-02 lewat Chromium:
    - draft baru, pratinjau, dan HTML ditandai baris 5;
    - simpan ditolak lalu diterima;
    - judul berisi `<img onerror>` tampil sebagai teks dan script tidak jalan;
    - versi 2 masuk riwayat;
    - tab basi mendapat pesan konflik;
    - layout 320 px tanpa scroll horizontal.
- Security review: PASS. Tidak ada `dangerouslySetInnerHTML`; status artikel tidak bisa dikirim klien; semua mutasi lewat CSRF.
- Masalah diketahui: blok angka (`stat`) baru bisa ditulis lewat editor di P1-04 (butuh sitasi). Hanya status `draft` yang bisa diedit sampai P1-03.
- Keputusan founder: PENDING

### P1-04 — Sumber per artikel
- Commit: lihat PR `feat/P1-04-article-sources`
- File berubah:
  - `db/migrations/0005_revision_citations.sql`, `apps/api/src/db/schema.ts`
  - `apps/api/src/modules/articles/{content,markdown,verification,articles}.ts`, `apps/api/src/routes/articles.ts`, `apps/api/src/lib/validation.ts`
  - Web: `apps/web/app/os/(shell)/newsroom/editor.tsx` + halaman, `apps/web/components/article-body.tsx`, `apps/web/lib/{api,editor-messages}.ts`, `globals.css`
  - Tes: `apps/api/tests/unit/citations.test.ts`, `integration/newsroom-api.test.ts`, `tests/e2e/web.e2e.mjs`
- Keputusan desain: **sitasi disimpan di dalam revisi** (kolom `citations`), bukan tabel yang bisa diubah terpisah. Sitasi ikut hash isi, jadi menambah, mengubah, atau mencentang/membatalkan "sudah dicek" setelah approval otomatis membatalkan approval itu (PRD v4 §7). Tabel `article_sources` di PRD v4 §6.2 diwujudkan sebagai bagian revisi; tautan ke Source Registry (P1-05) bisa ditambahkan nanti tanpa mengubah aturan ini.
- Perilaku:
  - Sitasi: URL https lengkap tanpa kredensial, **agregator dan penyingkat link ditolak** (Google News, `google.com/url`, t.co, bit.ly, s.id, dll.); penerbit, judul halaman, tanggal akses (tanggal valid), catatan klaim, `primary`, `verified`. Maksimal 30. URL atau id ganda ditolak.
  - **Label verifikasi dihitung server** (ADR-019): TERVERIFIKASI bila ≥1 sumber primer yang sudah dicek **atau** ≥2 penerbit independen yang sudah dicek (dinormalisasi per domain, mis. `webapi.bps.go.id` = `bps.go.id`); SEBAGIAN bila ada yang dicek; selain itu BELUM_TERVERIFIKASI. Klien tidak bisa mengirim label.
  - **Blok angka** `:::angka` (nilai, satuan, periode, label, `sumber: N`): field kurang, nomor sumber tidak ada, field asing, atau HTML → ditolak dengan nomor baris. Di skema, blok `stat` wajib menunjuk sitasi yang ada di revisi yang sama.
  - Web: bagian Sumber di editor (tambah/hapus, centang primer/dicek), label di pratinjau dan halaman draft, angka menampilkan "Sumber: [N] penerbit" yang menaut ke daftar sumber bernomor.
- Test:
  - `pnpm run check` → PASS **308/308**; `pnpm run test:backup` → PASS **10/10** (migrasi 0005 ikut restore). Termasuk 22 tes sitasi/label/angka dan 3 tes HTTP: label dari sitasi, label turun saat sumber batal dicek, agregator ditolak dengan path `citations.0.url`, angka tanpa sumber ditolak, label dari klien ditolak.
  - `pnpm run test:e2e` → PASS **12/12**. Cek baru TEST-P1-04: URL Google News ditolak di UI, angka menaut ke sumber, label Terverifikasi lalu turun ke Belum terverifikasi setelah centang dicek dilepas.
- Security review: PASS. Tautan sumber `rel="noopener noreferrer nofollow"` dan dicek ulang https saat render. Tidak ada fetch ke URL sumber (tanpa SSRF; vault bukti menunggu Fase 2).
- Catatan: hash revisi lama (sebelum kolom `citations`) dihitung tanpa sitasi. Belum ada data nyata, jadi tidak ada dampak.
- Keputusan founder: PENDING

### P1-03 — State machine + gate publish
- Commit: lihat PR `feat/P1-03-workflow-gate`
- File berubah:
  - `db/migrations/0006_publication_workflow.sql`, `apps/api/src/db/schema.ts`
  - `apps/api/src/modules/articles/{gate,workflow,articles}.ts`, `apps/api/src/routes/articles.ts`, `apps/api/src/plugins/policy.ts`, `apps/api/src/lib/errors.ts`, `apps/api/src/modules/audit/audit.ts`
  - Web: `apps/web/app/os/(shell)/newsroom/{workflow,editor}.tsx`, `.../[id]/page.tsx`, `apps/web/lib/{api,editor-messages}.ts`, `globals.css`
  - Tes: `apps/api/tests/integration/{workflow,db}.test.ts`, `tests/e2e/web.e2e.mjs`
- Perilaku:
  - Transisi hanya lewat endpoint khusus `POST /articles/:id/{submit,return,approve,publish,archive}`:
    - `draft → in_review → approved → published → archived`
    - `in_review → draft` (wajib alasan ≥5 karakter)
    - `draft → archived`
  - Approve dan publish butuh izin terpisah `articles.publish` (siap untuk role editor nanti).
  - Setiap transisi dalam satu transaksi dengan row lock:
    - `expectedVersion` dicek;
    - revisi yang tersimpan divalidasi ulang dan di-hash ulang (`INTEGRITY_FAILED` bila tidak cocok);
    - event immutable `publication_events` (siapa, kapan, revisi, hash, label, catatan) + audit.
  - **Edit saat `in_review`/`approved` mengembalikan ke draft dan menghapus approval** (T-03).
  - **Publish hanya byte yang di-approve:** `approved_revision_id` = revisi terkini dan hash cocok, kalau tidak `revision_changed_after_approval` (T-04).
  - **Gate** (PRD v4 §7), dicek saat approve **dan** saat publish:
    - tanpa sumber terverifikasi → diblok, kecuali founder menulis alasan pengecualian (20–500 karakter, disimpan dan nanti tampil ke pembaca);
    - angka dengan sumber yang belum dicek → **selalu** diblok, pengecualian tidak berlaku;
    - isi kosong → diblok.
  - Web: panel "Review dan terbit" dengan tombol sesuai status, daftar penghalang gate, kolom alasan pengecualian dan alasan dikembalikan, riwayat status. Artikel terbit/arsip terkunci dari edit langsung (koreksi lewat P1-07).
- Test:
  - `pnpm exec vitest run apps/api` → PASS **281/281**, termasuk 11 tes workflow:
    - alur penuh + event + audit + tanggal;
    - urutan salah ditolak (T-04), edit setelah approve membatalkan approval (T-03);
    - hash dimanipulasi → publish ditolak;
    - gate tanpa sumber, pengecualian pendek ditolak, angka belum dicek tetap diblok;
    - return wajib alasan, archive, versi basi;
    - **3 publish bersamaan → tepat 1 event** (T-11);
    - event immutable untuk app dan migrator.
  - `pnpm run test:e2e` → PASS **13/13**. Cek baru TEST-P1-03:
    - ajukan → edit (kembali draft) → ajukan → setujui → terbitkan;
    - riwayat lengkap, artikel terbit terkunci, notice lama hilang;
    - artikel tanpa sumber diblok gate lalu disetujui dengan alasan.
  - Ditemukan saat e2e: (1) notice "kembali ke draft" masih tampil setelah terbit, **diperbaiki**; (2) tes menganggap status "Terbit" karena slug `alur-terbit`, pencarian status kini dikunci di awal baris.
- Security review: PASS. Status tidak bisa dikirim lewat edit; transisi idempoten terhadap balapan; jejak publikasi tidak bisa diubah siapa pun.
- Keputusan founder: PENDING

**Next:** P1-06 — Halaman publik.
