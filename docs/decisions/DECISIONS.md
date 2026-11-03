# NALARA — Founder Decision Register

Sesuai PRD D8: setiap keputusan dicatat dengan tanggal, pertanyaan, opsi, pilihan, alasan, implikasi biaya/keamanan, dan rollback. Yang masih **OPEN** wajib diputuskan sebelum titik yang tercantum.

Jangan pernah menulis password, recovery code, private key, atau token di file ini. Cukup tulis nama atau status konfigurasinya.

## Keputusan yang sudah diambil

| ID | Tanggal | Pertanyaan | Pilihan | Alasan | Implikasi biaya/keamanan | Rollback | Referensi |
|---|---|---|---|---|---|---|---|
| D-00 | 2026-11-03 | Nama branch utama | `main` (master dihapus, default branch `main`, protection dipasang founder) | Konvensi PRD D2 | Mencegah push langsung dan force push ke `main` | Rename branch di GitHub Settings | BASELINE §8 |
| D-01 | 2026-11-03 | Terima ADR-001..009 dan rekomendasi audit? | Diterima semua ("approve semua"). D-05 sempat ditahan sampai repo private (D-13) | Sesuai rekomendasi audit | Lihat tiap ADR | ADR pengganti | [docs/adr](../adr/README.md) |
| D-02 | 2026-11-03 | Urutan eksekusi tiket Phase 0 | `001 → 002 → 003 → 014a → 004 → 005 → 006 → 007 → 010 → 008 → 009 → 011 → 012 → 013 → 015 → 014b → 016` | CI lebih awal. Sesi dibangun sebelum login dan MFA (K-11) | Semua tiket sejak P0-004 ter-gate CI | Kembali ke urutan PRD B §13 | BASELINE §6.1 |
| D-03 | 2026-11-03 | Metode MFA | TOTP (passkey opsional nanti) | Sederhana, offline, tanpa perangkat khusus | Rentan phishing real-time. Kunci enkripsi wajib dijaga | ADR baru untuk passkey | [ADR-005](../adr/ADR-005-mfa-totp-recovery.md) |
| D-06 | 2026-11-03 | Urutan fase setelah Phase 0 | Pakai PRD bagian C (01–09), dengan P02-001/002 (dashboard shell + otorisasi founder) dikerjakan sebelum P01-004. Opsi launch terbatas setelah P02 ditinjau ulang sebelum Phase 1 | CMS butuh dashboard dan otorisasi (K-06) | Belum ada dampak di Phase 0 | Ubah lewat entri baru di register ini | BASELINE K-06 |
| D-13 | 2026-11-03 | Visibilitas repo | **Private** (diubah founder, lalu diverifikasi: API `visibility: private`, akses anonim `404`) | Repo memuat PRD, threat model, dan desain auth | Sempat public ±1 jam berisi dokumen audit/ADR (tanpa secret). Salinan cache atau fork pihak luar selama jendela itu tidak bisa dipastikan | Ubah lagi di Settings → Danger Zone | — |
| D-05 | 2026-11-03 | Commit PRD master ke repo? | Ya, di `docs/prd/` (dilakukan setelah repo private) | Semua sesi Claude membaca sumber yang sama (K-08) | Hanya aman selama repo private | Hapus file lewat PR | [docs/prd](../prd/NALARA_Master_PRD_Full_Phases_0-9_v3.md) |
| D-10 | 2026-11-03 | Versi Node.js | Node 24 LTS (Krypton). Patch dipin di P0-003 | Lebih matang untuk modul native | Upgrade ke Node 26 butuh ADR baru | Ganti `.nvmrc`/`engines`/base image | [ADR-001](../adr/ADR-001-package-manager-node-workspace.md) |
| D-11 | 2026-11-03 | Arsitektur web/API | Next.js (UI saja) + Fastify API terpisah | Batas kepercayaan tegas untuk fase Hermes/Telegram (K-01) | Satu proses tambahan di VPS | Lebur ke Next.js lewat ADR baru | [ADR-002](../adr/ADR-002-web-api-boundary-framework.md) |
| D-12 | 2026-11-03 | Bentuk tabel identitas dan audit | `users` + `role` (maks. 1 founder) dan `audit_events` dengan `actor_type` | Siap fase depan tanpa rename (K-03, K-04) | Satu founder dijamin di DB | Regenerasi migrasi sebelum ada data | [ADR-009](../adr/ADR-009-identity-audit-schema.md) |
| D-14 | 2026-11-03 | Cara kerja | Founder minta proses berjalan dengan pertanyaan seminimal mungkin dan PR di-merge otomatis setelah CI hijau. Keputusan teknis kecil diambil Claude dan dicatat di sini/ADR untuk ditinjau | Mempercepat Phase 0 | Founder tetap pemegang gate fase (`PHASE 0 ACCEPTED`) | Founder bisa minta kembali ke mode review-dulu | — |
| D-15 | 2026-11-03 | Alat migrasi | SQL tulis tangan + runner checksum sendiri, Drizzle ORM hanya untuk query (didelegasikan) | drizzle-kit membawa esbuild/tsx/loader deprecated, dan migrator Drizzle tidak cek checksum | Supply chain lebih kecil, tamper migrasi terdeteksi | ADR baru kembali ke drizzle-kit | [ADR-010](../adr/ADR-010-sql-first-migrations.md) |
| D-16 | 2026-11-03 | Terima Phase 0? | **PHASE 0 ACCEPTED** (opsi 1 di ACCEPTANCE §8): fondasi lokal + CI diterima. Gate produksi (offsite backup, VPS/TLS/firewall) tetap terbuka | 129/130 PASS, 0 FAIL, CI terbukti memblokir kode rusak | Deploy publik tetap butuh D-04, D-08, D-09 dan TEST-OPS di VPS | Founder bisa mencabut lewat entri baru | [ACCEPTANCE](../phase-0/ACCEPTANCE.md) |

