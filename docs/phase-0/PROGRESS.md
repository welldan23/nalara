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

### P0-014a — CI baseline
- Commit SHA: lihat PR `feat/P00-014a-ci-baseline`
- Changed files: `.github/workflows/ci.yml`, `tests/repo/ci.test.ts`, `docs/phase-0/PROGRESS.md`
- Isi workflow: job `check` (install `--frozen-lockfile` → format → lint → typecheck → test → build, Node dari `.nvmrc`, pnpm via Corepack) dan job `secret-scan` (gitleaks 8.30.1, checksum SHA-256 diverifikasi, scan seluruh riwayat). `permissions: contents: read`, `persist-credentials: false`, trigger `pull_request` + `push` ke `main`, tanpa `pull_request_target`
- Action dipin SHA: `actions/checkout` v7.0.1 `3d3c42e5aac5ba805825da76410c181273ba90b1` · `actions/setup-node` v7.1.0 `949feb2413d6458794dcd2491c4babbbce0c15c1` (keduanya ≥ 7 hari)
- Tests run (lokal):
  - `actionlint 1.7.12` (binary, checksum diverifikasi) → PASS (0 temuan)
  - `pnpm run check` → PASS, **21/21** tes (7 tes baru untuk hardening workflow)
  - `gitleaks git` ke seluruh riwayat repo → `no leaks found` (10 commit)
- Negative tests: action tanpa pin SHA + `pull_request_target` + `contents: write` → 3 tes ✗ · token GitHub palsu di repo probe → gitleaks `leaks found: 1`, exit 1
- CI di GitHub: lihat status check di PR (diverifikasi setelah run selesai)
- Security review: PASS (token read-only, kredensial checkout tidak disimpan, tanpa action pihak ketiga selain milik `actions/*`, binary gitleaks diverifikasi checksum)
- Known issues: required status check di branch protection `main` harus ditambahkan founder (Settings), karena tidak bisa dari sesi ini. Uji "CI merah pada kode rusak" di GitHub dilakukan di P0-014b
- Founder decision: PENDING

**Next ticket:** P0-004 — Environment validation (urutan D-02).
