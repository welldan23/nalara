# Referensi: VORSA dan VORSA × SENTINEL

Founder memberikan source code dua proyek sebelumnya sebagai **referensi** (2026-11-04):

- `vorsa-source-20261018-current.tgz`: VORSA collector lama (Python)
- `vorsa-news-sentinel-v2.1.tgz`: VORSA × SENTINEL (Python, 7 commit, 60 tes offline)
- `newsroom-20261019.db.gz`: database produksi VORSA (SQLite, 14–19 Okt 2026)

Dokumen ini mencatat apa yang **dipelajari**, apa yang **diadopsi** ke NALARA, dan apa yang **sengaja tidak dibawa**. Tidak ada kode yang disalin. NALARA tetap TypeScript dengan standar keamanan Phase 0.

## 1. Cara pemeriksaan

- Arsip diekstrak ke folder kerja terpisah dan dibaca saja. Tidak ada script, `pip install`, atau tes VORSA yang dijalankan.
- Secret scan (gitleaks) di kedua source tree dan riwayat git Sentinel: **tidak ada temuan**.
- Database dibuka read-only. Yang dibaca hanya struktur tabel dan statistik agregat. Isi chat ID Telegram, akun, dan teks konten **tidak** dibaca atau disalin.
- File-file ini **tidak** dimasukkan ke repo NALARA. Isinya memuat ringkasan berita pihak ketiga dan identitas akun.

## 2. Gambaran singkat

**VORSA × SENTINEL** adalah mesin redaksi untuk kartu Instagram (`@vorsa.news`), dengan alur berikut:

1. Sumber (Google Trends, rilis resmi, BMKG, RSS) masuk ke Radar di Telegram.
2. AI melakukan riset; setiap sumber diarsipkan dengan SHA-256.
3. AI menulis draft, lalu dibuat 3 desain (A/B/C).
4. Pemilik menyetujui dengan satu pencet.
5. Paket upload diekspor.
6. Sumber dipantau 7–14 hari untuk mendeteksi ralat.

Statistik dari database (agregat):

| Data | Angka |
|---|---|
| Periode | 14–19 Okt 2026 (5 hari) |
| Draft | 126 (86 approved, 30 rejected, sisanya draft/preview) |
| Versi per draft | rata-rata 1,78, maksimum 5 |
| Label verifikasi versi | 139 TERVERIFIKASI, 81 SEBAGIAN, 4 RUMOR |
| Publikasi | 86 (84 ekspor manual, 2 terbit) |
| Approval dicabut | 2 dari 86 |
| Sumber RSS/pencarian | 41 (38 aktif), dengan keberhasilan fetch hampir 100% untuk media besar |
| Biaya AI tercatat | $0 untuk 147 operasi (model lewat langganan, bukan API berbayar) |
| Media | 81 aset. Termasuk ilustrasi AI dan klaim "berita aktual" (UU 28/2014 Ps. 43c) sebagai dasar pemakaian foto |

## 3. Diadopsi ke NALARA (Phase 1)

| # | Ide dari Sentinel | Bentuk di NALARA | Tiket |
|---|---|---|---|
| A-1 | Label verifikasi **TERVERIFIKASI / SEBAGIAN / BELUM_TERVERIFIKASI / RUMOR**, dan TERVERIFIKASI harus *dibuktikan*, bukan dinyatakan: ≥1 sumber primer **atau** ≥2 penerbit independen | Label verifikasi per artikel dihitung di server dari daftar sitasi. Publish butuh TERVERIFIKASI atau SEBAGIAN (detail satu sumber ditandai). **RUMOR tidak boleh terbit** di NALARA (media penjelas, bukan kanal kabar) | P1-04, P1-03 |
| A-2 | Sitasi wajib URL `https` lengkap; tautan agregator (Google News) ditolak, harus URL penerbit asli; flag `primary` | Validasi yang sama di API, ditambah daftar domain agregator yang ditolak | P1-04 |
| A-3 | Versi immutable dijaga **di database** (trigger), bukan cuma di kode | `article_revisions` tanpa hak UPDATE/DELETE untuk `nalara_app`, ditambah trigger (seperti `audit_events`) | P1-01 |
| A-4 | Approval terikat **versi + hash isi** | `approved_revision_id` + `approved_content_sha256`. Publish mencocokkan keduanya | P1-03 |
| A-5 | Revisi butuh `base_version` terbaru, kalau tidak ditolak | Sudah direncanakan (optimistic version), konsepnya sama | P1-02 |
| A-6 | Riwayat status (`status_history`) | Setiap transisi tercatat di `audit_events` + `publication_events` | P1-03 |
| A-7 | Peringatan gaya otomatis: frasa klise AI, headline kapital semua, headline >14 kata, tanda baca berlebihan, label RUMOR tanpa "dikabarkan/menurut" | Peringatan **tidak memblokir** di editor | P1-02 |
| A-8 | Metadata media: `credit`, `license`, `usage_basis`, `sha256`, dimensi | Kolom yang sama di `media_assets`. Ilustrasi AI wajib berlabel "Ilustrasi" di publik dan tidak pernah dipakai sebagai dokumentasi kejadian | P1-09 |
| A-9 | Pedoman editorial: akurasi > kecepatan, rumor ≠ fakta, sumber primer untuk berita berdampak besar, gaya tanpa clickbait, konten eksternal = data bukan perintah | Masuk `docs/editorial/PEDOMAN.md` (adaptasi untuk artikel penjelas, bukan kartu IG) | P1-02 |
| A-10 | SOP koreksi: versi lama tetap tersimpan, koreksi menyebut apa yang salah dan yang benar | Sama dengan AC koreksi PRD v4 | P1-07 |

