# ADR-005 — MFA method, login challenge flow, and recovery

- **Status:** Accepted
- **Date:** 2026-11-03
- **Approver:** Founder (chat 2026-11-03, "approve semua"; D-03 = TOTP)
- **Related:** BASELINE K-14, S-01, S-06 · PRD B §6.1, §8, DEC-007 · TEST-MFA-01..10, TEST-AUTH-01..09

## Context

MFA wajib sebelum deploy publik, dan sesi penuh hanya boleh terbit setelah faktor kedua lolos. PRD tidak mendefinisikan login pertama setelah bootstrap, saat founder belum punya MFA (K-14). Celah ini berisiko jadi jalan pintas tanpa MFA.

## Alternatives

1. **TOTP** (aplikasi authenticator): sederhana, offline, tanpa perangkat khusus.
2. WebAuthn/passkey: tahan phishing, tapi lebih kompleks (RP ID/origin binding) dan bergantung perangkat.
3. Keduanya sekaligus di Phase 0.

## Decision

- **Phase 0 memakai TOTP** (RFC 6238, 6 digit, periode 30 detik). WebAuthn/passkey boleh ditambah di fase berikutnya lewat ADR baru.
- **Penyimpanan secret TOTP:** dienkripsi **AES-256-GCM** dengan `MFA_ENCRYPTION_KEY` (env runtime, tidak disimpan di DB, tidak di-log). Nonce unik per enkripsi.
- **Verifikasi:** toleransi ±1 time-step. Time-step terakhir yang berhasil disimpan, dan kode dengan step ≤ itu **ditolak** (anti-replay). Percobaan MFA di-rate-limit.
- **Recovery code:** 10 kode acak kuat, disimpan sebagai hash, **sekali pakai**, ditampilkan sekali saat enrol, dan bisa dirotasi. Tidak pernah di-log.
- **Alur login (dua langkah):**
  1. `POST /auth/login` dengan password benar → **challenge** (bukan sesi). Challenge ber-TTL pendek, terikat founder, sekali pakai, disimpan sebagai hash.
  2. Bila MFA **belum** aktif → scope challenge = `enrolment`. Hanya boleh memanggil `mfa/setup` dan `mfa/verify`. Enrol sukses → sesi penuh terbit.
  3. Bila MFA **sudah** aktif → scope challenge = `mfa`. Verifikasi TOTP atau recovery code → sesi penuh terbit.
  4. Challenge dengan scope apa pun **ditolak** di `/api/v1/os/*` (tes negatif wajib).
- Pesan gagal tetap generik di semua langkah (tanpa enumerasi).

## Positive consequences

- Tidak ada jalur yang menerbitkan sesi penuh tanpa faktor kedua, termasuk pada login pertama.
- Founder cukup memakai aplikasi authenticator biasa.

## Negative consequences

- TOTP masih bisa di-phish secara real-time (berbeda dengan passkey).
- Kehilangan `MFA_ENCRYPTION_KEY` berarti semua secret TOTP tidak bisa dibaca dan founder harus enrol ulang.

## Security impact

Menutup S-01 (bypass MFA saat login pertama), replay kode (TEST-MFA-04), dan pemakaian ulang recovery code (TEST-MFA-08). Key separation: secret di DB, kunci di env.

## Performance / cost impact

Tidak ada biaya. Satu operasi dekripsi per verifikasi.

## Rollback path

Kalau kunci hilang atau bocor: jalankan prosedur reset lewat bootstrap CLI lokal (didokumentasikan di P0-009). Langkahnya: revoke semua sesi, kosongkan secret TOTP, lalu enrol ulang. Penambahan passkey tidak memerlukan rollback TOTP.
