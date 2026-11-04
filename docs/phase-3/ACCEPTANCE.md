# Phase 3 — Penerimaan (ACCEPTANCE)

Status: **siap ditinjau founder**. Dibangun dan diuji lokal + CI (D-23), dengan **model AI palsu dan server Telegram palsu**. AI sungguhan dan bot sungguhan menunggu deploy (D-08/D-09) serta keputusan D-25 dan D-26 (§4).

Rencana: [PLAN.md](PLAN.md). Riset provider: [R-02-SPIKE.md](R-02-SPIKE.md). Rincian per tiket: [PROGRESS.md](PROGRESS.md). Desain: [ADR-020](../adr/ADR-020-agent-gateway.md).

## 1. Ringkasan untuk founder

Ide multi-agent sudah punya **pagar**-nya. Ada lima agent, masing-masing dengan tugasnya:

| Agent | Tugas | Yang boleh dibuat |
|---|---|---|
| **Radar** | Membaca inbox baru dan menandai yang relevan dengan topikmu | Usulan "layak ditulis" |
| **Penulis** | Menulis draft dari item yang **sudah kamu setujui** | Draft (kuota harian), sitasi tetap "belum dicek" |
| **Pemeriksa** | Membaca draft dan mencatat klaim/angka yang harus dicek | Usulan catatan |
| **Periset** | Mencari sumber resmi baru | Usulan sumber (selalu kandidat) |
| **Pemantau** | Mengecek kesehatan sistem | Ringkasan |

Yang dijamin, dan sudah dibuktikan dengan tes:

1. Agent **tidak pernah** menyetujui, menerbitkan, menghapus, atau menyentuh database. Semua yang mereka mau ubah jadi **usulan** di `/os/usulan`, dan baru terjadi setelah kamu klik **Setujui**.
2. Agent berjalan di container terpisah **tanpa password database**. Container itu hanya bisa ke tool gateway API dan ke provider AI.
3. Isi feed dianggap **data, bukan perintah**. Kalaupun AI-nya "termakan" prompt injection, hasil terburuknya hanya usulan yang menunggu kamu.
4. **Kill switch**: tombol "Matikan AI sekarang" di `/os/ai`, atau `/stop` di Telegram. Tanpa agent, CMS tetap jalan normal.
5. Ada **kuota harian** untuk draft, usulan, dan token AI.
6. **Telegram**: setiap usulan dikirim ke HP-mu dengan tombol Setujui/Tolak. Tombolnya sekali pakai, kedaluwarsa, dan hanya berlaku dari akunmu.

Default semuanya **mati**. Menyalakannya butuh: deploy, pilihan provider AI (D-25), lalu bot Telegram (D-26). Langkahnya ada di [runbook agent](../runbooks/agent-ai.md) dan [runbook bot](../runbooks/telegram-bot.md).

## 2. Tiket

| Tiket | Isi | PR |
|---|---|---|
| P3-00 | Rencana, research spike R-02, ADR-020, D-24 (PHASE 2 ACCEPTED) | #46 |
| P3-01 | Proposal + approval, `/os/usulan` | #47 |
| P3-02 | Tool gateway, kredensial agent, allowlist per peran, kill switch, kuota, `/os/ai` | #48 |
| P3-03 | Runner agent tanpa kredensial DB, adapter OpenAI-compatible, fetch aman POST | #49 |
| P3-04 | Bot Telegram founder (token sekali pakai, webhook, `/stop`) | #50 |
| P3-05 | Service Compose `agent` yang terisolasi + smoke | #51 |
| P3-06 | Dokumen ini | PR `docs/P3-06-acceptance` |

## 3. Matriks tes (semua dijalankan, semua PASS)

| Area | Tes | Hasil terakhir |
|---|---|---|
| Usulan + approval | `apps/api/tests/integration/proposals.test.ts`: diterapkan sekali sebagai kandidat; payload aneh / `status` / jenis/peran asing ditolak; target berubah → gagal tanpa menimpa; tolak; versi preferensi; kedaluwarsa; immutable di DB | 7/7 |
| Tool gateway | `apps/api/tests/integration/agent-gateway.test.ts`: kredensial; sesi founder ≠ token agent; default mati + audit; allowlist peran, tanpa tool approve/publish/SQL (`__proto__` juga); draft hanya dari item yang disetujui, sekali; catatan pemeriksa; kuota + anggaran token; kill switch; immutable | 8/8 |
| Runner + prompt injection | `apps/api/tests/integration/agent-runner.test.ts` (API sungguhan + model palsu HTTPS): diam tanpa provider/saat mati; hanya tool perannya yang terlihat; isi luar di `external`; **model yang termakan injection** tidak bisa publish/approve/menambah sumber/SQL; kill switch di tengah tugas; error model, batas langkah | 5/5 |
| Fetch aman (POST) | `apps/api/tests/unit/safe-fetch.test.ts`: POST JSON, tanpa redirect, metadata ditolak, batas ukuran | 35/35 |
| Telegram | `apps/api/tests/integration/telegram.test.ts` (Telegram palsu HTTPS): kirim + retry; secret salah; sekali pakai; akun/chat asing; prefiks salah; tombol pasangan; kedaluwarsa; sudah diputuskan di OS; `/stop` hanya founder; grant DB | 6/6 |
| Konfigurasi | `apps/api/tests/unit/env.test.ts`: runner tanpa URL DB; placeholder tidak menyalakan apa pun; provider wajib https | PASS |
| UI | e2e TEST-P3-01 (markup dari agent tampil sebagai teks, setujui/tolak, kandidat, 320 px) dan TEST-P3-02 (default mati, nyalakan, kuota, kill switch, 320 px) | e2e |
| Produksi | `tests/smoke/compose.smoke.mjs`: OPS-03 (`/api/v1/agent/*` → 404 lewat proxy) dan **OPS-09**: agent hanya di jaringan `agent` + `egress`, non-root, **tidak bisa ke `db`/`web`/`caddy`**, tanpa secret DB/sesi, diam tanpa provider, token tidak di-log | 21/21 |
| Semua | `pnpm run check` · `pnpm run test:e2e` · `pnpm run test:backup` · smoke | 487/487 · 23/23 · 11/11 · 21/21 |

