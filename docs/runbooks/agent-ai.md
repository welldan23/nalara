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

**Cara cepat (disarankan):** di server jalankan `sudo nalara ai`. Perintah itu mengerjakan langkah 2–4 di bawah:
1. **API key:** ditempel tanpa tampil di layar, lalu dicek dengan satu permintaan kecil ke OpenCode Go. Key yang ditolak (401/403) tidak disimpan.
2. **Model:** model bawaan dan model per agen diisi dengan pilihan awal (tabel di bawah), dan hanya kalau model itu ada di daftar provider.
3. **Agent:** kredensial runner dibuat (kalau belum ada), lalu agent dijalankan. Perintahnya baru selesai setelah log menunjukkan `agent runner started`.

Setelah itu tinggal **nyalakan saklar** di NALARA OS → Agent AI (langkah 5).

| Peran | Model awal | Alasan |
|---|---|---|
| bawaan (`AI_MODEL`) | `deepseek-v4.1-flash` | murah, mendukung tool calling |
| radar | `gpt-6-luna` | murah dan cepat untuk memilah berita |
| penulis | `qwen3.8-max` | model kuat untuk menulis panjang |
| pemeriksa | `deepseek-v4-pro` | keluarga berbeda dari penulis, supaya kesalahannya tidak sama |
| periset | `minimax-m3` | menengah |
| pemantau | `gpt-6-luna` | termurah |

Perintah lain:
- `sudo nalara ai-model <peran|default> <model>` mengganti model satu agent. Model yang namanya berakhiran `-contributor` atau `-free` ditolak, karena model seperti itu bisa melatih dirinya dari prompt. Tanpa nama model, perintah ini menampilkan daftar model yang boleh dipakai.
- `sudo nalara ai-off` menghentikan container agent. CMS tetap jalan.

1. **Pilih provider (D-25)** dan jalankan checklist di [R-02 §4](../phase-3/R-02-SPIKE.md): ketentuan layanan membolehkan pemakaian lewat aplikasi, data tidak dipakai untuk melatih model, dan batas biaya bulanan sudah dipasang di dashboard provider. Provider harus menyediakan API OpenAI-compatible (`/chat/completions` dengan tool calling).
2. **Buat kredensial runner** (tokennya tampil sekali saja):
   ```bash
   docker compose -f compose.prod.yaml exec api node dist/cli/agent-credential.js create runner
   ```
   Salin baris token ke `/srv/nalara/.env` sebagai `AGENT_TOKEN=...`.
3. **Isi provider** di `/srv/nalara/.env`. Pilihan founder (D-25) adalah **OpenCode Go**:
   ```bash
   AI_BASE_URL=https://opencode.ai/inference/go/openai/v1
   AI_API_KEY=<key OpenCode Go, khusus NALARA>
   AI_MODEL=<model bawaan, misalnya model "flash" yang murah>
   # Opsional: model berbeda per peran (kosong = pakai AI_MODEL)
   # AI_MODEL_RADAR=<murah dan cepat>
   # AI_MODEL_PENULIS=<paling kuat untuk bahasa Indonesia>
   # AI_MODEL_PEMERIKSA=<keluarga BERBEDA dari Penulis, supaya kesalahannya tidak sama>
   # AI_MODEL_PERISET=<menengah>
   # AI_MODEL_PEMANTAU=<termurah>
   # AGENT_ROLES=radar,pemeriksa        (mulai dari sedikit peran)
   # AGENT_INTERVAL_SECONDS=1800
   ```
   - **Nama model:** tulis nama model persis seperti di daftar model OpenCode Go, huruf kecil dan tanpa awalan `opencode-go/`. Daftarnya bisa dilihat di `https://opencode.ai/inference/go/v1/models` atau di halaman dokumentasi Go. Daftar itu bisa berubah, jadi cek dulu saat mengisi.
   - **Privasi:** di OpenCode Console → Settings → Privacy, biarkan *"Allow paid endpoints that train on request data"* **mati**. Jangan pakai model yang namanya berakhiran `-contributor`: model itu melatih dirinya dari prompt.
   - **Header:** runner mengirim User-Agent `NALARA-Agent/1.0` dan `x-opencode-session` (acak per tugas), sesuai permintaan dokumentasi Go. Runner tidak menyamar sebagai aplikasi lain.
   - **Batas pemakaian Go:** ada jatah per 5 jam, per minggu, dan per bulan. Kalau jatah habis, provider menjawab error dan tugas agent berhenti dengan rapi (`model:rate_limited` atau `model:http_error`), lalu dicoba lagi di putaran berikutnya.
   - **Risiko yang diterima founder (D-25):** ketentuan layanan OpenCode membatasi proses otomatis saat tidak login dan pemakaian untuk pihak ketiga (lihat R-02). Kalau akun dibatasi atau diblokir, **pindah provider tanpa ubah kode**: ganti `AI_BASE_URL`, `AI_API_KEY`, dan nama model ke provider API berbayar (misalnya OpenRouter atau OpenAI), lalu `docker compose ... up -d agent`.
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
