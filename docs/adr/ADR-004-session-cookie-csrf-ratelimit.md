# ADR-004 — Session storage, cookie scope, CSRF, rate limiting

- **Status:** Accepted
- **Date:** 2026-11-03
- **Approver:** Founder (chat 2026-11-03, "approve semua")
- **Related:** BASELINE K-13, S-05, S-08 · PRD B §6.1, §6.3, DEC-006, DEC-008 · TEST-SESSION-01..10, TEST-CSRF-01..10, TEST-AUTH-07, 08

## Context

PRD meminta sesi berbasis cookie (bukan token di localStorage), rotasi, revoke, fail-closed saat DB mati, proteksi CSRF untuk semua mutasi, dan rate limit, tanpa Redis di Phase 0.

## Alternatives

- Sesi: (a) **token opaque di PostgreSQL** · (b) JWT stateless (sulit di-revoke) · (c) Redis (DEC-008 melarang tanpa kebutuhan terukur).
- CSRF: (a) SameSite saja · (b) **cek Origin/Sec-Fetch-Site + synchronizer token** · (c) double-submit cookie.
- Rate limit: (a) in-memory saja · (b) **in-memory per IP + penghitung per akun di PostgreSQL** · (c) Redis.

## Decision

- **Token sesi:** 256-bit acak dari CSPRNG. DB hanya menyimpan **SHA-256**-nya di `sessions.token_hash`. TTL absolut dan TTL idle (nilai dipilih di P0-010). Token dirotasi saat login dan saat perubahan hak. Logout = revoke server-side. Kalau DB tidak bisa dicek, request **ditolak**.
- **Cookie:** `__Host-nalara_session`, `HttpOnly`, `Secure`, `SameSite=Lax`, `Path=/`, tanpa atribut `Domain`. Dev lokal memakai `http://localhost` (secure context) atau HTTPS Caddy lokal.
- **Topologi:** same-origin. Browser hanya bicara ke satu origin, dan `/api/*` diteruskan ke API (ADR-006).
- **CSRF**, untuk semua method yang mengubah state:
  1. Hanya menerima `Content-Type: application/json`.
  2. `Origin` harus cocok dengan `APP_BASE_URL`, atau `Sec-Fetch-Site: same-origin`.
  3. Synchronizer token terikat sesi, dikirim lewat header.
  - GET tidak boleh punya efek samping.
- **`SESSION_SECRET`:** dipertahankan **hanya** sebagai kunci HMAC token CSRF (K-13). Wajib punya panjang minimal, divalidasi saat startup (P0-004), dan rotasinya terdokumentasi.
- **Rate limit:** `@fastify/rate-limit` in-memory per IP untuk endpoint publik, plus penghitung kegagalan login **per akun** dengan lockout bertahap yang disimpan di PostgreSQL agar tidak reset saat restart.

## Positive consequences

- Sesi bisa di-revoke seketika dan tidak ada token di storage browser yang bisa dibaca JavaScript.
- Proteksi CSRF berlapis dan masing-masing lapisan bisa dites terpisah.

## Negative consequences

- Setiap request terautentikasi butuh lookup DB.
- Rate limit per IP tidak berbagi state bila nanti ada lebih dari satu instance API (cukup untuk satu VPS).

## Security impact

Menutup session theft via XSS-read, CSRF, credential stuffing, dan enumeration (bersama ADR-005). Prefix `__Host-` mencegah cookie disetel dari subdomain.

## Performance / cost impact

Satu query index-lookup per request terautentikasi, dapat diabaikan di skala founder-only.

## Rollback path

Penyimpanan rate limit bisa dipindah ke Redis lewat ADR baru bila ada kebutuhan terukur. Skema sesi tidak berubah.
