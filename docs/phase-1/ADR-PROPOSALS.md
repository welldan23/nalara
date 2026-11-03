# NALARA Phase 1 — Usulan ADR (ADR-011..019)

Status semua usulan: **PROPOSED**, menunggu founder (D-19). Revisi 2 (2026-11-04): disesuaikan dengan PRD v4 dan referensi [VORSA × SENTINEL](REFERENCE-VORSA.md). Setelah disetujui, masing-masing dipindah ke `docs/adr/ADR-0XX-*.md` di tiket pertama yang memakainya. Konflik yang dirujuk ada di [BASELINE.md](BASELINE.md) §3.

---

## ADR-011 — Format isi artikel: blok JSON tervalidasi, tanpa HTML

- **Konteks:** KP1-03, KP1-12, KP1-19. Konten editor wajib disanitasi (AC-OS-03, T-05). Rich-text editor membawa dependensi besar.
- **Keputusan:**
  - Isi artikel disimpan sebagai **array blok** yang divalidasi Zod di API:
    - `paragraph`, `heading` (level 2–3), `list` (berurutan atau tidak), `quote` (dengan atribusi)
    - `stat` (nilai, unit, periode, `citation_id` wajib)
    - `image` (`media_id` + alt text, dari P01-009)
  - Teks inline hanya mendukung tebal, miring, dan tautan. Tautan wajib `http`/`https`.
  - Editor menyediakan kerangka template PRD v4 §7: apa yang terjadi, kenapa penting, konteks, data/angka, apa selanjutnya.
  - Peringatan gaya yang **tidak memblokir**: frasa klise AI, headline kapital semua, headline lebih dari 14 kata, tanda baca berlebihan (pola dari VORSA).
  - Penulis mengetik **Markdown terbatas** di textarea. API mengubahnya jadi blok, menolak sintaks di luar subset (termasuk HTML mentah), dan mengembalikan pesan yang jelas.
  - Render publik dan preview memakai komponen React biasa (auto-escape). **Tidak ada** `dangerouslySetInnerHTML` (dijaga tes lint/grep).
  - Batas: route simpan draft mendapat body limit per-route **256 KiB** (global tetap 16 KiB), maksimal 500 blok, dan panjang tiap field dibatasi.
- **Alternatif ditolak:** HTML + sanitizer (rawan konfigurasi), TipTap/ProseMirror (dependensi berat), MDX (bisa menjalankan kode).
- **Konsekuensi:** editor tidak WYSIWYG di Phase 1, diganti preview. Format blok gampang dimigrasi ke editor visual nanti.

## ADR-012 — State machine editorial dan approval terikat revisi

- **Konteks:** KP1-05, KP1-06, KP1-07; T-03, T-04, T-11; AC-OS-01/02.
- **Keputusan:**
  - Status (PRD v4 §6.2): `draft → in_review → approved → published → archived`, dan `in_review → draft` bila ditolak (alasan wajib, tercatat). `scheduled` tidak ada.
  - Setiap simpan membuat `article_revisions` baru yang **immutable** (`unique(article_id, version)`). Immutability dijaga juga di database: `nalara_app` tanpa hak UPDATE/DELETE + trigger (pola dari VORSA × SENTINEL).
  - `articles.version` dipakai untuk optimistic concurrency: request membawa `expected_version`, dan versi yang basi dibalas 409.
  - Approve menyimpan `approved_revision_id`, `approved_content_sha256` (hash kanonik isi revisi), `approved_by`, dan `approved_at`. Edit apa pun sesudahnya mengembalikan status ke `draft` dan menghapus approval.
  - Publish dalam **satu transaksi** memeriksa:
    - status `approved`;
    - revisi terbaru sama dengan `approved_revision_id`, dan hash isinya dihitung ulang lalu dicocokkan dengan `approved_content_sha256`;
    - gate §9 lolos (sumber, `stat`, media).

    Setelah itu publish menulis `publication_events` dan `audit_events`.
  - Transisi hanya lewat endpoint khusus. `PATCH` tidak bisa mengubah status.
- **Konsekuensi:** satu founder tetap harus menekan "approve" lalu "publish" sebagai dua langkah yang tercatat.

