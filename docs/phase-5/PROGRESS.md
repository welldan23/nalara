# Phase 5: Progres

## P5-01: Radar (klaster + skor)

- **Modul:**
  - `apps/api/src/modules/radar/score.ts`: murni, tanpa I/O dan tanpa AI.
  - `apps/api/src/modules/radar/radar.ts`: membaca item Inbox 36 jam terakhir (status baru/dilihat).
- **Klaster:** judul yang mirip (Jaccard token ≥0,5, tanpa kata umum) menjadi satu cerita.
- **Sumber independen:**
  - Organisasi yang sama dihitung satu.
  - Judul hampir identik di media berbeda (Jaccard ≥0,8: sindikasi atau rilis pers yang disalin) juga dihitung satu.
- **Skor 0–100:**
  - Komponen: kebaruan 30 + bobot sumber 20 (statistik, bank sentral, kementerian, regulator = 1; media = 0,8) + kata kunci 25 + liputan independen 25 − penalti 20.
  - Kata kunci dicocokkan per kata utuh, jadi "AI" tidak cocok dengan "pantai".
  - Topik di preferensi agent ikut menambah daftar kata kunci.
  - Kata penalti termasuk rilis seremonial (pelajaran dari VORSA × SENTINEL).
  - Kata blokir (promo, advertorial, ramalan) membuang cerita.
- **Status jam tenang** (01.00–05.00 WIB) dan tanda "Besar" (skor ≥85) ikut dihitung.
- **Jatah per jam/hari belum dihitung di P5-01.** Jatah itu baru berarti setelah ada antrean usulan (P5-02).
- **Akses:**
  - OS: `GET /api/v1/os/radar` (izin `inbox.read`), ditampilkan sebagai kotak "Radar: cerita teratas" di atas Inbox.
  - Agent: tool `radar.top`, hanya untuk peran Radar. Isinya diberi label `external` (data, bukan perintah).
- **Tes:**
  - unit `tests/unit/radar.test.ts`: 10 tes;
  - integrasi: route `/radar` (urutan skor, 401 tanpa sesi) dan gateway (`radar.top` untuk Radar, 403 untuk Penulis, 400 untuk batas berlebih);
  - daftar tool runner diperbarui.

## P5-02: Antrean usulan (bagian 1: antrean + draft dari agent)

- **Migrasi `0019_story_queue.sql`:** satu baris per cerita Radar yang diambil agent.
  - Isinya: item penyusun, skor, status (`drafting` → `drafted` → `sent` → `published`, atau `skipped`/`expired`), artikel draftnya, dan catatan.
  - Baris tidak bisa dihapus (trigger).
- **Aturan di kode** (`modules/stories/queue.ts`), bukan di prompt:
  - Hanya cerita dengan skor ≥55.
  - Jam 01.00–05.00 WIB hanya cerita besar.
  - Jatah 3 per jam dan 12 per hari, dihitung dari tabel antrean.
  - Satu cerita dipegang satu kali; cerita yang dipegang lebih dari 2 jam kedaluwarsa.
  - Cerita yang itemnya sudah pernah diantrekan tidak diambil lagi.
- **Bahan bernomor:** sumber resmi diurutkan pertama. Draft **hanya** boleh mengutip nomor bahan itu (pelajaran dari VORSA × SENTINEL).
- **Dukungan sumber minimal:** satu sumber resmi primer, atau dua organisasi berbeda. Kalau kurang, draft ditolak.
  - Media tidak boleh ditandai primer.
- **Sitasi tidak pernah ditandai "sudah dicek" oleh agent.** Itu tugas tap founder (P5-03).
- **Tool agent Penulis:** `stories.next`, `stories.submit_draft`, `stories.skip`. Kuota draft harian AI (P3-02) tetap berlaku.
- **OS:** halaman Usulan menampilkan "Antrean Radar" (`GET /api/v1/os/stories`, izin `proposals.read`).
- **Bagian berikutnya** (P5-02b dan P5-03):
  - snapshot bukti untuk sumber yang dikutip;
  - Kartu IG dari draft;
  - paket ke Telegram dengan tombol.
