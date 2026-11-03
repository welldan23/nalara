# NALARA

**Biar semua paham.** Platform media dan informasi publik Indonesia.

Repo ini monorepo untuk website publik, NALARA OS (dashboard founder), dan API. Status saat ini: **Phase 0 (fondasi)**. Belum ada fitur produk.

> **Phase 0 diterima founder** (2026-11-03). Bukti dan risiko yang masih terbuka: [`docs/phase-0/ACCEPTANCE.md`](docs/phase-0/ACCEPTANCE.md). Gate produksi (backup offsite, VPS/TLS) wajib selesai sebelum deploy publik.

## Prasyarat

| Tool | Versi | Cara pasang |
|---|---|---|
| Node.js | sesuai [`.nvmrc`](.nvmrc) (24 LTS) | `nvm install` atau unduh dari nodejs.org |
| pnpm | sesuai `packageManager` di [`package.json`](package.json) | `corepack enable` (Node 24 masih membawa Corepack), atau `npm install -g pnpm@<versi>` |
| Docker + Compose v2 | terbaru yang stabil | Untuk database lokal, tes compose, dan backup |
| age | 1.1+ | `apt install age` / `brew install age` (hanya untuk backup dan restore) |

## Perintah

```bash
pnpm install --frozen-lockfile   # pasang dependensi persis sesuai lockfile
pnpm run lint                    # ESLint (type-aware)
pnpm run typecheck               # TypeScript strict di root dan semua workspace
pnpm run test                    # Vitest
pnpm run build                   # build semua workspace
pnpm run format:check            # Prettier
pnpm run check                   # semua cek di atas berurutan
```

Suite yang butuh Docker atau browser (semuanya juga jalan di CI):

```bash
TEST_DATABASE_ADMIN_URL=postgres://postgres:<pw>@127.0.0.1:5432/postgres pnpm run test   # + tes integrasi DB
TEST_DATABASE_ADMIN_URL=... pnpm run test:e2e   # browser (Playwright Chromium)
pnpm run test:compose                           # stack produksi + Caddy (build image)
pnpm run test:backup                            # backup terenkripsi + restore drill
```

Next.js mengirim telemetri anonim secara default. Untuk mematikannya, jalankan `pnpm --filter @nalara/web exec next telemetry disable` atau set `NEXT_TELEMETRY_DISABLED=1`.

## Database dan akun founder (lokal)

```bash
cp .env.example .env                              # ganti semua REPLACE_WITH_
docker compose up -d db                           # PostgreSQL 18 lokal
pnpm --filter @nalara/api run db:migrate          # terapkan migrasi
FOUNDER_EMAIL=kamu@example.com pnpm --filter @nalara/api run founder:bootstrap
```

`founder:bootstrap` hanya bisa membuat **satu** founder. Password diketik tanpa tampil di layar, dan tidak pernah diterima sebagai argumen. Detail database ada di [`db/README.md`](db/README.md).

## Menjalankan topologi produksi (Docker Compose)

```bash
# di VPS: env file di luar repo, izin 0600, berisi POSTGRES_PASSWORD, DB_MIGRATOR_PASSWORD,
# DB_APP_PASSWORD (hex, URL-safe), APP_BASE_URL (https), SESSION_SECRET, MFA_ENCRYPTION_KEY
docker compose -f compose.prod.yaml --env-file /srv/nalara/.env build
docker compose -f compose.prod.yaml --env-file /srv/nalara/.env run --rm migrate
docker compose -f compose.prod.yaml --env-file /srv/nalara/.env up -d
```

Hanya Caddy yang membuka port ke host (80/443). Reverse proxy itulah satu-satunya pintu masuk. Database hanya ada di jaringan `backend` yang `internal`. Semua container berjalan non-root dengan filesystem read-only. Uji otomatisnya: `pnpm run test:compose`.

Di balik proxy TLS-inspecting (misalnya sandbox), build dengan `docker build --network host --build-arg HTTPS_PROXY=... --secret id=npm_ca,src=<ca-bundle> -f apps/api/Dockerfile .`. CA dan proxy tidak tersimpan di image (dicek TEST-COMPOSE-10).

## Struktur

```text
apps/web    Next.js: website publik + UI NALARA OS (tanpa akses database)
apps/api    API: satu-satunya pemilik business logic dan database
tests/      tes lintas repo (aturan kebersihan repo)
docs/       PRD, ADR, keputusan founder, dokumen Phase 0
```

`packages/*` (mis. `contracts`, `ui`) baru dibuat saat pertama kali dibutuhkan.

## Kebijakan dependensi

- Semua versi dipin persis (tanpa `^`/`~`) dan dikunci di `pnpm-lock.yaml`.
- pnpm hanya memasang versi yang sudah dirilis minimal **7 hari** (`minimumReleaseAge` di [`pnpm-workspace.yaml`](pnpm-workspace.yaml)).
- pnpm hanya mau jalan di versi Node sesuai `engines` (`engineStrict`).
- Script install (`postinstall` dsb.) dari dependensi **diblokir** oleh pnpm (`ERR_PNPM_IGNORED_BUILDS`). Kalau ada paket yang benar-benar butuh, izinkan secara eksplisit lewat `pnpm approve-builds` dan catat alasannya di PR.

## Dokumen

- [PRD master](docs/prd/NALARA_Master_PRD_Full_Phases_0-9_v3.md)
- [ADR](docs/adr/README.md) · [Keputusan founder](docs/decisions/DECISIONS.md)
- [Baseline audit Phase 0](docs/phase-0/BASELINE.md) · [Progress Phase 0](docs/phase-0/PROGRESS.md) · [**Acceptance Phase 0**](docs/phase-0/ACCEPTANCE.md)
- [Rencana Phase 1 (usulan)](docs/phase-1/BASELINE.md) · [ADR Phase 1 (usulan)](docs/phase-1/ADR-PROPOSALS.md)
- [Arsitektur & batas kepercayaan](docs/architecture/phase-0.md) · [Threat model](docs/security/threat-model.md) · [Kebijakan keamanan](SECURITY.md)
- Runbook: [deploy VPS](docs/runbooks/deploy-vps.md) · [backup & restore](docs/runbooks/backup-restore.md) · [insiden & rollback](docs/runbooks/incident.md) · [CI & dependensi](docs/runbooks/ci-and-dependencies.md)
