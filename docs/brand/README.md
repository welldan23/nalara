# Brand NALARA

Keputusan founder **D-22** (2026-11-04): logo **beringin tiga lapis** dipakai untuk semua lini NALARA (Media, OS, dan nanti Data/Tools/Labs). Logo ini juga foto profil akun Instagram "NALARA Media".

| File | Isi | Pakai untuk |
|---|---|---|
| [`nalara-beringin-original.png`](nalara-beringin-original.png) | Asli dari founder, PNG 1254×1254, latar hitam, garis krem | Ukuran besar: avatar media sosial, gambar share, halaman Tentang |

## Makna

Tiga lapis bidang miring: tajuk (yang terlihat), batang, dan akar (sumbernya). Ini sejalan dengan prinsip *source-first*: setiap klaim bisa ditelusuri sampai ke akarnya.

## Sistem visual "Tiga lapis" (2026-11-06)

Tampilan publik dirombak dari logo ini, bukan dari template. Tiga bidang miring logo jadi cara menyusun tulisan, dan bentuk miring itu satu-satunya "hiasan":

| Lapis logo | Di tulisan | Di layar |
|---|---|---|
| Tajuk (hijau daun) | Apa yang terjadi | Judul besar dan ringkasan |
| Batang (tinta) | Kenapa penting, angka yang bisa dicek | Isi artikel (Literata) |
| Akar (tanah gelap) | Sumber dan data | Pita "Akar tulisan ini" berwarna tanah dengan sisi atas miring, baris "Berakar pada BPS dan BI" di bawah judul, dan footer |

- **Warna** (`apps/web/lib/tokens.ts`): kertas `#F6F7F5`, tinta `#18211E`, daun `#245640`, daun tua `#15291F`, tanah `#2A221C`, teks di tanah `#EFE8DD`. Semua pasangan teks lolos kontras AA (diuji di `tests/tokens.test.ts`). Latar krem lama dibuang.
- **Huruf**: Plus Jakarta Sans (judul dan antarmuka, karya desainer Indonesia) dan Literata (bacaan panjang). Keduanya lisensi OFL-1.1, di-host sendiri lewat paket `@fontsource-variable`, jadi CSP tetap `font-src 'self'` dan tidak ada permintaan ke Google Fonts.
- **Yang sengaja tidak dipakai**: label huruf kapital semua, deretan meta dengan titik tengah, kartu seragam berbayangan, dan gradasi.
- **Simbol kecil**: `apps/web/components/brand.tsx` (`BrandMark`) menggambar tiga jajaran genjang sebagai SVG untuk masthead dan footer. Logo beringin lengkap tetap dipakai untuk favicon, gambar share, dan OS.

## Yang masih perlu dibuat

1. **Versi vektor logo lengkap yang disederhanakan** (tiga jajaran genjang plus siluet pohon) untuk favicon dan ikon aplikasi, ditinjau founder. Simbol tiga lapis di masthead sudah ada, tetapi bukan pengganti logo.
2. **Lockup versi gelap** untuk media sosial dan gambar share.

## Catatan

- File asli memuat metadata **C2PA** (chunk `caBX`, *content credentials*), yang biasanya ditambahkan generator gambar. Tidak ada data lokasi. File disimpan apa adanya.
- Bila logo dibuat dengan generator AI, perlindungan hak cipta atas gambarnya bisa terbatas. Untuk perlindungan merek, pertimbangkan pendaftaran merek (wordmark + logo vektor final) setelah nama dan domain pasti (R-01).
- Domain belum dibeli (D-08). "nalara.media" di logo adalah nama akun, bukan domain milik NALARA.
