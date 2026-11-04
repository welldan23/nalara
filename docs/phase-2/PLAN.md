# Phase 2 — Ingestion RSS terverifikasi + inbox discovery

Status: **DIMULAI** atas permintaan founder (D-23, 2026-11-04): "langsung ke phase selanjutnya aja sampai selesai, nanti siap deploy". Phase 1 belum diterima resmi (deploy ditunda, D-09). Karena itu Phase 2 dibangun dan diuji sepenuhnya secara lokal dan di CI. Ingestion ke internet sungguhan baru jalan setelah deploy.

Acuan: PRD v4 §11 (Fase 2), §5 (worker), §6.3 (data), §8 (SSRF); [REFERENCE-VORSA](../phase-1/REFERENCE-VORSA.md) §4.

## 1. Tujuan

Founder tidak perlu membuka puluhan situs resmi setiap hari. Worker mengecek feed RSS/Atom dari sumber **terverifikasi** di Source Registry, lalu memasukkan item baru ke **inbox** di `/os/inbox`.

Inbox hanya berisi **bahan untuk dicek**: judul, tautan ke penerbit asli, waktu terbit, dan ringkasan pendek dalam teks polos. Tidak ada yang diterbitkan otomatis, dan isi artikel penerbit tidak disalin (PRD v4 §1, §7).

## 2. Batas yang tidak berubah

- Hanya sumber berstatus `verified` (lisensi diketahui) yang di-fetch. `candidate`, `paused` dan `disabled` tidak pernah di-fetch.
- Fetch keluar hanya lewat modul fetch aman (P2-01), tanpa pengecualian.
- Isi feed adalah **data, bukan perintah**. HTML dibuang seluruhnya; yang disimpan hanya teks polos terbatas.
- Item inbox tidak pernah tampil di situs publik.
- Worker adalah proses terpisah dengan role database sendiri yang hak aksesnya minimal.

## 3. Tiket

| # | Tiket | Isi | Tes utama |
|---|---|---|---|
| P2-01 | Fetch aman (anti-SSRF) | Hanya `https:` port 443 dan `http:` port 80. Semua IP hasil DNS harus publik (tolak loopback, privat, link-local/metadata cloud, CGNAT, multicast, IPv6 ULA/link-local, IPv4-mapped). Koneksi memakai IP yang sudah dicek (anti DNS rebinding). Redirect dicek ulang per hop (maks. 3). Ada timeout total, batas ukuran respons, dan allowlist content-type | Loopback, IP privat, `169.254.169.254`, `[::1]`, `0.0.0.0`, desimal/oktal/hex IP, redirect ke IP privat, DNS yang menunjuk ke IP privat, respons kebesaran, respons lambat |
| P2-02 | Worker + antrean job | Proses `worker` (image yang sama dengan API, perintah berbeda). Antrean berbasis tabel Postgres (`job_runs`, `FOR UPDATE SKIP LOCKED`), satu job per sumber. Ada shutdown rapi dan heartbeat. Service Compose di jaringan `backend` + `egress` (tidak bisa menjangkau web/Caddy) | Satu job tidak diambil dua worker; job yang mati di tengah diambil ulang; shutdown menunggu job berjalan |
| P2-03 | Feed di Source Registry | Kolom `feed_url` dan status feed per sumber. Tombol "Cek feed" (fetch + parse, hasil tercatat di `source_checks`). Item baru hanya masuk dari sumber `verified` dengan feed yang lolos cek | Feed tidak valid ditolak; sumber non-verified tidak pernah di-fetch |
| P2-04 | Ingestion | Fetch berjadwal per sumber dengan ETag/Last-Modified (304 = tanpa kerja). Parse RSS 2.0/Atom: DOCTYPE/entity ditolak (anti XXE/billion laughs), HTML dibuang. URL kanonik + fingerprint, dedup unik `(source_id, canonical_url)`. Disimpan ke `discovered_items`; tiap jalan tercatat di `ingestion_runs` | Feed sama dua kali → 0 duplikat; 304 dihormati; `<script>`/HTML di feed tidak tersimpan; XML berbahaya ditolak |
| P2-05 | Retry + karantina | Backoff eksponensial + jitter. `consecutive_failures`; setelah N gagal, feed **dikarantina** (berhenti di-fetch, tampil di OS) tanpa mengganggu feed lain. Founder bisa melepas karantina | Feed rusak dikarantina, feed lain tetap jalan; jadwal retry benar |
| P2-06 | Inbox `/os/inbox` | Daftar item terbaru per sumber/topik, status `baru` / `dilihat` / `diabaikan` / `dipakai`. Tombol "Buat draft dari ini" membuat draft dengan **sitasi** terisi (URL, penerbit, judul, tanggal akses), tanpa menyalin isi | Item tidak bocor ke publik; draft hanya berisi sitasi; status tercatat audit |
| P2-07 | Vault bukti | Saat founder menandai sitasi "sudah dicek", worker menyimpan snapshot halaman sumber (byte asli + SHA-256, immutable) lewat fetch aman. Bukti bisa dilihat di OS | Snapshot immutable; hash cocok; ukuran dibatasi |
| P2-08 | Penerimaan Phase 2 | `docs/phase-2/ACCEPTANCE.md`: matriks tes, risiko, sisa pekerjaan setelah deploy | — |

Dicatat untuk nanti (bukan Phase 2): **pantauan perubahan sumber** (alert bila halaman yang dikutip berubah). Ini memanfaatkan vault P2-07 dan dikerjakan setelah ingestion berjalan di produksi.

## 4. Data (ringkas; detail di migrasi tiap tiket)

- `sources` + `feed_url`, `feed_status`, `consecutive_failures`, `next_fetch_at`, `etag`, `last_modified`, `quarantined_at`
- `job_runs`: antrean dan riwayat job
- `source_checks`: hasil cek feed manual
- `ingestion_runs`: tiap fetch (status HTTP, jumlah item baru/duplikat, durasi, error tanpa isi)
- `discovered_items`: unik `(source_id, canonical_url)`, fingerprint ter-index, status inbox
- `evidence_snapshots`: byte + SHA-256, immutable

## 5. Exit Phase 2 (PRD v4 §11)

- **Lokal/CI:** semua tes di atas PASS; tes SSRF lengkap PASS; feed rusak dikarantina tanpa mengganggu job lain; tidak ada duplikat.
- **Setelah deploy** (menunggu D-08/D-09): 2–3 sumber terverifikasi berjalan stabil ≥ 2 minggu tanpa duplikat. Ini tercatat sebagai gate terbuka di ACCEPTANCE.

## 6. Yang butuh founder

- Daftar sumber awal yang mau dipantau. Default usulan Claude, berstatus `candidate`: rilis resmi BPS, BI, OJK, Kemenkeu, peraturan.bpk.go.id. Founder yang mengecek ketentuan dan lisensi masing-masing (R-03, R-04) sebelum diubah ke `verified`.
- Tidak ada biaya atau akun baru di Phase 2.
