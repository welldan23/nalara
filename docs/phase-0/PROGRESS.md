# NALARA Phase 0 — Progress Log

Format mengikuti PRD §19 (Definition of done and evidence format).

### P0-001 — Repository reconnaissance
- Commit SHA: lihat PR `feat/P00-001-repo-baseline`
- Changed files: `docs/phase-0/BASELINE.md`, `docs/phase-0/ADR-PROPOSALS.md`, `docs/phase-0/PROGRESS.md`
- Tests run: perintah audit read-only (lihat `BASELINE.md` §9). Belum ada test suite karena belum ada kode
- Result: PASS (dokumen baseline lengkap: path, branch, versi runtime, gap, risiko)
- Security review: PASS (secret scan tanpa temuan, tanpa perubahan kode)
- Manual validation: NOT RUN (menunggu review founder)
- Known issues: migrasi `master` → `main` selesai (default branch `main`, `master` dihapus, protection dipasang founder; `BASELINE.md` §8). 16 konflik spesifikasi menunggu keputusan (`BASELINE.md` §4)
- Founder decision: ACCEPTED (2026-11-03, chat: "approve semua"; mencakup ADR-001..009 dan urutan tiket §6.1)

### P0-002 — Architecture decision records
- Commit SHA: lihat PR `feat/P00-002-adr`
- Changed files: `docs/adr/README.md`, `docs/adr/ADR-001..009-*.md`, `docs/decisions/DECISIONS.md`, `docs/prd/NALARA_Master_PRD_Full_Phases_0-9_v3.md` (setelah repo private), `docs/phase-0/ADR-PROPOSALS.md` (ditandai arsip), `docs/phase-0/PROGRESS.md`
- Tests run: validasi kelengkapan template PRD §17 di setiap ADR, validasi link relatif di `docs/**`, eksekusi SQL ADR-009 di `postgres:16-alpine`, secret scan (perintah dan hasil ada di deskripsi PR)
- Result: lihat deskripsi PR
- Security review: PASS (tanpa kode runtime, tanpa secret)
- Manual validation: NOT RUN (menunggu review founder)
- Known issues: D-04, D-07, D-08, D-09 masih OPEN (`docs/decisions/DECISIONS.md`). Repo sudah private (D-13) dan PRD sudah di-commit (D-05)
- Founder decision: PENDING

### P0-003 — Workspace scaffold
- Commit SHA: lihat PR `feat/P00-003-workspace-scaffold`
- Changed files: root `package.json`, `pnpm-lock.yaml`, `pnpm-workspace.yaml`, `tsconfig.base.json`, `tsconfig.json`, `eslint.config.mjs`, `.prettierrc.json`, `.prettierignore`, `vitest.config.ts`, `.gitignore`, `.dockerignore`, `.editorconfig`, `.nvmrc`, `README.md` · `apps/web/{package.json,next.config.ts,tsconfig.json,app/layout.tsx,app/page.tsx}` · `apps/api/{package.json,tsconfig.json,tsconfig.build.json,src/index.ts}` · `tests/repo/repo.test.ts`
- Tests run (Node 24.22.2, pnpm 12.16.1):
  - `pnpm run format:check` → PASS
  - `pnpm run lint` → PASS (setelah 1 temuan nyata di kode tes diperbaiki)
  - `pnpm run typecheck` → PASS (root, api, web)
  - `pnpm run test` → PASS 14/14
  - `pnpm run build` → PASS (api `tsc`, web `next build`)
  - TEST-REPO-09: clone bersih → `pnpm install --frozen-lockfile` → `pnpm run check` → PASS, worktree tetap bersih
- Negative tests (harus gagal, dan memang gagal): `.env.production` ter-track → TEST-REPO-05 FAIL · versi `^19.3.1` → TEST-REPO-03 FAIL · type error → `TS2322` · floating promise → `no-floating-promises` · install di Node 22 → `ERR_PNPM_UNSUPPORTED_ENGINE` (dengan `engineStrict`) · vitest di Node 22 → TEST-REPO-04 FAIL · dependensi dengan `postinstall` (esbuild, di folder probe terpisah) → `ERR_PNPM_IGNORED_BUILDS`
- Security review: PASS. Tanpa secret. Script install dependensi diblokir. Hanya versi ≥ 7 hari (`minimumReleaseAge: 10080`, tanpa exclusion). Semua versi dipin persis
- Manual validation: NOT RUN (menunggu review founder)
- Keputusan versi dan penyimpangan:
  - Node **24.22.2** (patch D-10). Node 24 masih membawa Corepack, jadi K-09 aman untuk Node 24 (diverifikasi).
  - pnpm **12.16.1**.
  - **TypeScript 6.0.3**, bukan 7.0.2 (`latest`), karena `typescript-eslint@8.72.1` mensyaratkan `typescript >=4.8.4 <6.1.0`.
  - Next.js **16.4.3**, bukan 16.4.4, karena 16.4.4 baru dirilis kurang dari 7 hari (begitu juga `vitest 5.0.5` dan `eslint 10.13.0`).
  - `packages/contracts` dan `packages/ui` belum dibuat (guardrail "avoid excessive shared packages"). Dibuat saat pertama dipakai (P0-006/P0-011).
- Known issues: K-10 (nama file `middleware.ts` vs `proxy.ts` di Next 16) diverifikasi di P0-011. Telemetri Next.js aktif secara default (cara mematikan ada di README)
- Founder decision: PENDING

**Next ticket:** P0-014a — CI dasar (sesuai urutan D-02).