## ADR-013 — Rendering publik dinamis lewat API

- **Konteks:** KP1-09. Web tidak punya akses DB (ADR-002). Publish harus langsung tampil, dan sitemap harus akurat.
- **Keputusan:**
  - Halaman publik di-render dinamis (SSR) per request dengan memanggil API internal `http://api:4000/api/v1/public/*`. Tanpa ISR dan tanpa cache data Next.
  - API publik hanya membaca lewat **satu** modul query yang selalu memfilter `status = 'published'`.
  - Respons publik boleh membawa `Cache-Control: public, s-maxage` pendek di tahap launch, setelah beban diukur (D10).
  - Rate limit API publik per IP (mekanisme Phase 0).
- **Alternatif ditolak:** ISR + revalidate webhook (butuh secret web↔api dan jalur invalidasi baru), web langsung ke DB (melanggar ADR-002).
- **Konsekuensi:** setiap view memanggil API dan DB. Untuk skala awal (1 VPS) ini cukup, dan dipantau lewat health dan log.

## ADR-014 — Penyimpanan media: volume lokal terenkripsi saat backup

- **Konteks:** P01-009, S1-08, S1-09, S1-11. Object storage S3 butuh keputusan founder (D8) dan biaya.
- **Keputusan:**
  - Volume Docker `media-data` dipasang hanya di `api`, read-write. Nama file = UUID, tanpa nama asli.
  - Format yang diterima: PNG/JPEG/WebP, maksimal 5 MB, maksimal 6000×6000.
  - Validasi magic bytes dan header dimensi dilakukan sendiri. SVG dan format lain ditolak.
  - Segmen metadata (EXIF/XMP/GPS) dibuang tanpa re-encode.
  - API menyajikan file lewat `GET /media/:id` dengan `Content-Type` dari validasi, `X-Content-Type-Options: nosniff`, dan `Content-Disposition: inline`. Caddy meneruskan `/media/*` ke API.
  - Wajib metadata: `license`, `attribution` (credit), `usage_basis`, `alt_text`, `sha256`. Gate publish menolak media tanpa lisensi atau alt text.
  - Lisensi yang diterima: milik sendiri, domain publik, atau lisensi terbuka yang jelas. Ilustrasi AI wajib berlabel "Ilustrasi" di halaman publik. Dasar "berita aktual"/fair use tidak dipakai tanpa review legal (R-04).
  - `backup.sh` ikut mengarsipkan volume media (tar → `age`). Restore drill memeriksa checksum file.
- **Konsekuensi:** pindah ke S3 nanti lewat ADR baru, dengan `storage_key` yang tetap sama.

## ADR-015 — Flag rollout publik lewat environment

- **Konteks:** KP1-08, KP1-15, S1-12. Feature flag di DB baru ada di P02-006.
- **Keputusan:**
  - Variabel `PUBLIC_SITE_ENABLED` (default `false`) dibaca web dan API.
  - Selama `false` di produksi:
    - halaman publik baru (`/artikel`, `/topik`, `/koreksi`) hanya merespons 404 kecuali untuk founder yang login (preview);
    - `robots.txt` = `Disallow: /`;
    - semua halaman `noindex`.
  - Di non-produksi (dev, CI, e2e), flag boleh `true` untuk tes.
  - Flag ini divalidasi di `env.ts` seperti variabel lain.
- **Konsekuensi:** go-live = mengubah satu variabel di `/srv/nalara/.env` lalu restart, setelah D-18.

## ADR-016 — Kebijakan URL dan slug

- **Konteks:** KP1-02, KP1-20.
- **Keputusan:**
  - Route publik: `/`, `/artikel/[slug]`, `/topik/[slug]`, `/tentang`, `/koreksi`, `/sitemap.xml`, `/robots.txt`.
  - Slug: `^[a-z0-9]+(-[a-z0-9]+)*$`, 3–120 karakter, unik.
  - Slug dibuat otomatis dari judul (transliterasi sederhana) dan boleh diedit **sampai publish pertama**. Setelah itu dikunci.
  - Canonical URL = `APP_BASE_URL` + path.
- **Konsekuensi:** mengganti slug setelah terbit butuh fitur redirect (ditunda, tiket sendiri bila dibutuhkan).

