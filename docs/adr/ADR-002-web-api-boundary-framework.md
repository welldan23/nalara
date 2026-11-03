# ADR-002 — Web/API boundary and API framework

- **Status:** Accepted
- **Date:** 2026-11-03
- **Approver:** Founder (chat 2026-11-03, "approve semua")
- **Related:** BASELINE K-01, K-02 · PRD A §6.1, §6.3, R-07 · PRD B §0, §4, §5, DEC-001, DEC-002

## Context

PRD v1.0 menyarankan business logic di dalam Next.js dan tanpa backend kedua untuk MVP. Phase 0 v2, yang menggantikan panduan Phase 0 yang bertentangan, meminta `apps/api` terpisah sebagai otoritas sesi dan otorisasi. Selain itu, worker, Hermes, dan Telegram di fase berikutnya harus bisa mengakses API secara terbatas **tanpa** kredensial DB.

## Alternatives

1. Satu app Next.js (route handlers + server actions). Paling sederhana dioperasikan, tapi batas kepercayaannya kabur dan proses non-web nanti harus memanggil Next atau DB langsung.
2. **Next.js (UI) + Fastify API.** Validasi schema, body limit, logger pino dengan redaksi, dan hook lifecycle sudah bawaan.
3. Next.js + Express. Ekosistem besar, tapi validasi, logging, dan pembatasan harus dirakit sendiri.

## Decision

- `apps/web`: **Next.js 16 App Router + TypeScript strict.** Hanya UI. **Tidak punya kredensial DB** dan tidak memuat business logic.
- `apps/api`: **Fastify + TypeScript strict.** Satu-satunya pemilik business logic, akses DB, sesi, dan otorisasi (`requireFounder()`).
- `packages/contracts`: schema **Zod** untuk request/response, dipakai bersama web dan api.
- Jalur panggilan: browser → same-origin `/api/*` lewat reverse proxy (ADR-006). Server-side Next → API lewat DNS internal Compose.
- Middleware/proxy Next.js hanya untuk UX (redirect), bukan kontrol akses. Nama file mengikuti konvensi versi Next yang dipin (K-10, diverifikasi di P0-003/P0-011).
- Struktur folder mengikuti PRD B §4. Proses baru (worker, AI adapter, Telegram) ditambahkan lewat ADR fase masing-masing.

## Positive consequences

- Satu sumber business logic dan satu titik otorisasi yang bisa dites langsung lewat HTTP.
- Fase berikutnya bisa memberi akses API terbatas tanpa membagi kredensial DB.

## Negative consequences

- Dua proses dan dua image untuk dibangun dan dimonitor.
- Ada satu hop jaringan tambahan untuk render server-side (latensi kecil di jaringan internal).

## Security impact

Batas kepercayaan tegas: kompromi di UI tidak otomatis memberi akses DB. Semua otorisasi dites di level API (TEST-API, TEST-SESSION, TEST-WEB-02).

## Performance / cost impact

Memori tambahan untuk satu proses Node di VPS. Diterima untuk Phase 0 dan akan diukur saat P0-012.

## Rollback path

Sebelum Phase 1, handler di `apps/api` bisa dipindah ke route handlers Next.js karena kontraknya ada di `packages/contracts`. Ini butuh ADR baru yang menggantikan ADR ini.
