# Phase 2 — Progress

Satu entri per tiket, format sama dengan Phase 1. Rencana: [PLAN.md](PLAN.md).

### P2-01 — Fetch aman (anti-SSRF)
- Commit: lihat PR `feat/P2-01-safe-fetch`
- File baru: `apps/api/src/modules/fetch/{address-policy,safe-fetch}.ts`, `apps/api/tests/unit/safe-fetch.test.ts`
- Perilaku: `safeFetch(url, options)` adalah **satu-satunya** jalan worker ke internet.
  - Hanya `https:` di port 443 dan `http:` di port 80. URL berisi kredensial ditolak.
  - Semua alamat hasil DNS harus publik. Yang ditolak:
    - IPv4: loopback, privat (termasuk jaringan Docker `172.16/12`), link-local (termasuk metadata cloud `169.254.169.254`), CGNAT, multicast, reserved, dokumentasi;
    - IPv6: `::1`, `::`, IPv4-mapped/compatible, NAT64, 6to4, Teredo, ULA, link-local, multicast.
  - Bila **satu saja** alamat dalam jawaban DNS privat, seluruh fetch ditolak.
  - Koneksi memakai alamat yang sudah dicek (fungsi `lookup` di-pin), jadi DNS rebinding tidak bisa menukar alamat di antara cek dan koneksi.
  - IP literal dalam bentuk desimal, hex, atau oktal (`2130706433`, `0x7f.1`, `0177.0.0.1`) dinormalkan oleh parser URL, lalu dicek dengan aturan yang sama.
  - Redirect diikuti manual, maksimal 3. Setiap hop dicek ulang: skema, port, kredensial, dan alamat.
  - Satu batas waktu untuk seluruh fetch (default 15 detik), batas ukuran body **setelah dekompresi** (default 2 MiB, menahan bom gzip), dan allowlist content-type.
  - Header `Host`/`Connection` dari pemanggil diabaikan. User-Agent jujur: `NALARA-Ingest/1.0`.
  - Setiap penolakan berupa `FetchBlocked` dengan alasan tetap, tanpa memuat URL atau isi.
- **Ditemukan saat tes:** `BlockList` Node juga mencocokkan alamat IPv4 dengan aturan IPv6 (sebagai `::ffff:a.b.c.d`), sehingga aturan IPv4-mapped sempat menolak **semua** IPv4. Diperbaiki dengan memakai daftar terpisah untuk IPv4 dan IPv6; tes alamat publik kini ikut menjaga ini.
- Test:
  - `pnpm run check` → PASS **405/405**.
  - Termasuk 34 tes fetch aman, memakai server HTTP lokal dan DNS palsu:
    - 22 alamat terlarang ditolak, 5 alamat publik diizinkan;
    - loopback, `localhost`, `[::1]`, `0.0.0.0`, metadata, privat, dan IP desimal/hex/oktal ditolak **tanpa koneksi sama sekali**;
    - jawaban DNS campuran ditolak (rebinding), juga DNS gagal;
    - redirect ke metadata, ke nama yang menunjuk IP privat, dan ke `file:` ditolak; batas 3 hop;
    - skema, port, dan kredensial;
    - respons terlalu besar, bom gzip, dan server lambat (timeout);
    - content-type, `If-None-Match` → 304, dan `Host` yang tidak bisa diganti.
- Security review: PASS. Belum ada pemanggil; modul ini dipakai worker mulai P2-02/P2-04.
- Keputusan founder: PENDING

### P2-02 — Worker + antrean job
- Commit: lihat PR `feat/P2-02-worker-queue`
- File berubah:
  - baru: `db/migrations/0010_job_queue.sql`, `apps/api/src/worker.ts`, `apps/api/src/worker/{queue,runner}.ts`, `apps/api/tests/integration/queue.test.ts`;
  - `apps/api/src/{db/schema,config/env}.ts`, `db/init/01-roles.sh`, `infra/scripts/restore.sh`, `apps/api/tests/support/database.ts`, `compose.prod.yaml`, `.env.example`, `db/README.md`;
  - tes repo, env, db, backup, dan compose.
- Perilaku:
  - **Proses worker terpisah.** Image sama dengan API, perintah `dist/worker.js`, tanpa port HTTP, tanpa secret sesi atau MFA.
  - **Role database `nalara_worker` dengan hak minimal:** hanya `job_runs`. Tidak bisa membaca `users`, `sessions`, `recovery_codes`, `articles`, `media_assets`, atau audit, dan tidak bisa DDL.
  - Role baru dibuat di `db/init`, `restore.sh`, dan dukungan tes. Untuk volume lama ada perintah satu kali di `db/README.md`.
  - **Antrean di Postgres (`job_runs`):**
    - satu job aktif per (jenis, subjek), jadi enqueue ulang tidak menambah apa pun;
    - klaim dengan `FOR UPDATE SKIP LOCKED` + lease, sehingga dua worker tidak pernah mengambil job yang sama, dan job yang workernya mati diambil ulang setelah lease habis;
    - hanya pemegang lease yang bisa menyelesaikan job;
    - error disimpan sebagai kode tetap (bukan URL atau isi);
    - retry dengan backoff eksponensial + full jitter (maksimal 6 jam).
  - **Loop worker:** handler yang error tidak menjatuhkan worker (job dicoba lagi). `stop()` (SIGTERM) berhenti mengambil job baru dan menunggu job yang sedang jalan. Heartbeat ditulis ke `/tmp` untuk healthcheck.
  - **Compose:**
    - service `worker` di jaringan `backend` + `egress` (baru, hanya worker anggotanya), jadi tidak bisa menjangkau web atau Caddy;
    - dikeraskan sama seperti service lain (read-only, cap_drop ALL, no-new-privileges, non-root);
    - healthcheck memeriksa umur file heartbeat.
  - Belum ada handler. Handler `feed_check`/`feed_fetch` datang di P2-03/P2-04.
- Test:
  - `pnpm run check` → PASS (angka di PR). Termasuk 8 tes antrean:
    - backoff;
    - satu job aktif per subjek;
    - 16 klaim paralel dari 2 pool atas 8 job → 8 job unik;
    - hanya job yang jatuh tempo dan jenisnya diminta;
    - lease habis → diambil worker lain, pemegang lama tidak bisa menyelesaikan;
    - retry lalu gagal permanen, error disanitasi;
    - loop: handler error tidak menjatuhkan worker, stop menunggu job berjalan;
    - hak akses role worker dan app.
  - `pnpm run test:backup` → PASS **11/11** (role worker ikut dibuat saat restore).
  - `pnpm run test:e2e` → PASS **20/20**.
  - `node tests/smoke/compose.smoke.mjs` → PASS **20/20**:
    - worker ikut di cek healthy, tanpa port, non-root, hardening, dan FS read-only;
    - cek baru TEST-COMPOSE-11: worker hanya di `backend` + `egress`, `egress` hanya berisi worker, worker menjangkau `db` tetapi tidak `web`/`caddy`, dan hak tabel `nalara_worker` sesuai.
- Security review: PASS. Worker yang dibobol lewat feed berbahaya tetap tidak bisa membaca data orang, sesi, atau artikel, dan tidak bisa menjangkau web atau Caddy di jaringan internal.
- Keputusan founder: PENDING

**Next:** P2-03 — Feed di Source Registry.
