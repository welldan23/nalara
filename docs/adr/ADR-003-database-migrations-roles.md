# ADR-003 — Database, migration tool, and database roles

- **Status:** Accepted · migration tooling (drizzle-kit) superseded by [ADR-010](ADR-010-sql-first-migrations.md)
- **Date:** 2026-11-03
- **Approver:** Founder (chat 2026-11-03, "approve semua")
- **Related:** BASELINE K-12, S-04 · PRD B §7, DEC-003 · PRD D3 · TEST-DB-01..10

## Context

PRD meminta PostgreSQL dengan migrasi SQL yang versioned, transaksional, punya checksum, dan bisa mendeteksi schema drift. Audit harus append-only. Belum ada kode atau data.

## Alternatives

1. **Drizzle ORM + drizzle-kit.** Schema bertipe di TypeScript, generate file SQL yang bisa direview, ringan, tanpa engine binary.
2. Prisma. DX bagus, tapi engine lebih berat, SQL kurang transparan, dan kontrol migrasi lebih sedikit.
3. SQL murni + runner kecil (mis. node-pg-migrate) + Kysely untuk query bertipe.

## Decision

- **PostgreSQL**: major versi stabil terbaru yang didukung image resmi. Versi persis dipin di P0-005, dengan tag image eksplisit (tanpa `latest`).
- **Drizzle ORM + drizzle-kit.** File SQL hasil generate **wajib direview dan di-commit** di `db/migrations/`. Migrasi dijalankan sebagai **langkah eksplisit** (script/CLI), bukan otomatis saat app start.
- Bila Drizzle tidak lolos TEST-DB-03 (checksum) atau TEST-DB-04 (drift), pindah ke opsi 3 lewat ADR baru.
- **Dua role DB:**
  - `nalara_migrator`: DDL, hanya dipakai oleh langkah migrasi.
  - `nalara_app`: DML untuk aplikasi. **Tanpa `UPDATE`/`DELETE`/`TRUNCATE` pada `audit_events`.**
- **ID:** UUID. Sumber generator (UUIDv7 di aplikasi atau `gen_random_uuid()`) dipilih di P0-005 dan dicatat di PROGRESS.
- Semua timestamp `timestamptz` UTC. Format WIB hanya di UI.
- P0-005 menambah `compose.yaml` berisi service `db` saja untuk dev/test (K-12). Topologi penuh dibangun di P0-012.

## Positive consequences

- SQL migrasi transparan dan bisa direview di PR.
- Append-only audit dijaga oleh izin DB, bukan cuma oleh kode aplikasi.

## Negative consequences

- Dua role berarti dua kredensial yang harus dikelola.
- Drizzle masih versi 0.x, jadi perubahan API antar versi mungkin terjadi. Versinya dipin.

## Security impact

Prinsip least privilege di level DB: kompromi aplikasi tidak bisa menghapus atau mengubah jejak audit. Query parameterized lewat ORM mengurangi risiko SQL injection.

## Performance / cost impact

Tidak ada biaya tambahan. Drizzle menambah overhead runtime yang minimal.

## Rollback path

Sebelum ada data produksi, migrasi bisa dibuat ulang dari nol. Setelah ada data, hanya forward migration (PRD D3). Ganti tool migrasi lewat ADR baru dengan baseline schema yang di-dump dari DB.
