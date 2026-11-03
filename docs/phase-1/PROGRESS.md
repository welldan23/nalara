# NALARA Phase 1 — Progress

Format per tiket mengikuti PRD v4 §13. Rencana: [BASELINE.md](BASELINE.md) · Keputusan: [DECISIONS.md](../decisions/DECISIONS.md) (D-17..D-22).

### P1-00 — Audit dan rencana Phase 1
- Commit: PR #22 (revisi 1, PRD v3), PR #23 (revisi 2, PRD v4 + referensi VORSA)
- File berubah: `docs/phase-1/{BASELINE,ADR-PROPOSALS,REFERENCE-VORSA}.md`, `docs/prd/NALARA_PRD_v4_ringkas.md`, `docs/decisions/DECISIONS.md`
- Test: docs only; repo tests 28/28, CI 6/6 → PASS
- Keputusan founder: **ACCEPTED** (D-17, D-19, D-20, D-21)

### P1-01 — Skema artikel + revisi
- Commit: lihat PR `feat/P1-01-article-schema`
- File berubah:
  - `db/migrations/0004_editorial_core.sql`, `apps/api/src/db/schema.ts`
  - `apps/api/src/modules/articles/{content,articles}.ts`
  - `apps/api/src/plugins/policy.ts`, `apps/api/src/routes/os.ts`
  - `apps/api/src/lib/errors.ts`, `apps/api/src/modules/audit/audit.ts`
  - Tes: `apps/api/tests/{integration/articles,unit/content,unit/policy}.test.ts`, `integration/db.test.ts`
  - `docs/brand/` (logo beringin, D-22), `docs/adr/README.md`
- Perilaku:
  - Tabel `categories` (seed **Ekonomi, Teknologi, Kebijakan**, D-17), `articles` (identitas + status), `article_revisions` (isi).
  - Setiap simpan = revisi baru dengan versi +1, `content_sha256` kanonik (ADR-012), dan audit `article.create` / `article.revise`.
  - Revisi **immutable di database**: `nalara_app` hanya SELECT/INSERT, ditambah trigger yang juga menghentikan migrator dan superuser (UPDATE, DELETE, TRUNCATE → 42501). Pola dari VORSA × SENTINEL.
  - FK komposit: artikel hanya bisa menunjuk revisinya sendiri (current dan approved).
  - CHECK di DB: approval harus lengkap (revisi + hash + siapa + kapan); status `approved`/`published` mustahil tanpa approval; format slug.
  - Versi optimistik + row lock: editor basi → `VERSION_CONFLICT` (409), tanpa menulis apa pun.
  - Simpan tanpa perubahan ditolak. Slug otomatis dari judul dengan akhiran `-2`, `-3` bila sudah terpakai; slug eksplisit yang terpakai → `SLUG_TAKEN`.
  - Model blok (ADR-011): paragraph, heading (2–3), list, quote, `stat` (nilai, satuan, periode, label, sitasi wajib). Link hanya `https` tanpa kredensial. Objek strict, tanpa HTML, dengan batas ukuran.
  - **Kebijakan otorisasi** (pengganti v3 P02-002): setiap route `/api/v1/os/*` wajib menyatakan `permission`, kalau tidak, API menolak start. Role tanpa izin → 403.
- Test:
  - `pnpm exec vitest run apps/api` (PostgreSQL 18.6) → PASS **217/217**, termasuk:
    - 5 tes skema konten, 3 tes hash, 6 tes slug, 3 tes kebijakan;
    - 12 tes integrasi artikel: seed, revisi, versi basi, balapan 3 editor (T-11, tepat satu menang), validasi, slug, status, jaminan DB untuk app/migrator/superuser, FK silang, invariant approval.
  - Hasil `pnpm run check`, `test:backup`, dan e2e: lihat deskripsi PR.
- Security review: PASS. Belum ada endpoint baru yang terbuka; API HTTP CMS dibuat di P1-02.
- Masalah diketahui: penyimpanan sementara hanya untuk status `draft`. Transisi lain dan edit setelah approve (yang membatalkan approval) dikerjakan di P1-03.
- Keputusan founder: PENDING

**Next:** P1-02 — Editor draft.
