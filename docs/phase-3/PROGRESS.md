# Phase 3 — Progress

Satu entri per tiket, format sama dengan Phase 2. Rencana: [PLAN.md](PLAN.md).

### P3-00 — Rencana Phase 3 + research spike R-02
- Commit: lihat PR `docs/P3-00-plan`
- File baru:
  - `docs/phase-3/{PLAN,R-02-SPIKE,PROGRESS}.md`
  - `docs/adr/ADR-020-agent-gateway.md`
- File berubah:
  - `docs/decisions/DECISIONS.md`: D-24 **PHASE 2 ACCEPTED**; D-25 (provider AI) dan D-26 (bot Telegram) OPEN
  - `docs/phase-2/ACCEPTANCE.md`: kotak keputusan dicentang
  - `docs/adr/README.md`
- Hasil R-02: jalur langganan **tidak lolos** untuk proses server otomatis.
  - Hermes + ChatGPT/Codex: tier dan pemakaian tidak terdokumentasi.
  - opencode Go: Terms of Service melarang proses yang jalan saat pengguna tidak login, dan membatasi pemakaian untuk keperluan internal sendiri.
  - Karena itu AI mati secara default, dan provider dipilih founder (D-25).
- Test: `pnpm exec vitest run tests/repo` (cek tautan docs) → PASS 28/28
- Keputusan founder: rencana didelegasikan (D-14); D-25/D-26 baru dibutuhkan saat mengaktifkan
