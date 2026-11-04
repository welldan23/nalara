# ADR-020 — Agent AI di balik tool gateway, proposal-only, AI mati secara default

- **Status:** Accepted (delegated, D-14; ditinjau di PR P3-00)
- **Date:** 2026-11-04
- **Approver:** Founder (delegated)
- **Related:** PRD v4 §8, §11 Fase 3 · [R-02 spike](../phase-3/R-02-SPIKE.md) · [Phase 3 PLAN](../phase-3/PLAN.md) · ADR-002/ADR-018 (API Fastify terpisah)

## Context

Founder ingin NALARA dibantu beberapa agent AI, masing-masing dengan tugasnya. PRD v4 menetapkan beberapa hal:
- Hermes tidak pernah SQL/SSH/shell;
- tidak ada auto-publish;
- konten eksternal = data;
- ada tool allowlist dan approval manusia.

R-02 menemukan bahwa jalur langganan (ChatGPT/Codex lewat Hermes, opencode Go) tidak punya izin yang jelas untuk proses server otomatis. Karena itu provider AI belum bisa dipilih.

## Alternatives

1. **Hermes Agent sebagai runtime + MCP ke NALARA.** Fitur Hermes lengkap, tetapi menambah runtime Python besar ke supply chain, dan jalur auth yang menarik (langganan) justru belum lolos R-02.
2. **Agent dengan kredensial database sendiri (role `nalara_agent`)**, seperti worker. Paling sederhana, tetapi melanggar "tidak ada akses langsung agent ke DB". Prompt injection juga bisa memanfaatkan apa pun yang di-grant.
3. **Runner agent kecil sendiri, tanpa kredensial DB, yang hanya berbicara ke tool gateway di API; semua mutasi berbentuk proposal; AI mati secara default.**

## Decision

Opsi 3.

- **Gateway:** `/api/v1/agent/*` di API Fastify. Satu route per tool. Allowlist ada di kode (deny-by-default, seperti `config.permission` di OS). Payload divalidasi Zod. Setiap panggilan diaudit dengan `actor_type = 'agent'`.
- **Identitas:** token acak (256 bit) dibuat lewat CLI, ditampilkan sekali, dan disimpan sebagai hash. Dikirim sebagai `Authorization: Bearer`. Peran dikirim di header dan dicek terhadap allowlist peran. Sesi founder tidak berlaku di gateway, dan token agent tidak berlaku di `/api/v1/os/*`.
- **Mutasi:** hanya `*.propose_*` (menjadi baris `ai_action_proposals`) dan `articles.create_draft` (kuota harian, sitasi selalu belum dicek). Approve, publish, delete, dan perubahan langsung pada sumber `verified` tidak punya route agent sama sekali.
- **Konten luar:** dikirim ke agent sebagai field data berlabel (`untrusted: true`). Panjangnya dibatasi, dan tidak pernah digabung ke instruksi sistem.
- **Kill switch:** `system_settings.ai_enabled`, default `false`. Bila mati, gateway menolak semua tool kecuali `status`. Bisa diubah dari `/os/ai` dan dari Telegram (`/stop`). Perubahannya diaudit.
- **Runner:** proses `agent` (image sama). Kredensialnya hanya token gateway dan API key provider AI. Ia berbicara ke provider lewat format OpenAI-compatible dan fetch aman. Di Compose, ia berada di jaringan `agent` (hanya API) + `egress`, dan tidak bisa menjangkau Postgres.
- **Hermes** bisa dipakai nanti sebagai runner alternatif yang memanggil gateway yang sama, lewat ADR baru. Batas keamanannya tetap di gateway.

## Positive consequences

- Prompt injection paling jauh hanya menghasilkan usulan atau draft, dan keduanya menunggu founder.
- Tidak ada biaya sampai founder memilih provider (D-25).
- Agent mati tidak mempengaruhi CMS.

## Negative consequences

- Kita merawat runner sendiri (kecil, tetapi tetap kode).
- Agent hanya bisa sebaik tool yang kita sediakan; tool baru butuh PR.

## Security impact

- Batas kepercayaan baru: runner (tidak dipercaya) → gateway (dipercaya).
- Token agent yang bocor hanya bisa membuat usulan dan draft dalam kuota, dan bisa dicabut lewat CLI.
- Caddy menolak `/api/v1/agent/*` dari internet. Gateway hanya untuk jaringan internal.

## Performance / cost impact

- Satu container kecil tambahan.
- Biaya AI nol sampai D-25. Setelah itu dibatasi kuota harian di NALARA dan batas biaya di dashboard provider.

## Rollback

Matikan `ai_enabled`, hentikan service `agent`, dan cabut token. Tabel proposal tetap sebagai riwayat.
