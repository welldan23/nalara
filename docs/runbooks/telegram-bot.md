# Runbook — Bot Telegram founder (Phase 3)

Tiket: P3-04 · Keputusan: D-26 · Desain: [ADR-020](../adr/ADR-020-agent-gateway.md), [Phase 3 PLAN](../phase-3/PLAN.md).

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

**Cara cepat (disarankan):** di server jalankan `sudo nalara telegram`. Perintah itu mengerjakan langkah 2–4 di bawah:
- token ditempel tanpa tampil di layar;
- secret webhook dibuat acak;
- `userId` dan `chatId` diambil sendiri setelah kamu mengirim `/start` ke bot;
- webhook dipasang.

Langkah manual di bawah tetap berlaku sebagai cadangan.

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

## Perintah di chat

- `/status`: status AI dan jumlah usulan menunggu.
- `/stop`: kill switch AI.
- `/autopilot on|off`: terbit otomatis (P5-10).
- Edit cepat usulan (P5-04). Nomornya ada di pesan usulan, misalnya "Usulan #12":
  - `lihat 12`
  - `judul 12: teks baru`
  - `ringkas 12: teks baru` (juga pembuka caption Kartu IG)
  - `lewati 12`

  Tiap edit membuat revisi baru. Tombol di pesan lama tidak berlaku lagi, dan paket baru dengan tombol baru menyusul dalam beberapa detik.

## Autopilot: terbit otomatis (P5-10)

- `/autopilot on` menyalakan, `/autopilot off` mematikan, `/autopilot` menampilkan status. `/status` juga menampilkannya. Setiap perubahan tercatat di audit.
- Saat nyala, usulan yang **LOLOS** cek Pemeriksa (lihat [runbook agent](agent-ai.md)) dan punya sumber resmi primer menampilkan baris "Autopilot: terbit otomatis 15 menit setelah pesan ini masuk".
- Kalau dalam 15 menit kamu tidak menekan ❌, sistem menerbitkannya sendiri lewat gerbang terbit yang sama. Kartu IG + caption menyusul seperti biasa.
- **Tidak pernah otomatis:**
  - usulan DITAHAN;
  - usulan dengan sumber media saja;
  - usulan yang diedit setelah dicek;
  - usulan yang pesannya tidak menyebut autopilot;
  - jam 01-05 WIB (menunggu sampai jam 05);
  - lebih dari 8 per hari.
- Rem darurat: `/autopilot off`, atau `/stop` (mematikan semua AI).

## Kartu IG setelah terbit (P5-04b)

Begitu sebuah berita **terbit** (lewat ✅ di Telegram atau tombol Terbitkan di OS), bot mengirim:

1. **Album** berisi gambar Kartu IG (1080×1350, urut). Simpan semuanya ke galeri.
2. **Caption** sebagai pesan terpisah. Tekan lama pesannya, lalu Salin.

Lalu posting manual di Instagram (pilih beberapa foto, tempel caption). Biasanya datang 1-2 menit setelah terbit.

- Gambarnya sama persis dengan yang ada di NALARA OS → Newsroom → Kartu IG. Kalau album tidak datang, ambil dari situ.
- Album tidak dikirim dua kali. Kalau hanya caption yang gagal, yang dikirim ulang hanya caption.
- Gagal 10 kali atau lebih dari 3 hari: berhenti dicoba. Ambil kartunya dari OS.
- Telegram mengompres foto sedikit. Kalau mau kualitas penuh, unduh PNG dari OS.

## Kalau ada masalah

- **Token bot bocor:** di @BotFather jalankan `/revoke`, isi token baru di `.env`, lalu ulangi langkah 4.
- **Secret webhook bocor:** buat secret baru, isi di `.env`, lalu ulangi langkah 4.
- **Matikan bot sepenuhnya:** kosongkan `TELEGRAM_BOT_TOKEN` dan `TELEGRAM_WEBHOOK_SECRET`, lalu `up -d api worker`. Usulan tetap bisa diputuskan di OS.
- **Ada tombol yang tidak berlaku:** itu memang disengaja kalau tombolnya sudah dipakai, kedaluwarsa, atau usulannya sudah diputuskan di OS. Buka NALARA OS → Usulan.
