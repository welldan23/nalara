# ADR-001 — Package manager, Node.js runtime, workspace convention

- **Status:** Accepted
- **Date:** 2026-11-03
- **Approver:** Founder (chat 2026-11-03, "approve semua")
- **Related:** BASELINE K-09 · PRD B §2 (open decisions), §9.1 · TEST-REPO-03, TEST-REPO-04, TEST-REPO-09

## Context

Repo ini masih greenfield. PRD meminta monorepo `apps/web`, `apps/api`, `packages/*` dengan pnpm via Corepack dan Node LTS yang dipin di `.nvmrc`. Rilis LTS saat audit: v26.13.0 "Lithium" dan v24.22.2 "Krypton". Cloud session saat ini menjalankan v22.23.4. Ada laporan bahwa Node 25+ tidak lagi membawa Corepack (NOT VERIFIED).

## Alternatives

1. **pnpm workspaces**: dependensi ketat (tanpa phantom dependency), hemat disk, lockfile deterministik.
2. npm workspaces: tanpa tool tambahan, tapi hoisting longgar dan sering memicu phantom dependency.
3. Yarn/Bun: menambah variabel tooling tanpa kebutuhan yang jelas.

Untuk runtime: Node 24 LTS atau Node 26 LTS.

## Decision

- Package manager **pnpm workspaces** (`pnpm-workspace.yaml` dengan `apps/*` dan `packages/*`).
- Versi pnpm dipin di field `packageManager` pada root `package.json`. Instalasi didokumentasikan dua jalur: Corepack bila tersedia di runtime, atau `npm install -g pnpm@<versi-pin>`.
- Runtime **Node.js 24 LTS (Krypton)**. Patch persis ditulis di `.nvmrc` dan `engines.node` saat P0-003, setelah diverifikasi.
- Install di CI dan Docker selalu memakai `pnpm install --frozen-lockfile`.
- Naik ke Node 26 dilakukan lewat ADR terpisah setelah dependensi native (argon2) terbukti kompatibel.

## Positive consequences

- Install reproducible dan dependensi tiap workspace eksplisit.
- Node 24 lebih matang untuk modul native dibanding LTS yang baru keluar.

## Negative consequences

- Cloud session perlu memasang Node 24 (saat ini v22) sebelum P0-003 bisa diverifikasi penuh.
- Masa dukungan Node 24 lebih pendek dari Node 26, jadi akan butuh upgrade lebih awal.

## Security impact

Lockfile + `--frozen-lockfile` mencegah dependensi berubah diam-diam (supply chain, S-09). Versi pnpm yang dipin mencegah perilaku resolver berbeda antar mesin.

## Performance / cost impact

Tidak ada biaya. pnpm lebih cepat dan hemat disk di CI.

## Rollback path

Hapus `pnpm-lock.yaml` dan `pnpm-workspace.yaml`, lalu pakai `workspaces` di `package.json` dengan npm. Ganti Node cukup lewat `.nvmrc`, `engines`, dan base image Docker.
