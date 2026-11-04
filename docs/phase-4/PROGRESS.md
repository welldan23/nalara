# Phase 4 — Progress

Satu entri per tiket. Rencana: [PLAN.md](PLAN.md).

### P4-00 — Rencana Phase 4
- Commit: lihat PR `docs/P4-00-plan`
- File baru:
  - `docs/phase-4/{PLAN,PROGRESS}.md`
  - `docs/adr/ADR-021-datasets-and-charts.md`
- File berubah: `docs/decisions/DECISIONS.md` (D-27), `docs/adr/README.md`
- Test: `pnpm exec vitest run tests/repo` (cek tautan docs) → PASS
- Keputusan founder: D-27 dicatat ("lanjut"). PHASE 3 ACCEPTED masih menunggu

### P4-01 — Mesin transformasi dataset
- Commit: lihat PR `feat/P4-01-transform`
- File baru:
  - `apps/api/src/modules/data/transform.ts`
  - `apps/api/tests/unit/transform.test.ts`
- Perilaku:
  - Fungsi murni `runTransform(raw, spec)`: byte mentah + spesifikasi → observasi `[{series, period, value}]` + SHA-256.
  - Hasilnya deterministik: urutan baris di file tidak mengubah hasil maupun hash.
  - Spesifikasi deklaratif yang divalidasi Zod (`strictObject`, jadi field asing seperti `code` ditolak). Isinya: pemisah kolom, desimal, ribuan, baris yang dilewati, kolom periode/nilai/seri, filter "sama dengan", skala, dan penanda "tidak ada nilai". Tidak ada ekspresi atau kode yang dijalankan.
  - CSV RFC 4180: kutip, `""`, baris baru di dalam kutip, CRLF. Kutip nyasar atau tidak ditutup → ditolak.
  - Input diperlakukan sebagai data:
    - harus UTF-8 ketat (BOM dibuang, NUL ditolak);
    - batas 5 MiB, 100.000 baris, 200 kolom, 1.000 karakter per sel, 20 seri, 20.000 observasi.
  - Periode dinormalkan: `2026`, `2026-Q3` (termasuk "Triwulan IV 2025"), `2026-10` (termasuk "Oktober 2026", "Agt 2026", "10/2026"), dan `2026-01-31` (termasuk "31/01/2026"). Tanggal yang tidak ada ditolak.
  - Angka hanya memakai pemisah yang dinyatakan (`1.234,56`). `2,8%`, `1e9`, `Infinity`, dan `=SUM(...)` ditolak. Nilai kosong/"-" dilewati dan dihitung, tidak pernah dijadikan nol.
  - Periode ganda dalam satu seri ditolak.
  - Error berupa kode tetap + nomor baris di file asli (misalnya `period_invalid@2`).
- Test:
  - `transform.test.ts` → PASS 9/9: CSV, periode, angka, hash deterministik + urutan acak, filter + skala tanpa noise float, BOM, semua penolakan, dan sel berisi formula/markup.
  - `pnpm run check` → PASS **496/496**.
- Keputusan founder: tidak ada

### P4-02 — Katalog dataset
- Commit: lihat PR `feat/P4-02-datasets`
- File baru:
  - `db/migrations/0018_datasets.sql`
  - `apps/api/src/modules/data/datasets.ts`, `apps/api/src/routes/datasets.ts`
  - `apps/web/app/os/(shell)/data/{page,dataset-form,client}.tsx|ts`, `data/baru/page.tsx`, `data/[id]/{page,version-form,publish-panel}.tsx`
  - `apps/web/lib/data-messages.ts`
  - `apps/api/tests/integration/datasets.test.ts`
- File berubah:
  - Caddyfile: dataset upload boleh sampai 8 MB, sama seperti media; route lain tetap 1 MB
  - Smoke OPS-06
  - e2e TEST-P4-02
- Data:
  - `datasets`:
    - slug dan sumber tetap setelah dibuat;
    - satuan, frekuensi, metodologi, lisensi + catatan + atribusi;
    - status draft/terbit/ditarik, plus versi yang terbit;
    - tidak bisa dihapus.
  - **Database sendiri menolak** dataset terbit dengan lisensi tidak diketahui atau terbatas, atau "perlu izin" tanpa catatan izin.
  - `dataset_versions` **immutable** (trigger, juga untuk migrator). Isinya:
    - byte mentah (maks. 5 MiB) + SHA-256;
    - URL file + tanggal diambil;
    - spesifikasi (dengan default terisi);
    - observasi + SHA-256;
    - rentang periode, seri, dan catatan revisi.
- Perilaku:
  - **Pratinjau**: transformasi dijalankan tanpa menyimpan apa pun. Kesalahan ditunjukkan per baris (mis. "Baris 3: Periode tidak cocok").
  - **Versi baru**: nomornya naik otomatis. Tanggal diambil tidak boleh di masa depan. Dataset yang sudah ditarik tidak bisa diberi versi baru.
  - **Ulangi transformasi**: menghitung ulang dari byte mentah dan membandingkan kedua hash.
  - **Terbit** butuh tiga syarat:
    - sumber sudah `verified`;
    - lisensi bisa diterbitkan;
    - versinya **masih bisa direproduksi** (dicek ulang saat terbit; kalau tidak cocok → `INTEGRITY_FAILED`).
  - Versi baru tidak mengubah versi yang terbit sampai diterbitkan ulang.
  - **Tarik**: dataset hilang dari publik, riwayat tetap ada.
  - File asli hanya bisa diunduh founder, sebagai attachment `octet-stream` dengan CSP sandbox.
  - Semua perubahan diaudit (`dataset.*`), yang dicatat hanya nomor versi dan nama field.
- **Ditemukan saat tes:**
  - e2e: pilihan versi di panel terbit kosong setelah versi pertama disimpan. Diperbaiki: panel di-reset saat jumlah versi berubah.
  - Screenshot: hash tampil sebagai grid kode pemulihan. Sekarang memakai kelas `.hash` sendiri.
- Test:
  - `pnpm run check` → PASS **503/503**, termasuk 7 tes integrasi dataset:
    - pembuatan + validasi;
    - pratinjau tanpa menyimpan + nomor baris;
    - versi immutable + hash + unduhan;
    - syarat terbit (sumber, lisensi, izin);
    - revisi tanpa mengubah versi terbit;
    - tarik + audit;
    - sesi dan CSRF.
  - `pnpm run test:e2e` → PASS **24/24**. TEST-P4-02: buat dari sumber, unggah CSV format Indonesia, kesalahan dijelaskan, pratinjau, simpan, cek ulang, terbit, 320 px.
  - Smoke Compose → PASS **21/21**. OPS-06: route upload dataset menerima file besar, route lain (termasuk path dataset tanpa UUID) tetap ditolak.
- Keputusan founder: tidak ada yang baru
