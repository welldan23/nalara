# Phase 3 — Agent AI (proposal + approval) dan Telegram

Status: **DIMULAI** 2026-11-04, setelah founder menulis **PHASE 2 ACCEPTED** (D-24). D-23 tetap berlaku: bangun sampai selesai, deploy belakangan.

Acuan:
- PRD v4 §11 (Fase 3), §8 (keamanan, AI tool allowlist), §6.3 (data);
- [R-02 spike](R-02-SPIKE.md);
- [ADR-020](../adr/ADR-020-agent-gateway.md);
- [REFERENCE-VORSA](../phase-1/REFERENCE-VORSA.md) (`AGENT_METHODS`, kill switch, log biaya).

## 1. Tujuan

Ide founder: NALARA dijalankan beberapa agent AI, masing-masing dengan tugasnya sendiri. Phase 3 membangun **pagar**-nya dulu, supaya agent bisa membantu tanpa bisa merusak:

- Agent **tidak pernah** menerbitkan, menyetujui, menghapus, atau menyentuh database secara langsung.
- Semua yang agent mau ubah menjadi **usulan** (proposal). Founder menyetujui atau menolaknya di `/os` atau di Telegram.
- Satu-satunya hal yang boleh agent buat langsung adalah **draft**, dengan kuota harian. Draft tetap harus lewat publish gate dan approval founder seperti biasa.
- Agent bisa dimatikan seketika (kill switch) dari `/os` atau Telegram. Tanpa agent, CMS tetap jalan normal.

Hasil R-02: jalur langganan (ChatGPT/Codex lewat Hermes, opencode Go) **tidak jelas boleh** dipakai proses server otomatis. Karena itu AI **mati secara default**, dan provider dipilih founder nanti (D-25). Semua tiket di bawah dibangun dan diuji dengan model palsu lokal, tanpa biaya dan tanpa akun baru.

## 2. Peran agent (versi pertama)

Setiap peran punya allowlist tool sendiri, yang merupakan subset dari allowlist PRD §8.

| Peran | Tugas | Tool |
|---|---|---|
| **Radar** | Membaca inbox baru, menandai item yang relevan dengan topik founder, beserta alasannya | `inbox.list_new`, `preferences.get`, `inbox.propose_flag` |
| **Penulis** | Dari item yang ditandai, membuat **draft** dengan template NALARA. Sitasi otomatis berstatus "belum dicek" | `inbox.list_flagged`, `articles.create_draft` (kuota) |
| **Pemeriksa** | Membaca draft yang menunggu, lalu mencatat klaim/angka yang perlu dicek ke sumber | `articles.list_pending`, `articles.propose_note` |
| **Periset** | Mengusulkan sumber resmi baru untuk dipantau (selalu `candidate`) | `sources.list`, `sources.inspect`, `sources.propose_create`, `sources.propose_update` |
| **Pemantau** | Ringkasan kesehatan sistem dan antrean untuk founder | `system.health`, `jobs.status` |

Dilarang untuk semua peran: SQL mentah, shell, SSH, HTTP ke jaringan internal, akses secret, approve, publish, menghapus, dan mengubah sumber `verified` tanpa approval.

## 3. Tiket

| # | Tiket | Isi | Tes utama |
|---|---|---|---|
| P3-01 | Proposal + approval | Tabel `ai_action_proposals` dan `approvals`. Proposal memuat jenis, payload tervalidasi Zod, target + versi target, dan alasan agent. Daftar dan detail di `/os/usulan`. Setujui/tolak (sesi founder + CSRF), diaudit. Approve **menerapkan** usulan lewat modul yang sudah ada. Versi target berubah → usulan gagal, tidak diterapkan | Payload aneh ditolak; approve dua kali ditolak; target berubah → gagal; sumber dari usulan selalu `candidate` |
| P3-02 | Tool gateway + kill switch | `/api/v1/agent/*`: kredensial agent (token acak, disimpan hash, dibuat lewat CLI), allowlist per peran, kuota harian, audit dengan `actor_type = 'agent'`. Isi eksternal dikirim ke agent dalam bentuk data berlabel. Kill switch `ai_enabled` (default **mati**) di `/os/ai`. Caddy menolak `/api/v1/agent/*` dari luar | Tool di luar allowlist → 403; token salah/dicabut → 401; kill switch → semua ditolak; sesi founder tidak bisa dipakai di gateway dan sebaliknya |
| P3-03 | Runner agent | Proses `agent` (image sama, `dist/agent.js`), **tanpa kredensial database**. Adapter AI OpenAI-compatible lewat fetch aman. Peran §2 dengan batas langkah, token, dan waktu per tugas. Log pemakaian token. Prompt sistem menegaskan konten luar = data | Model palsu yang "termakan" prompt injection tetap hanya bisa membuat proposal/draft; agent mati → CMS normal |
| P3-04 | Bot Telegram | Worker mengirim notifikasi usulan baru dengan tombol Setujui/Tolak. Token tombol sekali pakai, kedaluwarsa, terikat ke usulan + versinya, dan disimpan hash. Webhook API memeriksa secret header + allowlist user ID dan chat ID numerik, lalu memakai token secara atomik. Perintah `/stop` = kill switch | Replay, kedaluwarsa, user asing, chat asing, secret salah → ditolak; `/stop` mematikan AI |
| P3-05 | Compose + smoke | Service `agent` di jaringan `agent` (hanya bisa ke API) + `egress`. Non-root, read-only, tanpa Docker socket. Smoke: agent tidak bisa menjangkau Postgres, gateway tidak terjangkau dari luar | Postgres tidak terjangkau dari agent; `/api/v1/agent/*` dari Caddy → 404 |
| P3-06 | Penerimaan Phase 3 | `docs/phase-3/ACCEPTANCE.md` | — |

## 4. Data (ringkas; detail di migrasi tiap tiket)

- `ai_action_proposals`: jenis, payload, target + versi, peran agent, alasan, status (`pending`/`approved`/`rejected`/`expired`/`failed`)
- `approvals`: keputusan (setuju/tolak), kanal (`os`/`telegram`), founder, waktu. Immutable
- `approval_tokens` (P3-04): hash token, usulan, versi, kedaluwarsa, waktu dipakai
- `agent_credentials`: hash token, label, dicabut kapan
- `agent_usage`: token masuk/keluar per tugas dan model
- `system_settings`: `ai_enabled`, kuota
- `agent_preferences`: topik dan catatan founder untuk agent

## 5. Exit Phase 3 (PRD v4 §11)

- Prompt injection dari konten RSS tidak bisa memicu mutasi.
- Replay, token kedaluwarsa, dan user asing di callback Telegram ditolak.
- Agent mati → CMS tetap jalan normal.
- Agent tidak punya akses langsung ke DB/SSH.

Semua bisa dibuktikan lokal/CI dengan model palsu dan server Telegram palsu. Yang menunggu deploy dan keputusan founder:
- AI sungguhan (D-25);
- bot Telegram sungguhan (D-26).

## 6. Yang butuh founder (nanti, bukan untuk membangun)

- **D-25:** provider AI berbayar + batas biaya (checklist di [R-02](R-02-SPIKE.md) §4).
- **D-26:** bot Telegram dari @BotFather, plus user ID dan chat ID numerik.
- Topik dan preferensi awal agent. Default: topik D-17 (Ekonomi, Teknologi, Kebijakan).
