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
