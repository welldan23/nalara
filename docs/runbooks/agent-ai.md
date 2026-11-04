# Runbook — Agent AI NALARA (Phase 3)

Desain: [ADR-020](../adr/ADR-020-agent-gateway.md) · Rencana: [Phase 3 PLAN](../phase-3/PLAN.md) · Riset provider: [R-02](../phase-3/R-02-SPIKE.md) · Keputusan: **D-25** (provider AI, belum diputuskan).

Ada lima agent: Radar, Penulis, Pemeriksa, Periset, dan Pemantau. Mereka berjalan di container `agent`. Container ini **tidak punya kredensial database**, dan hanya bisa menjangkau dua hal: tool gateway API dan provider AI. Agent hanya bisa membuat **usulan** dan **draft**. Semua usulan diputuskan founder di NALARA OS → Usulan, atau lewat Telegram ([runbook bot](telegram-bot.md)).

## Status default: mati

AI dimatikan oleh tiga lapis. Semuanya harus dibuka dengan sengaja:
1. Container `agent` hanya jalan dengan `--profile agent`.
2. Tanpa `AI_BASE_URL`, runner hidup tapi diam.
3. Saklar **AI** di NALARA OS → Agent AI default-nya **mati**.

## Menyalakan (setelah deploy + D-25)

Jangan pernah menempel token atau API key di chat, git, atau screenshot.

1. **Pilih provider (D-25)** dan jalankan checklist di [R-02 §4](../phase-3/R-02-SPIKE.md): ketentuan layanan membolehkan pemakaian lewat aplikasi, data tidak dipakai untuk melatih model, dan batas biaya bulanan sudah dipasang di dashboard provider. Provider harus menyediakan API OpenAI-compatible (`/chat/completions` dengan tool calling).
2. **Buat kredensial runner** (tokennya tampil sekali saja):
   ```bash
   docker compose -f compose.prod.yaml exec api node dist/cli/agent-credential.js create runner
   ```
   Salin baris token ke `/srv/nalara/.env` sebagai `AGENT_TOKEN=...`.
3. **Isi provider** di `/srv/nalara/.env`:
   ```bash
   AI_BASE_URL=https://<provider>/v1
   AI_API_KEY=<key khusus NALARA>
   AI_MODEL=<nama model>
   # Opsional:
   # AGENT_ROLES=radar,pemeriksa        (mulai dari sedikit peran)
   # AGENT_INTERVAL_SECONDS=1800
   ```
4. **Jalankan:**
   ```bash
   docker compose -f compose.prod.yaml --profile agent up -d agent
   docker compose -f compose.prod.yaml logs --tail 20 agent
   ```
   Log harus menunjukkan `agent runner started`.
5. **Nyalakan saklar** di NALARA OS → Agent AI. Atur kuota harian dulu (default: 3 draft, 30 usulan, 200.000 token).
6. Pantau usulan pertama di NALARA OS → Usulan, dan pemakaian token di halaman Agent AI.

## Mematikan

| Seberapa cepat | Cara |
|---|---|
| Seketika, dari HP | Kirim `/stop` ke bot Telegram |
| Seketika, dari laptop | NALARA OS → Agent AI → **Matikan AI sekarang** |
| Menghentikan container | `docker compose -f compose.prod.yaml --profile agent stop agent` |
| Memutus akses sepenuhnya | `docker compose exec api node dist/cli/agent-credential.js revoke runner` |

CMS tetap berjalan normal di semua kondisi di atas.

## Kalau ada masalah

- **API key provider bocor:** cabut key itu di dashboard provider, isi key baru, lalu `--profile agent up -d agent`.
- **Token runner bocor:** jalankan `revoke runner`, lalu `create runner` lagi, isi `AGENT_TOKEN`, dan jalankan ulang container. Token lama hanya bisa membuat usulan atau draft dalam batas kuota.
- **Agent membuat usulan aneh** (misalnya karena prompt injection dari feed): tolak usulannya. Usulan tidak pernah diterapkan tanpa persetujuan founder. Kalau terus terjadi, matikan AI dan cek sumber feed yang memicunya.
- **Biaya naik:** turunkan kuota token di NALARA OS → Agent AI, atau kurangi `AGENT_ROLES`.
