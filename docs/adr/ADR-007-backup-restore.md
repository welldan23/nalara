# ADR-007 — Backup encryption, retention, restore, offsite destination

- **Status:** Accepted (approach) · **offsite destination PENDING (D-04)**
- **Date:** 2026-11-03
- **Approver:** Founder (chat 2026-11-03, "approve semua")
- **Related:** BASELINE S-11 · PRD A §12.2 · PRD B §6.4, §9.3 · TEST-BACKUP-01..10

## Context

PRD meminta backup PostgreSQL terenkripsi, akses terbatas, retensi terdokumentasi, dan restore yang benar-benar dilatih ke DB terisolasi. Tujuan offsite belum ditentukan founder.

## Alternatives

- Enkripsi: (a) **`age`** (sederhana, kunci publik/privat modern) · (b) GPG (umum, tapi rumit) · (c) restic (deduplikasi, tool tambahan).
- Tujuan offsite: storage S3-compatible pilihan founder · VPS kedua · storage lokal founder.

## Decision

- **Dump:** `pg_dump -Fc` (format custom) memakai role read-only khusus backup bila memungkinkan.
- **Enkripsi:** `age`. **Kunci publik** ada di host. **Kunci privat disimpan offline** oleh founder dan tidak pernah ada di VPS, repo, CI, atau chat.
- **File lokal:** permission `0600`, di direktori khusus milik user backup.
- **Retensi awal:** 7 harian + 4 mingguan. Pruning dijalankan sebagai dry-run dulu, dan baru benar-benar menghapus setelah divalidasi (TEST-BACKUP-08).
- **Restore drill:** selalu ke container PostgreSQL terpisah. **Tidak pernah** ke DB produksi. Verifikasi skema + baris auth/audit.
- **Alert:** bila backup terakhir lebih tua dari ambang (TEST-BACKUP-10).
- **Target awal:** RPO ≤ 24 jam, RTO ≤ 8 jam (target engineering, bukan SLA).
- **Offsite:** PENDING keputusan founder (D-04). Sampai diputuskan, upload offsite **NOT RUN** dan gate produksi P0-015 belum boleh dinyatakan lulus.

## Positive consequences

- Backup yang dicuri dari VPS tidak bisa dibaca tanpa kunci privat yang ada offline.
- Restore terbukti, bukan sekadar diasumsikan.

## Negative consequences

- Kalau founder kehilangan kunci privat, backup tidak bisa dipulihkan. Perlu prosedur penyimpanan kunci cadangan.
- Ada biaya storage offsite (nilai riil dicatat setelah founder memilih provider; tidak ada harga yang diasumsikan).

## Security impact

Menutup risiko kebocoran backup (threat model "Backup compromise") dan memastikan restore tidak menimpa produksi.

## Performance / cost impact

`pg_dump` berjalan di jam sepi. Ukuran DB Phase 0 sangat kecil. Biaya storage menunggu D-04.

## Rollback path

Format `pg_dump -Fc` tetap bisa dibaca `pg_restore` apa pun alat enkripsinya. Ganti `age` ke GPG/restic cukup lewat ADR baru dan script backup.
