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

## P5-03: Paket usulan di Telegram (D-32 "campuran")

- **Arsip bukti dulu:**
  - Saat draft dikirim agent, semua sumber yang dikutip langsung diminta diarsipkan (snapshot + SHA-256, P2).
  - Worker baru mengirim paket setelah **semua** sumber berhasil diarsipkan.
  - Kalau ada sumber yang gagal diarsipkan, ceritanya dilewati dengan catatan.
- **Isi paket:** satu pesan teks biasa (tanpa format, jadi teks AI tidak bisa menjadi tautan tersembunyi). Isinya:
  - skor, judul, ringkasan;
  - daftar sumber dengan URL-nya (primer ditandai);
  - tautan ke draft di OS;
  - cuplikan isi draft.
- **Rute (D-32):**
  - **Cepat**, kalau draft mengutip sumber resmi primer. Tombolnya **✅ Sumber sudah kucek, terbitkan** dan **❌ Lewati**.
    - ✅ membuat revisi baru yang isinya sama, dengan sumber ditandai sudah dicek oleh founder ("Sumber dicek founder lewat tombol Telegram").
    - Setelah itu alur biasa berjalan (ajukan → setujui → terbitkan) atas nama founder. Gerbang terbit dan pengikatan persetujuan ke hash tetap berlaku.
  - **Cek**, kalau sumbernya media saja. **Tidak ada ✅**; yang ada hanya ❌ Lewati. Founder mengecek dan menerbitkan dari OS.
- **Token tombol:**
  - sekali pakai, dan tombol pasangannya ikut mati;
  - berlaku ≤23 jam, dihitung oleh jam database;
  - **terikat ke revisi yang ditampilkan**: kalau draft sudah diedit, ✅ ditolak ("Draft sudah berubah");
  - hanya user ID founder di chat founder (aturan webhook P3-04);
  - worker tidak bisa membaca hash token atau memakai token.
- **Teks paket disusun API saat draft dikirim** dan disimpan di antrean, bersama revisi, daftar URL sumber, dan rute. Dengan begitu worker **tidak pernah membaca isi artikel**. Worker hanya membaca antrean, status arsip bukti, dan tiga kolom artikel (id, revisi saat ini, status) untuk memastikan draft belum berubah. Ini dijaga tes hak akses.
- **Migrasi `0020_story_telegram.sql`:**
  - kolom `route`, `revision_id`, `package_text`, `source_urls`, dan `sent_at` di `story_queue`;
  - tabel `story_tokens` dengan trigger sekali-pakai;
  - hak akses minimum untuk worker.
- **Tes `story-package.test.ts` (6 tes):**
  - menunggu bukti;
  - paket cepat dengan ✅/❌, teks biasa, dan tautan OS;
  - ✅ menerbitkan revisi yang ditampilkan dengan sumber tercatat sudah dicek, dan tidak bisa diulang;
  - paket media tanpa ✅, lalu ❌ melewati;
  - ✅ ditolak setelah draft diedit;
  - sumber gagal diarsipkan → dilewati;
  - token tidak bisa disentuh worker dan tidak bisa dihapus.
- **Ditemukan saat tes:** masa berlaku token sempat dihitung dengan jam Node.js sementara batasnya dicek jam Postgres. Selisih milidetik kadang melanggar batas 1 hari, jadi sekarang dihitung di database.

## P5-04: Edit cepat lewat chat Telegram

- **Migrasi `0021_story_number.sql`:**
  - Tiap cerita dapat nomor pendek (`number`, identity), yang tampil sebagai "Usulan #12".
  - Token tombol sekarang unik per keputusan **per revisi**, jadi revisi baru dapat tombol baru.
  - Role app boleh mengosongkan `sent_at`, supaya worker mengirim ulang paket.
- **Perintah** di chat founder, tanpa AI (`apps/api/src/modules/stories/chat.ts`):
  - `lihat N`: judul, ringkasan, status, dan sumber.
  - `judul N: …`: ganti judul.
  - `ringkas N: …` (juga `ringkasan` / `caption`): ganti ringkasan. Ringkasan juga jadi pembuka caption Kartu IG.
  - `lewati N`: sama dengan ❌.
- **Aturan:**
  - Hanya user id dan chat founder yang dilayani. User lain tidak dijawab dan dicatat di audit.
  - Teks setelah `:` adalah **data**. Teks itu jadi isi field revisi baru, divalidasi seperti edit di OS, dan dibalas sebagai teks polos.
  - Tiap edit = **revisi baru**:
    - cerita kembali ke `drafted` dengan paket baru, dan worker mengirimnya lagi dengan tombol baru;
    - tombol lama terikat ke revisi lama, jadi ditolak ("Draft sudah berubah");
    - persetujuan lama gugur lewat aturan revisi yang sudah ada.
  - Hanya cerita yang masih menunggu (`drafted`/`sent`, artikel masih draft) yang bisa diubah dari chat. Sisanya diubah lewat OS.
- **Tes:**
  - unit `story-chat.test.ts`: 3 tes;
  - integrasi `story-package.test.ts`, 2 tes baru:
    - edit → revisi baru → ✅ lama ditolak → paket baru → ✅ baru menerbitkan hasil edit;
    - teks injeksi tersimpan apa adanya;
    - teks kosong atau terlalu panjang ditolak, nomor tak dikenal ditolak;
    - user lain diabaikan;
    - setelah terbit, cerita tidak bisa diubah dari chat.
- **Belum:** perintah bebas yang diteruskan ke agent (misalnya "buat lebih singkat"). Ini menyusul setelah AI menyala di server (D-25), supaya bisa diuji dengan model sungguhan.
