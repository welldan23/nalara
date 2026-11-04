# Runbook — Bot Telegram founder (Phase 3)

Tiket: P3-04 · Keputusan: D-26 (belum diputuskan) · Desain: [ADR-020](../adr/ADR-020-agent-gateway.md), [Phase 3 PLAN](../phase-3/PLAN.md).

Bot ini dipakai untuk tiga hal:
- mengirimi founder pesan untuk setiap usulan agent baru, lengkap dengan tombol **Setujui** / **Tolak**;
- menjadi kill switch dari HP (`/stop`);
- menampilkan status singkat (`/status`).

Bot **mati** sampai langkah di bawah dijalankan. Tanpa bot, usulan tetap bisa diputuskan di NALARA OS → Usulan.

## Cara kerjanya (singkat)

- **Worker** (satu-satunya proses dengan akses internet) mengirim pesan. Pesannya teks polos: teks tulisan agent tidak pernah jadi tautan atau format.
- Tiap tombol membawa token acak 128 bit yang:
  - hanya bisa dipakai **sekali**;
  - berlaku paling lama **24 jam**;
  - terikat ke satu usulan dan satu keputusan.

  Database hanya menyimpan hash token. Menekan satu tombol juga mematikan tombol pasangannya.
- **API** menerima klik lewat webhook `POST /api/v1/telegram/webhook`. Webhook ditolak (401) kalau tidak membawa secret yang benar. Klik dari akun lain atau dari chat lain diabaikan (tanpa jawaban) dan dicatat di audit.
- Jawaban ke Telegram dikirim di dalam respons webhook itu sendiri, jadi API tetap tidak pernah membuat koneksi keluar.

## Setup (setelah deploy, D-08/D-09)

Jangan pernah menempel token bot atau secret di chat, di git, atau di screenshot.

1. Di Telegram, buka **@BotFather** → `/newbot`. Pilih nama, misalnya "NALARA Founder", dan username yang berakhiran `bot`. Simpan tokennya di password manager.
2. Di server, isi `/srv/nalara/.env`:
   ```bash
   TELEGRAM_BOT_TOKEN=<token dari BotFather>
   TELEGRAM_WEBHOOK_SECRET=<hasil: openssl rand -hex 32>
   ```
3. Kirim `/start` ke bot dari akun Telegram founder, lalu jalankan:
   ```bash
   docker compose -f compose.prod.yaml up -d worker
   docker compose -f compose.prod.yaml exec worker node dist/cli/telegram-setup.js ids
   ```
   Perintah ini menampilkan `userId` dan `chatId` (angka, bukan rahasia). Isi keduanya:
   ```bash
   TELEGRAM_FOUNDER_USER_ID=<userId>
   TELEGRAM_CHAT_ID=<chatId>
   ```
4. Nyalakan ulang dan pasang webhook:
   ```bash
   docker compose -f compose.prod.yaml up -d api worker
   docker compose -f compose.prod.yaml exec worker node dist/cli/telegram-setup.js set-webhook
   docker compose -f compose.prod.yaml exec worker node dist/cli/telegram-setup.js info
   ```
   `info` harus menunjukkan URL `https://<domain>/api/v1/telegram/webhook` tanpa `lastError`.
5. Uji: kirim `/status` ke bot. Balasannya harus berbunyi "AI mati. Usulan menunggu: N.".

## Kalau ada masalah

- **Token bot bocor:** di @BotFather jalankan `/revoke`, isi token baru di `.env`, lalu ulangi langkah 4.
- **Secret webhook bocor:** buat secret baru, isi di `.env`, lalu ulangi langkah 4.
- **Matikan bot sepenuhnya:** kosongkan `TELEGRAM_BOT_TOKEN` dan `TELEGRAM_WEBHOOK_SECRET`, lalu `up -d api worker`. Usulan tetap bisa diputuskan di OS.
- **Ada tombol yang tidak berlaku:** itu memang disengaja kalau tombolnya sudah dipakai, kedaluwarsa, atau usulannya sudah diputuskan di OS. Buka NALARA OS → Usulan.
