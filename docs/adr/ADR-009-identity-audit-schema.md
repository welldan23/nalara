# ADR-009 — Identity and audit schema shape

- **Status:** Accepted
- **Date:** 2026-11-03
- **Approver:** Founder (chat 2026-11-03, "approve semua")
- **Related:** BASELINE K-03, K-04 · PRD B §7, DEC-005 · PRD A §7.1, §7.3 · PRD C P02-002, Phase 04 · TEST-DB-05..07, TEST-AUTH-10

## Context

Phase 0 v2 memakai tabel `founders` dan `audit_events(actor_founder_id, target_*, occurred_at)`. PRD v1.0, Phase 02 ("Founder role-based authorization"), dan Phase 04 (aktor AI/Telegram) butuh `role` dan aktor non-founder. Rename tabel atau ubah bentuk audit setelah ada data adalah migrasi yang berisiko.

## Alternatives

1. Ikuti v2 apa adanya, lalu migrasi di Phase 1/2.
2. **Bentuk siap-masa-depan sekarang**, dengan perilaku Phase 0 tetap founder-only.

## Decision

Opsi 2. Kontrak skema (nama kolom final ditentukan di P0-005 sesuai ADR-003):

```sql
CREATE TABLE users (
  id            uuid PRIMARY KEY,
  email         text NOT NULL UNIQUE,
  password_hash text NOT NULL,
  role          text NOT NULL CHECK (role IN ('founder')),
  mfa_enabled   boolean NOT NULL DEFAULT false,
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now()
);
-- Maksimal satu founder
CREATE UNIQUE INDEX users_single_founder ON users (role) WHERE role = 'founder';

-- sessions: seperti PRD B §7, dengan user_id → users(id)

CREATE TABLE audit_events (
  id            uuid PRIMARY KEY,
  actor_type    text NOT NULL CHECK (actor_type IN ('founder', 'system')),
  actor_id      uuid,                 -- NULL untuk actor_type = 'system'
  action        text NOT NULL,
  resource_type text,
  resource_id   text,
  result        text NOT NULL CHECK (result IN ('success', 'failure', 'denied')),
  request_id    text,
  metadata      jsonb NOT NULL DEFAULT '{}'::jsonb,  -- hanya key yang ada di allowlist
  created_at    timestamptz NOT NULL DEFAULT now()
);
```

- Nilai `role` dan `actor_type` baru (mis. `ai_proposal`, `telegram`) **hanya** ditambah lewat migrasi di fase terkait, dengan ADR.
- Tidak ada endpoint registrasi. Founder hanya bisa dibuat lewat bootstrap CLI lokal (P0-007).
- `metadata` divalidasi terhadap allowlist key per `action` di aplikasi, sehingga secret tidak bisa masuk (PRD B §7).
- Append-only dijaga role DB `nalara_app` (ADR-003).

Bukti: constraint satu-founder dan `CHECK role` sudah diuji saat audit di `postgres:16-alpine`. Insert founder kedua ditolak `duplicate key`, dan role lain ditolak `violates check constraint`.

## Positive consequences

- Phase 02/04 cukup menambah nilai enum lewat migrasi kecil, tanpa rename tabel atau memindahkan data audit.
- Audit bisa mencatat aksi sistem (mis. job backup) sejak Phase 0.

## Negative consequences

- Sedikit menyimpang dari contoh SQL di PRD B §7. Penyimpangan ini dicatat di sini dan di DECISIONS.

## Security impact

Satu founder dijamin di level DB, bukan cuma di kode. Allowlist metadata mencegah secret tercatat di audit.

## Performance / cost impact

Tidak signifikan. Index `audit_events(created_at DESC)` dan `(resource_type, resource_id)` ditambahkan di P0-005.

## Rollback path

Sebelum ada data produksi, migrasi bisa dibuat ulang mengikuti skema PRD B §7 apa adanya, lewat ADR baru yang menggantikan ADR ini.