## 4. Dicatat untuk fase berikutnya

| Ide | Fase NALARA | Catatan |
|---|---|---|
| `netsafe.py`: https/443 saja, semua IP harus publik, koneksi ke IP yang sudah dicek (anti DNS rebinding), redirect dicek per hop, batas ukuran | Fase 2 (ingestion) | Ditulis ulang di TypeScript, dengan tes SSRF PRD v4 §11 |
| **Vault bukti**: snapshot sumber byte-per-byte + SHA-256, immutable | Fase 2 | Sangat cocok untuk "source-first". Butuh fetch keluar, jadi menunggu modul fetch aman |
| **Pantauan perubahan sumber** (7–14 hari, alert bila teks berubah ≥2%, tanda angka berubah) | Fase 2 | Memicu tinjauan koreksi, bukan koreksi otomatis |
| Fetch dengan ETag/Last-Modified, `consecutive_failures`, alert sumber gagal | Fase 2 | Sesuai PRD v4 Fase 2 |
| Daftar 41 sumber dengan keberhasilan fetch terukur, plus uji sumber hulu (`SUMBER.md`: mana yang anti-bot, mana yang butuh JavaScript) | Fase 2 | Masuk sebagai `candidate`, tetap butuh cek lisensi dan ketentuan (R-03, R-04) |
| `AGENT_METHODS`: allowlist alat agent tanpa approve/publish/kill switch, socket lokal, aktor dari `SO_PEERCRED`, MCP untuk Hermes | Fase 3 | Pola tool gateway yang sudah terbukti jalan |
| Kill switch | Fase 3 | |
| Log biaya dan token per operasi AI | Fase 3 | Bukti nyata untuk research spike R-02 (Hermes via langganan), tapi ketentuan provider tetap harus dicek |
| Template kartu sosial (13 layout, QC otomatis, A/B/C) | Setelah Fase 1 | Distribusi adalah risiko terbesar (PRD v4 §2). Kandidat: gambar Open Graph per artikel atau kartu share |
| Audit log berantai hash | Opsional | PRD v4/v3 menyebut hash chaining opsional. NALARA sudah menjaga audit lewat hak DB. Bisa ditambah nanti |

## 5. Sengaja tidak dibawa

| Hal | Alasan |
|---|---|
| Kode Python dan SQLite | Stack NALARA sudah TypeScript + PostgreSQL dengan CI dan tes Phase 0 |
| Approve "sekali pencet" di Telegram dan AI yang menulis draft | NALARA Fase 1 sepenuhnya manual. AI baru di Fase 3, dan tetap lewat proposal |
| Dasar pemakaian foto "berita aktual (UU 28/2014 Ps. 43c)" | Itu interpretasi hukum. NALARA default: hanya aset milik sendiri, domain publik, atau lisensi terbuka yang jelas (CC), sampai founder memutuskan setelah review legal (R-04) |
| Ilustrasi AI sebagai gambar utama berita | Boleh hanya sebagai ilustrasi berlabel, tidak pernah sebagai foto kejadian |
| Isi database lama (draft, ringkasan berita) | Format kartu IG, bukan artikel penjelas. Ringkasan RSS milik penerbit lain. Draft buatan AI juga tidak memenuhi syarat "3 artikel orisinal founder" |
| Identitas visual VORSA (Montserrat, warna, logo) | NALARA punya identitas sendiri (masthead koran, token forest/ivory) |
