# Phase 2 — Penerimaan (ACCEPTANCE)

Status: **siap ditinjau founder**. Dibangun dan diuji lokal + CI (D-23). Gate yang hanya bisa diuji setelah deploy dicatat terbuka di §4.

Rencana: [PLAN.md](PLAN.md). Rincian per tiket: [PROGRESS.md](PROGRESS.md).

## 1. Ringkasan untuk founder

Sumber resmi yang sudah **Terverifikasi** di Source Registry kini bisa diberi URL feed RSS/Atom. Setelah feed lolos cek:

1. **Worker** (proses terpisah, hak database minimal) mengambil feed kira-kira tiap jam. Fetch dilakukan sopan, dengan ETag dan Last-Modified.
2. Item baru masuk ke **Inbox** `/os/inbox`. Duplikat dibuang, dan cerita yang sama dari sumber lain ditandai.
3. Dari inbox, **"Buat draft"** membuat artikel yang **mengutip tulisan aslinya** tanpa menyalin teksnya. Sumber tetap harus dicek manusia.
4. Saat sumber ditandai "sudah dicek", worker menyimpan **salinan halaman sumber + SHA-256** sebagai bukti (vault).
5. Feed yang terus gagal, atau yang mencurigakan, **dikarantina otomatis** tanpa mengganggu feed lain. Hanya founder yang bisa melepasnya.

Tidak ada yang terbit otomatis. Tidak ada isi feed yang tampil di situs publik.

## 2. Tiket

| Tiket | Isi | PR |
|---|---|---|
| P2-00 | Rencana + D-23 | #36 |
| P2-01 | Fetch aman (anti-SSRF) | #37 |
| P2-02 | Worker + antrean job + role `nalara_worker` | #38 |
| P2-03a | Parser feed ketat (RSS 2.0, RSS 1.0, Atom) | #39 |
| P2-03b | Feed di Source Registry + cek feed | #40 |
| P2-04 | Ingestion berjadwal + dedup | #41 |
| P2-05 | Retry + karantina | #42 |
| P2-06 | Inbox + draft dari item | #43 |
| P2-07 | Vault bukti | #44 |
| P2-08 | Dokumen ini | PR `docs/P2-08-acceptance` |

## 3. Matriks tes (semua dijalankan, semua PASS)

| Area | Tes | Hasil terakhir |
|---|---|---|
| SSRF (PRD v4 §11) | `apps/api/tests/unit/safe-fetch.test.ts`: loopback, IP privat, metadata cloud `169.254.169.254`, `[::1]`, `0.0.0.0`, IP desimal/hex/oktal, DNS campuran (rebinding), redirect ke privat/metadata/`file:`, batas hop, skema/port/kredensial, ukuran, bom gzip, timeout, content-type | 34/34 |
| Parser feed | `apps/api/tests/unit/feed.test.ts`: XXE, billion laughs, entity tak dikenal, XML rusak, batas kedalaman/node/ukuran, prototype pollution, HTML → teks polos tanpa script, URL kanonik, RSS/Atom/RDF, encoding | 23/23 |
| Antrean + worker | `apps/api/tests/integration/queue.test.ts`: tanpa klaim ganda (16 paralel), lease habis, kepemilikan, retry/gagal, stop menunggu job, hak role | 8/8 |
| Feed di registry | `apps/api/tests/integration/feeds.test.ts`: aturan URL, cek sehat/gagal sebagai kode, hanya verified (saat antre **dan** saat jalan), hak kolom worker | 5/5 |
| Ingestion | `apps/api/tests/integration/ingestion.test.ts`: item sekali saja, 304, link pelacak tidak dobel, backoff lalu pulih, feed tak layak tidak dijadwalkan, status inbox milik founder | 5/5 |
| Karantina | `apps/api/tests/integration/quarantine.test.ts`: karantina setelah 5 gagal sementara feed lain tetap jalan, alamat internal → langsung, lepas → wajib lolos cek dulu | 4/4 |
| Inbox | `apps/api/tests/integration/inbox.test.ts` + e2e TEST-P2-06: paginasi, tandai, draft mengutip tanpa menyalin, gerbang menahan | 4/4 + e2e |
| Vault | `apps/api/tests/integration/evidence.test.ts` (server HTTPS lokal): salinan byte-per-byte + SHA-256, unduh sebagai attachment, dipakai ulang, retry, immutable | 4/4 |
| Produksi | `tests/smoke/compose.smoke.mjs`: TEST-COMPOSE-11 (worker hanya `backend` + `egress`, tidak menjangkau web/Caddy, hak tabel), worker healthy dan dikeraskan | 20/20 |
| Semua | `pnpm run check` · `pnpm run test:e2e` · `pnpm run test:backup` | 458/458 · 21/21 · 11/11 (P2-07) |