## Keputusan yang masih OPEN

| ID | Pertanyaan | Dibutuhkan sebelum | Catatan |
|---|---|---|---|
| D-04 | Lokasi backup offsite terenkripsi dan siapa yang memegang kredensial | Deploy publik pertama (gate R-01) | Backup dan restore lokal tetap dikerjakan. Upload offsite NOT RUN sampai diputuskan |
| D-07 | OS laptop founder dan apakah Docker terpasang | Dokumentasi P0-003 | Untuk menulis instruksi setup lokal yang tepat |
| D-08 | Provider VPS, spek CPU/RAM/disk, versi Ubuntu, domain dan kontrol DNS | Deploy publik pertama (gate R-02) | Tanpa ini, rehearsal TLS memakai CA lokal saja |
| D-09 | Kapan deploy produksi pertama (Phase 0 diterima tanpa deploy, D-16) | Sebelum launch publik | Menentukan apakah TEST-OPS dijalankan di VPS di Phase 0 |
| D-17 | Topik (kategori) awal NALARA Media | P01-004 (seed migrasi) | Usulan: Ekonomi, Teknologi, Kebijakan ([Phase 1 BASELINE](../phase-1/BASELINE.md) KP1-10) |
| D-18 | Go-live terbatas setelah Phase 1, atau tetap internal? | Exit Phase 1 | Bila D-20 disetujui, terjawab oleh PRD v4: soft launch = exit Phase 1 (P1-10), butuh D-04, D-08, D-09 |
| D-19 | Setujui rencana Phase 1 (revisi 2) dan ADR-011..019 | Tiket pertama Phase 1 (P1-01) | [BASELINE](../phase-1/BASELINE.md) · [ADR-PROPOSALS](../phase-1/ADR-PROPOSALS.md) |
| D-20 | PRD v4 ringkas jadi acuan utama mulai Phase 1, dengan pengecualian tetap memakai API Fastify + skema Phase 0 (ADR-018)? | P1-01 | [PRD v4](../prd/NALARA_PRD_v4_ringkas.md), [BASELINE rev 2](../phase-1/BASELINE.md) KP1-22/23 |
| D-21 | Validasi pembaca (PRD v4 §2) jalan paralel; P1-01..P1-09 dikerjakan sekarang, soft launch menunggu hasil validasi? | P1-01 | KP1-21 |
