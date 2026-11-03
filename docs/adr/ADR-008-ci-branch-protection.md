# ADR-008 — GitHub Actions CI, security checks, and branch protection

- **Status:** Accepted
- **Date:** 2026-11-03
- **Approver:** Founder (chat 2026-11-03, "approve semua")
- **Related:** BASELINE K-11, S-03, S-09 · PRD B DEC-009 · PRD D2, D9 · TEST-CI-01..10

## Context

PRD meminta CI sebagai gate PR tanpa layanan berbayar, dengan secret scan dan dependency audit. Urutan tiket asli memasang CI di akhir (K-11), sehingga tiket-tiket awal tidak ter-gate.

## Alternatives

1. **GitHub Actions**: gratis untuk repo ini, terintegrasi dengan branch protection.
2. CI pihak ketiga: menambah akun dan biaya, bertentangan dengan guardrail P0-014.

## Decision

- **GitHub Actions**, dipasang dua tahap:
  - **P0-014a** (langsung setelah P0-003): install `--frozen-lockfile` → format/lint → typecheck → unit test → build → secret scan (gitleaks).
  - **P0-014b** (setelah P0-015): integration test dengan service container PostgreSQL, dependency review/audit, Dependabot (npm, Docker, Actions), dan bukti bahwa kode yang sengaja dirusak membuat CI merah.
- **Hardening workflow:** `permissions: contents: read` sebagai default · semua action **dipin ke commit SHA** · trigger hanya `pull_request` dan `push` ke `main` · **tanpa `pull_request_target`** · tidak ada secret produksi di CI.
- **Branch protection `main`:** wajib PR, larang force push dan delete (sudah dipasang founder 2026-11-03, belum diverifikasi dari sesi). Status check CI ditambahkan sebagai **required** setelah P0-014a hijau.
- Branch kerja: `feat/PXX-YYY-short-name`, satu tiket per PR, conventional commits (PRD D2).

## Positive consequences

- Setiap tiket sejak P0-004 sudah ter-gate otomatis.
- Workflow tahan terhadap action yang dibajak atau PR berbahaya dari fork.

## Negative consequences

- Pin SHA butuh update rutin (ditangani Dependabot).
- Ketersediaan GitHub Actions di repo ini belum diverifikasi (dicek di P0-014a).

## Security impact

Mengurangi risiko supply chain dan kebocoran secret. Mencegah perubahan masuk ke `main` tanpa review dan CI.

## Performance / cost impact

Gratis dalam kuota GitHub Actions. Cache pnpm mempercepat build.

## Rollback path

Workflow bisa dinonaktifkan per file. Required check bisa dilepas sementara oleh founder di Settings, dengan alasan dicatat di DECISIONS.