Bug yang **ditemukan oleh tes** lalu diperbaiki:
- Tombol kill switch mengirim JSON kosong (e2e).
- Caddy masih meneruskan `/api/v1/agent/*` ke API karena urutan `respond` (smoke). Tes ini gagal sebelum perbaikan dan lulus sesudahnya.

**Exit Phase 3 (PRD v4 §11):**
- "Prompt injection dari konten RSS tidak bisa memicu mutasi" → **PASS** (runner + gateway + e2e).
- "Replay/expired/user asing di callback Telegram ditolak" → **PASS** (tes Telegram).
- "Hermes mati → CMS tetap jalan normal" → **PASS**. Agent bersifat opt-in, e2e berjalan tanpa agent, dan kill switch teruji.
- "Tidak ada akses langsung agent ke DB/SSH" → **PASS**. Agent tanpa kredensial DB, dan smoke OPS-09 membuktikan `db` tidak terjangkau. Container juga tidak punya SSH atau Docker socket.

## 4. Gate terbuka (butuh deploy dan keputusan founder)

| # | Gate | Cara menutup |
|---|---|---|
| G-1 | **D-25: provider AI** | Pilih provider API berbayar per pemakaian, lalu jalankan checklist [R-02 §4](R-02-SPIKE.md). Ikuti [runbook agent](../runbooks/agent-ai.md). Mulai dengan 1–2 peran dan kuota kecil |
| G-2 | **D-26: bot Telegram** | Ikuti [runbook bot](../runbooks/telegram-bot.md). Uji `/status`, satu Setujui, satu Tolak, dan pastikan tombol yang sudah dipakai menolak |
| G-3 | Mutu agent sungguhan | Selama 1–2 minggu, catat berapa usulan/draft yang berguna dan berapa yang ditolak. Sesuaikan peran, kuota, dan preferensi |

## 5. Risiko dan catatan

| ID | Risiko | Dampak | Penanganan |
|---|---|---|---|
| R-P3-01 | Draft AI bisa salah atau mengarang | Artikel keliru | Draft tidak pernah terbit sendiri: sitasi "belum dicek", publish gate, dan approval founder tetap berlaku. Ada juga Pemeriksa. Prompt melarang mengarang angka, kutipan, dan URL |
| R-P3-02 | Biaya AI | Tagihan | Kuota token harian di NALARA, **ditambah** batas biaya di dashboard provider. Angka pemakaian dilaporkan oleh runner sendiri, jadi batas di provider adalah pengaman yang sebenarnya |
| R-P3-03 | Ketentuan provider berubah | Akun diblokir | Cek ulang R-02 sebelum menyalakan dan setiap ganti provider |
| R-P3-04 | Webhook Telegram terbuka ke internet | Spam/serangan | Secret dicek dengan perbandingan waktu-konstan, allowlist user dan chat, token sekali pakai, rate limit global |
| R-P3-05 | Artikel yang dibantu AI tidak berlabel di situs publik | Transparansi ke pembaca | Saat ini hanya tercatat di catatan revisi dan audit (aktor `agent`). Usulan: putuskan kebijakan label "dibantu AI" sebelum G-1 (bisa dijadikan tiket kecil) |
| R-P3-06 | Kualitas usulan Periset (URL sumber bisa keliru) | Waktu founder | Sumber dari usulan selalu `candidate`, jadi founder tetap mengecek URL dan lisensi sebelum `verified` |
| R-P3-07 | User-Agent fetch masih memakai `nalara.media` (belum dibeli, D-08) | Sama seperti R-P2-03 | Ganti saat domain final dipilih |

## 6. Keputusan founder

- [ ] **PHASE 3 ACCEPTED** (fondasi lokal + CI), dengan G-1..G-3 ditutup setelah deploy, **atau**
- [ ] perubahan yang diminta: …

Fase berikutnya menurut PRD v4: **Fase 4, NALARA Data v1** (katalog dataset, provenance + lisensi, versi, chart di artikel). Syarat PRD: "ada kebutuhan nyata dari artikel". Exit-nya butuh minimal satu dataset publik asli. Fondasinya bisa dibangun sekarang. Dataset pertama dan lisensinya dipilih founder.
