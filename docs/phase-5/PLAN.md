# Phase 5 — Mode Usulan Otomatis (ala VORSA)

Status: **DIMULAI** 2026-11-06 atas permintaan founder ("oke boleh dan juga pelajarin cara scraping", D-31), setelah membaca sistem VORSA (`vorsa.zip`; dibaca saja, tidak ada kode yang dijalankan atau disalin). Dibangun dan diuji lokal + CI dengan AI tiruan dan Telegram tiruan. Untuk menyala di server, butuh D-25 (provider AI), D-26 (bot Telegram), dan D-08 (deploy).

## 1. Tujuan

Pekerjaan founder tinggal **satu tap di HP**. Mesin mencari berita, AI meriset dan menyiapkan draft artikel serta Kartu IG, lalu founder menerima **paket usulan di Telegram** dengan tombol:
- **✅ Terbitkan + kirim paket IG**;
- **✏️ Revisi**;
- **❌ Lewati**.

Pelajaran utama dari VORSA: "mode otomatis" VORSA **tidak memposting sendiri**. AI mengerjakan semuanya, tetapi tap pemilik tetap menjadi persetujuannya, dan persetujuan itu terikat ke versi persis yang ditampilkan.

## 2. Batas yang tidak berubah

- **Tidak ada yang terbit tanpa tap founder.** Tap itu menyetujui satu revisi tertentu (ID + hash isi). Edit apa pun setelahnya membatalkan persetujuan itu (sama dengan gerbang approve/publish Phase 1).
- **Gerbang sumber tetap berlaku.** Usulan tanpa sumber terverifikasi tidak dikirim, dan rumor tidak pernah diusulkan.
- **Agent hanya lewat gateway** (ADR-020): tanpa kredensial DB, tanpa tool approve/publish, kill switch, dan kuota harian.
- **Konten luar adalah data, bukan perintah.** Isi feed, artikel, dan halaman web tidak pernah dijalankan sebagai instruksi.
- **Foto hanya yang lisensinya jelas.** Foto media lain ("via CNBC") ditolak.

## 3. Hasil belajar: cara VORSA mengambil berita

| Bagian VORSA | Cara kerjanya | Di NALARA |
|---|---|---|
| Feed RSS per brand (Antara, CNBC, CNN, Detik, BBC, dan lain-lain) dengan bobot kredibilitas | `urllib`, User-Agent jujur, batas 5 MB, 2 percobaan, tiap sumber maksimal sekali per 4 menit | **Sudah ada** (P2-02/03): safe fetch anti-SSRF, parser XML ketat tanpa DOCTYPE, ETag/Last-Modified, karantina feed rusak |
| URL kanonik (buang `utm_`, `fbclid`, ...) dan dedup | Regex parameter pelacak | **Sudah ada** (`canonicalUrl`, P2-04) |
| **Klaster cerita** | Judul yang mirip (Jaccard token ≥0,5 dalam 36 jam) dianggap satu cerita | **Belum.** Tiket P5-01 |
| **Sumber independen** | Penerbit yang sama, atau judul hampir identik antar-media (Jaccard ≥0,8, sindikasi atau rilis pers yang disalin), dihitung satu | **Belum.** P5-01 |
| **Skor 0–100 deterministik** | Kebaruan 30 + bobot sumber 20 + kata kunci 25 + jumlah sumber independen 25 − penalti 20. Kata blokir (promo, zodiak, advertorial) dibuang | **Belum.** P5-01 |
| Jam tenang dan jatah | 01.00–05.00 WIB hanya skor ≥85; maksimal 3 per jam dan 12 per hari | **Belum.** P5-01 |
| Baca artikel penuh | Library `open-news` | **Belum.** Ditunda (lihat §4) |
| Pencarian topik | DuckDuckGo News lewat library `ddgs` (scraping tidak resmi), karena tautan Google News tidak bisa dibuka dari VPS | **Tidak diadopsi** (lihat §4) |
| Foto berlisensi | API resmi Openverse dan Wikimedia Commons. Hanya CC0, domain publik, CC BY, CC BY-SA; NC/ND/tidak jelas dibuang | **Belum.** P5-05 (BY-SA ditandai, tidak otomatis) |

## 4. Aturan scraping NALARA

Urutan prioritas, dari yang paling aman:

