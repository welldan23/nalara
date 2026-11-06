# Phase 4 — Penerimaan (ACCEPTANCE)

Status: **siap ditinjau founder**. Dibangun dan diuji lokal + CI (D-27), memakai data contoh berlabel TEST. Dataset asli pertama menunggu founder dan deploy (§4).

Rencana: [PLAN.md](PLAN.md). Rincian per tiket: [PROGRESS.md](PROGRESS.md). Desain: [ADR-021](../adr/ADR-021-datasets-and-charts.md).

## 1. Ringkasan untuk founder

NALARA sekarang bisa **menunjukkan datanya**, bukan hanya menulis tentangnya:

1. **Katalog dataset** di `/os/data`. Setiap dataset berasal dari sumber di Source Registry dan punya satuan, frekuensi, metodologi, dan lisensinya sendiri.
2. **Versi yang tidak bisa diubah.** Setiap versi menyimpan file asli dari penerbit, aturan pengolahannya, dan hasilnya, masing-masing dengan sidik jari (SHA-256). Kalau penerbit merevisi angka, kamu menambah versi baru dengan catatan revisi. Versi lama tetap ada.
3. **Aturan pengolahan tanpa kode.** Kamu memilih pemisah kolom, desimal, kolom periode/nilai, dan seterusnya, lalu tekan **Pratinjau**. Kalau ada yang salah, NALARA menunjuk barisnya (mis. "Baris 3: Periode tidak cocok"). Format Indonesia didukung: `1.234,56`, "Oktober 2026", "Triwulan III 2025".
4. **Terbit hanya kalau aman.** Sumbernya harus sudah Terverifikasi dan lisensinya memungkinkan. Saat terbit, NALARA **mengulang pengolahan** dari file asli dan memastikan hasilnya sama persis.
5. **Grafik di artikel** lewat blok `:::grafik` (`data: slug@versi`). Grafik terkunci ke satu versi, jadi artikel lama tidak berubah sendiri. Artikel tidak bisa terbit kalau datasetnya belum terbit. Grafik digambar di server: bisa dibaca pembaca layar, punya tabel data, dan tetap tampil tanpa JavaScript.
6. **Halaman data publik** `/data` dan `/data/slug`: grafik, sumber, lisensi, metodologi, **"Cara data diolah"** dalam kalimat biasa plus kedua hash, riwayat versi, dan unduhan CSV (hanya bila lisensi mengizinkan).

## 2. Tiket

| Tiket | Isi | PR |
|---|---|---|
| P4-00 | Rencana, ADR-021, D-27 | #53 |
| P4-01 | Mesin transformasi deterministik | #54 |
| P4-02 | Katalog dataset + `/os/data` | #55 |
| P4-03 | Grafik di artikel + publish gate | #56 |
| P4-04 | Halaman data publik + CSV | PR `feat/P4-04-public-data` |
| P4-05 | Dokumen ini | PR `docs/P4-05-acceptance` |

## 3. Matriks tes (semua dijalankan, semua PASS)

| Area | Tes | Hasil |
|---|---|---|
| Mesin transformasi | `apps/api/tests/unit/transform.test.ts`: CSV RFC 4180, periode/angka format Indonesia, hash deterministik (juga dengan urutan baris acak), filter + skala, BOM, semua penolakan bernomor baris, sel formula/markup | 9/9 |
| Katalog | `apps/api/tests/integration/datasets.test.ts`: validasi, pratinjau tanpa simpan, versi immutable + hash + unduhan, syarat terbit (sumber, lisensi, izin), revisi tanpa mengubah versi terbit, tarik + audit, sesi/CSRF | 7/7 |
| Grafik | `apps/api/tests/unit/charts.test.ts`: sintaks `:::grafik` + gate. `apps/api/tests/integration/charts.test.ts`: pratinjau, gate menahan lalu lolos, versi publik terkunci, data ditarik tidak digambar. `apps/web/tests/chart.test.ts`: sumbu | 3 + 3 + 2 |
| Data publik | `apps/api/tests/integration/public-data.test.ts`: hanya yang terbit, versi ≤ terbit, tanpa file mentah/id, CSV + netralisasi formula, lisensi izin/draft → 404 | 3/3 |
| UI | e2e TEST-P4-02 (katalog, unggah CSV, pratinjau, cek ulang, terbit), TEST-P4-03 (SVG aksesibel, markup ditolak), TEST-P4-04 (halaman publik, isi CSV persis, sitemap, 404), semua juga diuji di 320 px | e2e |
| Produksi | Smoke OPS-06: route upload dataset menerima file sampai 8 MB, route lain tetap 1 MB | 21/21 |
| Semua | `pnpm run check` · `pnpm run test:e2e` · smoke | 514/514 · 26/26 · 21/21 |

