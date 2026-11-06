# Brand NALARA

Keputusan founder **D-22** (2026-11-04): logo **beringin tiga lapis** dipakai untuk semua lini NALARA (Media, OS, dan nanti Data/Tools/Labs). Logo ini juga foto profil akun Instagram "NALARA Media".

| File | Isi | Pakai untuk |
|---|---|---|
| [`nalara-beringin-original.png`](nalara-beringin-original.png) | Asli dari founder, PNG 1254×1254, latar hitam, garis krem | Ukuran besar: avatar media sosial, gambar share, halaman Tentang |

## Makna

Tiga lapis bidang miring: tajuk (yang terlihat), batang, dan akar (sumbernya). Ini sejalan dengan prinsip *source-first*: setiap klaim bisa ditelusuri sampai ke akarnya.

## Sistem visual "Berkas perkara" (2026-11-06)

Permintaan founder: nuansa detektif. Supaya tetap terpercaya dan tidak jadi kostum, metaforanya dibuat dari cara kerja NALARA sendiri: setiap artikel adalah **berkas** yang sudah ditelusuri, dan sumbernya adalah **barang bukti**. Nama dan ikon tokoh detektif tertentu sengaja tidak dipakai.

| Unsur | Di layar |
|---|---|
| Meja berkabut | Latar abu-abu dingin `#E9EBE7` (bukan krem) |
| Lembar berkas di atas map manila | Artikel dan artikel utama di beranda: lembar putih, tab map berisi topik, tepi map manila `#DCC995` di belakangnya |
| Cap karet | Label verifikasi: bingkai ganda, sedikit miring, merah tua `#7B1E22`. Teks aslinya tetap ada untuk pembaca layar |
| Barang bukti | Setiap sumber berupa label manila berlubang, bernomor "Bukti 1, 2, ..." |
| Garis "Bukti: BPS dan BI" | Di bawah judul, dari penerbit sumber yang sudah dicek |
| Cara kami menelusuri | Telusuri, Periksa, Jelaskan: urutan kerja sungguhan, jadi boleh bernomor |
| Meja malam | Footer gelap `#17191F` |

- **Huruf:** semuanya lisensi OFL-1.1 dan di-host sendiri, jadi CSP tetap `font-src 'self'`.
  - Libre Caslon Display untuk judul besar. Bentuknya mirip cetakan abad ke-19.
  - Literata untuk bacaan dan judul kecil.
  - Courier Prime (mesin ketik) **hanya** untuk label berkas: topik, tanggal, nomor bukti, dan cap.
  - Plus Jakarta Sans untuk OS (dapur redaksi) dan formulir.
- **Kontras:** semua pasangan warna teks lolos AA dan diuji di `tests/tokens.test.ts`.
- **Yang sengaja tidak dipakai:** siluet topi, pipa, atau kaca pembesar; tekstur kertas lusuh; benang merah. Hiasan yang dipakai hanya map dan cap.
- **Simbol kecil:** `BrandMark` (`apps/web/components/brand.tsx`) menggambar tiga lapis logo dalam satu warna, seperti logo aslinya.

## Yang masih perlu dibuat

1. **Versi vektor logo lengkap yang disederhanakan** (tiga jajaran genjang plus siluet pohon) untuk favicon dan ikon aplikasi, ditinjau founder. Simbol tiga lapis di masthead sudah ada, tetapi bukan pengganti logo.
2. **Lockup versi gelap** untuk media sosial dan gambar share.

## Catatan

- File asli memuat metadata **C2PA** (chunk `caBX`, *content credentials*), yang biasanya ditambahkan generator gambar. Tidak ada data lokasi. File disimpan apa adanya.
- Bila logo dibuat dengan generator AI, perlindungan hak cipta atas gambarnya bisa terbatas. Untuk perlindungan merek, pertimbangkan pendaftaran merek (wordmark + logo vektor final) setelah nama dan domain pasti (R-01).
- Domain belum dibeli (D-08). "nalara.media" di logo adalah nama akun, bukan domain milik NALARA.
