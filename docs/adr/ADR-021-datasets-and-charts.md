# ADR-021 — Datasets with immutable versions, declarative transforms, server-side SVG charts

- **Status:** Accepted (delegated, D-14; ditinjau di PR P4-00)
- **Date:** 2026-11-04
- **Approver:** Founder (delegated)
- **Related:** PRD v4 §6.3, §7, §11 Fase 4 · [Phase 4 PLAN](../phase-4/PLAN.md) · ADR-011 (content blocks), ADR-017 (nonce CSP)

## Context

PRD v4 meminta katalog dataset, provenance + lisensi, versi/revisi, dan chart aksesibel yang bisa disisipkan ke artikel. Exit-nya meminta transformasi yang **bisa direproduksi**.

## Alternatives

1. **Transformasi lewat kode/skrip** (SQL, JS, notebook). Paling fleksibel, tetapi berarti menjalankan kode di server, sulit diaudit, dan reprodusibilitasnya bergantung pada lingkungan.
2. **Transformasi deklaratif terbatas** (JSON tervalidasi: kolom, format angka, filter, skala) yang dijalankan mesin kecil milik kita sendiri.
3. **Library chart di browser** (Chart.js, Vega). Menambah JavaScript pihak ketiga dan menyulitkan CSP. Pembaca tanpa JS juga tidak mendapat apa-apa.
4. **SVG digambar di server** oleh komponen React, ditambah tabel data.

## Decision

Opsi 2 untuk transformasi dan opsi 4 untuk chart.

- `dataset_versions` immutable (trigger), berisi:
  - byte mentah (maksimal 5 MiB) + SHA-256;
  - spesifikasi transformasi;
  - observasi hasil `[{series, period, value}]` + SHA-256-nya;
  - tanggal pengambilan, URL file sumber, dan catatan revisi.
- Mesin transformasi bersifat murni dan deterministik. "Verifikasi" = jalankan ulang dari byte mentah + spesifikasi, lalu bandingkan hash.
- Artikel menyimpan blok `chart` dengan `dataset` (slug) + `version`. Versinya terkunci, jadi grafik di artikel yang sudah terbit tidak pernah berubah sendiri.
- Publish gate memblokir grafik yang menunjuk dataset atau versi yang belum terbit.
- Chart berupa SVG dengan `role="img"`, `<title>`, dan `<desc>`, ditambah tabel data dan baris sumber/satuan/periode/revisi. Tanpa skrip, sehingga cocok dengan CSP nonce.

## Consequences

- **Positif:**
  - tanpa dependensi baru dan tanpa eksekusi kode dari luar;
  - pembaca bisa memeriksa asal dan olahan angka;
  - grafik tampil tanpa JavaScript.
- **Negatif:**
  - transformasi terbatas (tanpa join atau agregasi kompleks). Kebutuhan lebih besar harus lewat ADR baru;
  - jenis chart terbatas (garis, batang).

## Security impact

- File CSV diperlakukan sebagai data: ada batas ukuran, baris, kolom, dan seri.
- Teks dari CSV (label seri) tampil sebagai teks React (escaped), dan SVG dibuat tanpa `dangerouslySetInnerHTML`.
- Unduhan file mentah hanya tersedia untuk founder (sebagai attachment). Unduhan publik hanya untuk data ternormalisasi, dan hanya bila lisensi mengizinkan.

## Rollback

Tarik (retract) dataset. Artikel yang memakai dataset itu akan diblok oleh gate saat akan diterbitkan ulang. Tabelnya tetap tersimpan sebagai riwayat.