1. **RSS/Atom resmi penerbit.** Feed memang disediakan untuk dibaca mesin. Ini jalur utama.
2. **API atau data terbuka resmi** (BPS, BI, data.go.id, Wikimedia, Openverse).
3. **Halaman HTML sumber resmi**, hanya untuk:
   - mengarsip **bukti** (snapshot + SHA-256, sudah ada di P2), dan
   - membaca isinya untuk riset internal.

   Isinya **tidak** diterbitkan ulang. NALARA menulis penjelasan sendiri dan menautkan sumbernya.

Yang tidak dilakukan:
- **Tidak** menembus paywall, login, CAPTCHA, atau anti-bot. Tidak memalsukan User-Agent browser. Tidak memakai proxy rotasi.
- **Tidak** men-scrape mesin pencari tanpa API resmi (misalnya `ddgs`): itu melanggar ketentuan layanan dan rapuh.
- **Selalu** patuh `robots.txt` untuk halaman HTML, jeda per domain, User-Agent yang menyebut NALARA dan halaman kontak, serta batas ukuran.
- **Teks media lain** hanya dipakai sebagai bahan riset. Yang dikutip di artikel cuma kalimat pendek dengan atribusi. Fakta tidak dilindungi hak cipta, tetapi teksnya dilindungi.

Kalau nanti butuh halaman yang hanya tampil dengan JavaScript, itu menjadi kandidat uji coba **browser headless terisolasi** (misalnya Lightpanda di container Debian sendiri, D-30), dan baru dilakukan setelah ada sumber penting yang memang membutuhkannya.

## 5. Tiket

| # | Tiket | Isi | Tes utama |
|---|---|---|---|
| P5-01 | Radar: klaster + skor | Klaster cerita dari item Inbox (Jaccard judul), hitung sumber independen (sindikasi = satu), skor 0–100 deterministik dengan kata kunci boost/penalti/blokir dan bobot sumber, jam tenang, jatah per jam/hari. Tampil di OS Inbox dan bisa dibaca agent Radar | Klaster benar; sindikasi dihitung satu; kata blokir dibuang; jatah dan jam tenang; deterministik |
| P5-02 | Paket usulan | Worker menjadwalkan cerita teratas untuk agent. Agent riset → draft artikel (proposal) → Kartu IG. Paket = draft + kartu + daftar sumber + skor, tersimpan sebagai usulan, dan hanya untuk TERVERIFIKASI/SEBAGIAN | Tanpa sumber terverifikasi tidak dikirim; agent tetap tanpa tool publish |
| P5-03 | Tombol Telegram | Kirim preview kartu + ringkasan ke bot founder dengan tombol ✅/✏️/❌. ✅ = setujui + terbitkan revisi persis itu (terikat hash), lalu kirim PNG + caption. Token sekali pakai, hanya user ID founder | Tap ganda; revisi setelah kartu terkirim membatalkan; user lain ditolak |
| P5-04 | Edit cepat lewat chat | Perintah pasti tanpa AI (`judul N: ...`, `caption N: ...`, `lihat N`) dan perintah bebas yang diteruskan ke agent. Setiap edit = revisi baru, persetujuan lama gugur, kartu dikirim ulang | Edit membuat versi baru; persetujuan gugur; injeksi lewat teks diperlakukan sebagai data |
| P5-05 | Cari foto berlisensi | Dari OS atau agent: cari di Wikimedia Commons/Openverse lewat safe fetch, ambil lisensi + pembuat otomatis, masuk Media Library hanya untuk CC0/PD/CC BY (BY-SA ditandai), kredit otomatis. Rana menjadi sampul cadangan Kartu IG tanpa foto; dukungan WebP | NC/ND/tidak jelas ditolak; kredit benar; SSRF |
| P5-06 | Penerimaan Phase 5 | `docs/phase-5/ACCEPTANCE.md` | — |

## 6. Exit Phase 5

- **Lokal/CI:** satu putaran lengkap dengan AI dan Telegram tiruan: item feed → klaster → skor → paket usulan → tap ✅ → artikel terbit + paket IG. Termasuk: edit setelah kartu terkirim membatalkan tap lama, dan tap dari user lain ditolak.
- **Gate terbuka:** di server sungguhan setelah D-08, D-25, dan D-26. Founder menerima usulan pertama di HP dan menerbitkannya dengan satu tap.