**Exit Phase 2 (PRD v4 §11):**
- "Feed rusak dikarantina tanpa ganggu job lain" → **PASS** (tes karantina).
- "Test SSRF (loopback, IP privat, metadata cloud, redirect ke privat) semua ditolak" → **PASS**.
- "Tanpa duplikat" → **PASS** (tes ingestion).
- "2–3 sumber terverifikasi jalan stabil ≥ 2 minggu" → **TERBUKA**, butuh deploy (§4).

## 4. Gate terbuka (butuh deploy, D-08/D-09)

| # | Gate | Cara menutup |
|---|---|---|
| G-1 | 2–3 sumber terverifikasi berjalan stabil ≥ 2 minggu tanpa duplikat | Setelah deploy: founder memverifikasi sumber + lisensi, isi URL feed, cek feed, lalu pantau `ingestion_runs` dan inbox selama 2 minggu |
| G-2 | Fetch ke internet sungguhan (bukan server lokal) | Otomatis terjadi di G-1; catat hasil cek feed pertama di sini |
| G-3 | Restore drill dengan data Phase 2 (item, run, bukti) | `pnpm run test:backup` sudah mencakup skema; ulangi restore dari backup produksi setelah ada data |

## 5. Risiko dan catatan

| ID | Risiko | Dampak | Penanganan |
|---|---|---|---|
| R-P2-01 | Parser ketat mungkin menolak feed resmi yang memakai DOCTYPE atau XML tidak rapi | Feed tertentu tidak bisa dipakai | Cek feed menampilkan alasannya (mis. "Feed memakai DOCTYPE"). Bila sering terjadi pada sumber penting: izinkan DOCTYPE **tanpa** subset internal (tetap tanpa entity), lewat tiket kecil |
| R-P2-02 | Ketentuan penggunaan penerbit dan beban server mereka | Hubungan dengan sumber | Fetch sekitar 1 jam sekali, memakai ETag/Last-Modified, User-Agent jujur. Founder mengecek ketentuan sebelum `verified` (R-03, R-04) |
| R-P2-03 | User-Agent memuat `https://nalara.media/tentang`, padahal domain belum dibeli (D-08) | Penerbit tidak bisa menghubungi | Ganti ke domain final saat D-08 diputuskan |
| R-P2-04 | Bukti (sampai 5 MB per salinan) memperbesar database dan backup | Backup lebih besar | Dipantau setelah deploy; kebijakan retensi bukti bisa ditambah nanti |
| R-P2-05 | Halaman yang butuh JavaScript hanya tersalin kerangkanya | Bukti kurang lengkap | Diterima. Untuk dokumen penting, simpan PDF resminya sebagai sitasi |
| R-P2-06 | Hanya satu worker, penjadwal tiap menit | Skala | Cukup untuk puluhan sumber. Antrean sudah aman untuk banyak worker bila perlu |

Sisa dari Phase 1 tetap berlaku: deploy (D-08/D-09), **PHASE 1 ACCEPTED**, required status checks di GitHub, dan validasi pembaca.

## 6. Keputusan founder

- [x] **PHASE 2 ACCEPTED** (fondasi lokal + CI), dengan G-1..G-3 ditutup setelah deploy. Ditulis founder 2026-11-04 (D-24), **atau**
- [ ] perubahan yang diminta: …

Fase berikutnya menurut PRD v4: **Fase 3, Hermes + Telegram (proposal + approval)**. Prasyaratnya *research spike* R-02 lolos. Founder sudah menyampaikan ide multi-agent (Radar, Periset, Penulis, Pemeriksa fakta, Editor bahasa, Pemantau) dan kemungkinan memakai opencode. Sebelum Fase 3 dibangun, perlu dipastikan dulu: akses API/model dari server, dan syarat layanan untuk pemakaian otomatis.
