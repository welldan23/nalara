# ADR-006 — Reverse proxy, TLS, and same-origin routing

- **Status:** Accepted
- **Date:** 2026-11-03
- **Approver:** Founder (chat 2026-11-03, "approve semua")
- **Related:** BASELINE K-16 · PRD B §5, §6.3, §9.3, DEC-011 · TEST-OPS-01..05, TEST-API-07, 08

## Context

Hanya port 80/443 yang boleh publik. Cookie dan CSRF (ADR-004) mengandalkan same-origin. `/health/ready` disebut "internal" tanpa mekanisme yang jelas (K-16).

## Alternatives

1. **Caddy**: TLS otomatis (ACME), konfigurasi ringkas, CA internal untuk rehearsal lokal.
2. Nginx + certbot: familiar, tapi lebih banyak komponen yang harus dirawat.
3. Traefik: kuat untuk label Docker, tapi berlebihan untuk satu VPS.

## Decision

- **Caddy** sebagai reverse proxy, dengan versi image dipin.
- Routing: `/api/*` → `api` · semua path lain → `web`. Keduanya lewat jaringan internal Compose.
- `/health/live` boleh dirute (respons minimal). **`/health/ready` tidak dirute** dan hanya dipakai healthcheck Compose di jaringan internal.
- Header keamanan: HSTS (produksi saja), `X-Content-Type-Options: nosniff`, `Referrer-Policy: strict-origin-when-cross-origin`, `X-Frame-Options: DENY`/CSP `frame-ancestors 'none'`, plus CSP dasar yang diperketat bertahap.
- `X-Request-ID` diteruskan ke API. API membuat ID sendiri bila nilai dari luar tidak valid. Proxy trust di API hanya untuk alamat Caddy.
- Rehearsal TLS memakai CA internal Caddy di lokal. TLS publik **NOT RUN** sampai founder memberi VPS dan domain (D-08), dan DNS live tidak disentuh tanpa persetujuan.

## Positive consequences

- Satu origin untuk browser, sehingga cookie `__Host-` dan cek Origin sederhana.
- Sertifikat diperbarui otomatis di produksi.

## Negative consequences

- Caddy jadi titik tunggal di depan aplikasi. Kalau mati, semua akses publik mati (diterima untuk satu VPS).

## Security impact

API dan DB tidak terekspos langsung. Info kesiapan internal tidak bocor. Header keamanan diterapkan seragam.

## Performance / cost impact

Overhead proxy kecil. TLS Let's Encrypt gratis.

## Rollback path

Caddyfile bisa diganti konfigurasi Nginx yang setara tanpa mengubah kode aplikasi, karena routing dan header terdokumentasi di sini.