Bug yang **ditemukan oleh tes** lalu diperbaiki:
- Pilihan versi di panel terbit kosong setelah versi pertama.
- Halaman melebar 30 px di 320 px karena URL panjang dalam grid.
- Label sumbu terakhir grafik garis terpotong.
- Tes Phase 0 yang flaky: ID request acak kebetulan mengandung "ok".

**Exit Phase 4 (PRD v4 §11):** "minimal satu dataset publik asli tampil dengan satuan, periode, URL sumber, tanggal revisi, dan transformasi yang bisa direproduksi".
- **Kemampuan:** PASS. Satuan, periode, URL sumber, tanggal diambil, catatan revisi, dan transformasi + hash semuanya tampil dan diuji.
- **Dataset asli:** **TERBUKA**. Butuh founder (§4).

## 4. Gate terbuka

| # | Gate | Cara menutup |
|---|---|---|
| G-1 | Dataset asli pertama | Setelah deploy: pilih satu dataset resmi (usulan: inflasi bulanan BPS, atau kurs JISDOR BI). Cek ketentuan penggunaan datanya (R-04), unduh CSV dari situs penerbit, lalu buat dataset di `/os/data` → Pratinjau → Simpan → Ulangi transformasi → Terbitkan |
| G-2 | Artikel asli dengan grafik | Pakai `:::grafik` di salah satu artikel awal Phase 1 |

## 5. Risiko dan catatan

| ID | Risiko | Penanganan |
|---|---|---|
| R-P4-01 | File resmi sering berupa Excel/PDF, bukan CSV | Simpan ulang sebagai "CSV UTF-8" dari spreadsheet. Dukungan XLSX butuh ADR + dependensi baru |
| R-P4-02 | Transformasi sengaja terbatas (tanpa join atau agregasi) | Cukup untuk tabel resmi satu tabel. Kebutuhan lebih besar lewat ADR |
| R-P4-03 | Lisensi data pemerintah beragam dan sering tidak jelas | Database menolak terbit dengan lisensi "belum diketahui" atau "terbatas". "Perlu izin" wajib menuliskan izinnya, dan datanya tidak bisa diunduh ulang dari NALARA |
| R-P4-04 | File asli disimpan di database (maks. 5 MiB per versi) | Ikut backup terenkripsi. Dipantau setelah ada data nyata |
| R-P4-05 | Grafik hanya garis dan batang | Disengaja untuk v1. Jenis lain lewat tiket kecil |

## 6. Keputusan founder

- [ ] **PHASE 4 ACCEPTED** (fondasi lokal + CI), dengan G-1..G-2 ditutup setelah deploy, **atau**
- [ ] perubahan yang diminta: …

Phase 3 sudah diterima (D-28). Masih menunggu dari Phase 1: deploy (D-08/D-09) dan **PHASE 1 ACCEPTED**. Fase berikutnya menurut PRD v4 adalah **Fase 5+ (kondisional)**: tools, Labs/API publik, newsletter, monetisasi. Menurut PRD, fase ini baru dimulai bila ada permintaan pembaca nyata, operasi sudah stabil, dan review legal selesai. Karena itu langkah yang disarankan sekarang adalah **deploy** dan validasi pembaca, bukan menambah fitur.