## ADR-017 — CSP berbasis nonce dimajukan ke Phase 1

- **Konteks:** KP1-16, ACCEPTANCE R-04, S1-01. Halaman sudah dinamis (ADR-013), jadi nonce per request bisa dipakai.
- **Keputusan:**
  - `proxy.ts` membuat nonce per request dan mengirim CSP `script-src 'self' 'nonce-…' 'strict-dynamic'` tanpa `'unsafe-inline'` untuk script.
  - Style: `'unsafe-inline'` dipertahankan sementara bila Next masih membutuhkannya, dan dicatat sebagai risiko sisa.
  - CSP dasar di Caddy tetap ada sebagai lapis kedua untuk respons non-HTML.
  - Dikerjakan di P01-010 dengan tes e2e: script inline tanpa nonce diblokir, dan tidak ada pelanggaran CSP di halaman normal.
- **Konsekuensi:** semua halaman HTML dinamis. Ini sejalan dengan ADR-013.

## ADR-018 — Tetap memakai API Fastify terpisah di bawah PRD v4 (addendum ADR-002)

- **Konteks:** KP1-22. PRD v4 §5.1 menetapkan default satu aplikasi Next.js, dengan pengecualian backend terpisah "lewat ADR kalau ada kebutuhan terukur". Repo sudah memakai Fastify (ADR-002, D-11), dan Phase 0 diterima dengan desain itu (D-16).
- **Keputusan:** pertahankan pemisahan web (Next.js, tanpa akses DB) dan API (Fastify, satu-satunya pemilik logic dan DB).
- **Alasan yang terukur:**
  1. Auth, sesi, MFA, CSRF, rate limit, dan audit sudah ada dan teruji di API (226 tes, e2e, compose smoke). Memindahkannya ke route handler Next.js berarti menulis ulang dan menguji ulang semuanya.
  2. Batas tegas "web tidak pernah memegang kredensial DB" sudah dibuktikan di Compose (TEST-COMPOSE-02).
  3. Fase 3 butuh tool gateway terisolasi untuk Hermes. API terpisah adalah tempat alaminya (pola `AGENT_METHODS` VORSA).
- **Biaya:** satu proses tambahan di VPS (sudah diukur di Phase 0: image API 292 MB, `mem_limit` diatur).
- **Rollback:** ADR baru bila suatu saat terbukti lebih murah melebur ke Next.js.

## ADR-019 — Aturan sitasi dan label verifikasi

- **Konteks:** PRD v4 §7 (gate publish), D11 v3, KP1-25, pola VORSA A-1/A-2.
- **Keputusan:**
  - Sitasi: URL `https` lengkap, tanpa kredensial. Domain agregator ditolak (mis. `news.google.com`) dan harus diganti URL penerbit asli. Field: penerbit, judul, tanggal akses, catatan klaim, `primary` (sumber primer: rilis resmi, dokumen, data resmi), `verified_at` (founder menandai sudah dicek).
  - Label verifikasi artikel **dihitung server**, tidak pernah dikirim klien:
    - **TERVERIFIKASI**: ≥1 sitasi primer terverifikasi, **atau** ≥2 penerbit independen terverifikasi (penerbit dinormalisasi per domain).
    - **SEBAGIAN**: ada sitasi terverifikasi, tapi syarat TERVERIFIKASI belum terpenuhi. Detail yang hanya dari satu sumber harus ditandai di teks.
    - **BELUM_TERVERIFIKASI**: tidak ada sitasi terverifikasi.
  - Hanya TERVERIFIKASI dan SEBAGIAN yang boleh terbit. Pengecualian "tanpa sumber" (PRD v4 §7) butuh alasan eksplisit founder yang tercatat di audit dan tampil di halaman artikel.
  - Blok angka (`stat`) wajib punya nilai, satuan, periode, dan rujukan sitasi terverifikasi.
  - Label tampil di halaman publik agar pembaca tahu seberapa kuat dasarnya.
- **Ditunda ke Fase 2:** arsip snapshot sumber + SHA-256 dan pantauan perubahan (vault bukti VORSA), karena butuh fetch keluar yang aman dari SSRF.

