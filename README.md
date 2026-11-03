# NALARA

**Biar semua paham.** Platform media dan informasi publik Indonesia.

Repo ini monorepo untuk website publik, NALARA OS (dashboard founder), dan API. Status saat ini: **Phase 0 (fondasi)**. Belum ada fitur produk.

## Prasyarat

| Tool | Versi | Cara pasang |
|---|---|---|
| Node.js | sesuai [`.nvmrc`](.nvmrc) (24 LTS) | `nvm install` atau unduh dari nodejs.org |
| pnpm | sesuai `packageManager` di [`package.json`](package.json) | `corepack enable` (Node 24 masih membawa Corepack), atau `npm install -g pnpm@<versi>` |

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

Next.js mengirim telemetri anonim secara default. Untuk mematikannya, jalankan `pnpm --filter @nalara/web exec next telemetry disable` atau set `NEXT_TELEMETRY_DISABLED=1`.

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
- Script install dari paket pihak ketiga tidak dijalankan kecuali diizinkan eksplisit.

## Dokumen

- [PRD master](docs/prd/NALARA_Master_PRD_Full_Phases_0-9_v3.md)
- [ADR](docs/adr/README.md) · [Keputusan founder](docs/decisions/DECISIONS.md)
- [Baseline audit Phase 0](docs/phase-0/BASELINE.md) · [Progress Phase 0](docs/phase-0/PROGRESS.md)
