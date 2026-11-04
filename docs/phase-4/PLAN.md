# Phase 4 — NALARA Data v1

Status: **DIMULAI** 2026-11-04 atas permintaan founder ("lanjut", D-27), sementara Phase 3 menunggu **PHASE 3 ACCEPTED**. Seperti Phase 2 dan 3, semuanya dibangun dan diuji lokal + CI. Deploy menyusul (D-09).

Acuan:
- PRD v4 §11 (Fase 4), §6.3 (`datasets`, `dataset_versions`), §7 (angka wajib punya periode, satuan, dan sumber);
- PRD v3 NAL-017/018;
- [ADR-021](../adr/ADR-021-datasets-and-charts.md).

## 1. Tujuan

NALARA bukan hanya menulis *tentang* data, tapi juga menunjukkan datanya. Pembaca bisa melihat:
- dari mana sebuah angka berasal (penerbit, URL, tanggal diambil, lisensi);
- versi data yang mana;
- bagaimana data mentah diolah menjadi grafik, dengan langkah yang bisa diulang dan dicek dengan hash.

## 2. Batas yang tidak berubah

- Dataset hanya bisa dibuat dari sumber yang **ada di Source Registry**. Dataset hanya bisa **terbit** bila sumbernya `verified` dan lisensinya diketahui serta mengizinkan (PRD v4 R-04).
- Versi dataset **immutable**: file mentah + SHA-256, aturan transformasi, dan hasilnya. Koreksi dilakukan dengan versi baru yang membawa catatan revisi, tidak pernah dengan menimpa.
- Grafik di artikel selalu menunjuk **versi tertentu** (`slug@versi`). Grafik tidak berubah diam-diam saat ada versi baru.
- Transformasi bersifat **deklaratif** (bukan kode). Server bisa mengulangnya dari file mentah dan membuktikan hasilnya sama (hash).
- Grafik digambar di server sebagai SVG, tanpa JavaScript pihak ketiga, dan selalu disertai tabel data serta keterangan sumber.

## 3. Tiket

| # | Tiket | Isi | Tes utama |
|---|---|---|---|
| P4-01 | Mesin transformasi | Parser CSV (RFC 4180) dan spesifikasi transformasi tervalidasi Zod: pemisah, desimal/ribuan, baris lewati, kolom periode/nilai/seri, filter, skala, format periode. Hasilnya observasi ternormalisasi + SHA-256. Error berupa kode + nomor baris | CSV aneh/rusak, angka format Indonesia, periode tidak valid, batas ukuran, hasil deterministik (hash sama) |
| P4-02 | Katalog dataset | Tabel `datasets` + `dataset_versions` (immutable). OS `/os/data`: buat dataset dari sumber, unggah versi (CSV + aturan), pratinjau, catatan revisi, terbitkan/tarik. Tombol "Ulangi transformasi" membuktikan reprodusibilitas | Versi immutable; sumber belum verified/lisensi tidak jelas → tidak bisa terbit; hash cocok; audit |
| P4-03 | Grafik di artikel | Blok editor `:::grafik` (`data: slug@versi`, `jenis: garis/batang`, `judul`). Publish gate menolak grafik dari dataset/versi yang belum terbit. SVG aksesibel (judul, deskripsi, tabel data, keterangan sumber + satuan + periode + tanggal revisi) | Gate; versi terkunci; XSS di judul/label; 320 px; tanpa skrip |
| P4-04 | Halaman data publik | `/data` dan `/data/[slug]`: metadata, sumber, lisensi, metodologi, aturan transformasi, riwayat versi, unduhan CSV ternormalisasi (hanya bila lisensi mengizinkan) | Dataset belum terbit → 404; unduhan diblok untuk lisensi `permission_required` tanpa catatan izin |
| P4-05 | Penerimaan Phase 4 | `docs/phase-4/ACCEPTANCE.md` | — |

## 4. Exit Phase 4 (PRD v4 §11)

Minimal **satu dataset publik asli** tampil dengan satuan, periode, URL sumber, tanggal revisi, dan transformasi yang bisa diulang.
- **Lokal/CI:** semua tes di atas memakai data contoh berlabel TEST.
- **Gate terbuka:** dataset asli pertama. Founder memilihnya, misalnya inflasi bulanan BPS, mengecek lisensinya, lalu mengunggah file aslinya setelah deploy.

## 5. Yang butuh founder

- Dataset pertama dan pengecekan lisensinya (R-04).
- Tidak ada biaya atau akun baru.
