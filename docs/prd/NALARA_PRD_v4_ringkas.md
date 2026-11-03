# NALARA — PRD v4 (Ringkas)

**Versi:** 4.0 | **Tanggal:** 2026-11-04 | **Status:** Review founder | **Pengganti:** Master PRD v3.0
**Tagline:** *Biar semua paham.*
**Implementasi:** Claude Code + GitHub, satu VPS Linux, Docker Compose

> **Aturan utama:** Kerjakan satu fase dalam satu waktu. Setiap fase butuh persetujuan founder sebelum lanjut. Jangan mengasumsikan API, lisensi, harga, domain, OAuth Hermes, atau hak pakai gambar sudah terverifikasi — jika belum pasti, buat *research spike* dan tanya founder.

**Perubahan dari v3:**
- Hapus duplikasi (Appendix A = salinan bagian A; 90 tiket Fase 1–9 dan 130 test case yang isinya template identik).
- Satukan urutan fase yang sebelumnya bertabrakan antara bagian A dan bagian C.
- Satukan keputusan backend: v3 bagian A bilang "jangan ada backend kedua", bagian B bikin `apps/api` terpisah. v4: **satu aplikasi Next.js** sebagai default (lihat §5.1).
- Tiket ditulis detail hanya untuk Fase 0 dan 1. Fase berikutnya cukup tujuan + exit criteria; tiketnya ditulis saat fase itu mau dimulai.
- Tambah jalur **validasi pembaca** paralel dengan Fase 0.

---

## 1. Ringkasan produk

NALARA adalah media penjelas Indonesia: artikel yang jelas, berkonteks, dan setiap klaimnya bersumber. Terdiri dari:

- **NALARA Media** — website publik.
- **NALARA OS** — dashboard privat founder untuk menulis, review, publish, dan mengelola sumber.
- **Masa depan (kondisional):** Data, Tools, Labs.

NALARA **bukan** agregator yang menyalin berita dan **bukan** chatbot yang menerbitkan otomatis. RSS hanya untuk *discovery*; fakta diverifikasi ke sumber primer; founder menyetujui setiap publikasi. AI (Hermes) hanya boleh membuat **proposal** lewat tool gateway terbatas — tidak pernah akses langsung ke DB, shell, SSH, atau secrets.

### 1.1 Masalah
Pembaca sering dapat berita tanpa konteks dan sulit melacak asal angka. Founder solo butuh alur editorial ringan dan aman.

### 1.2 Tujuan

| ID | Tujuan | Ukuran awal |
|---|---|---|
| G-01 | Pembaca paham satu isu dari satu artikel | Artikel punya ringkasan, konteks, sumber, tanggal update |
| G-02 | Informasi bisa dicek | Tiap klaim material bersumber; angka punya periode + satuan |
| G-03 | Founder bisa publish sendiri | Draft → review → publish tanpa sentuh DB manual |
| G-04 | Ada pembaca yang kembali | Lihat §2 (validasi) — target ditentukan founder |
| G-05 | Operasi aman dan murah | Backup teruji, biaya dipantau |

**Non-goals MVP:** akun pembaca, pembayaran, multi-tenant, multi-agent, auto-publish, aplikasi mobile native, crawler agresif, Kubernetes.

### 1.3 Persona
1. **Pembaca:** mahasiswa/pekerja muda yang mau paham isu ekonomi, teknologi, kebijakan dengan bahasa mudah.
2. **Founder/editor:** satu orang yang riset, nulis, publish, dan approve aksi AI.

### 1.4 Prinsip
- **Explain, don't aggregate.** Konteks > volume.
- **Source-first.** Sumber, tanggal, revisi selalu bisa dilacak.
- **Human-in-the-loop.** AI bantu, founder memutuskan.
- **Sesederhana mungkin.** Modular monolith, satu VPS, tambah komponen hanya kalau kebutuhannya sudah terukur.
- **Publik ≠ privat.** Halaman publik tidak pernah membocorkan data OS.

---

## 2. Validasi pembaca (paralel dengan Fase 0)

Risiko terbesar NALARA adalah konsistensi konten dan distribusi, bukan teknis. Jalankan ini **bersamaan** dengan Fase 0, tanpa menunggu CMS jadi:

1. Tulis 5–10 artikel penjelas pakai template artikel di §7, terbitkan di platform gratis yang sudah ada (mis. Ghost/Substack/Medium).
2. Sebar di kanal yang relevan (X, Threads, grup/komunitas kampus).
3. Catat per artikel: waktu nulis, jumlah pembaca, pembaca yang balik, feedback.
4. Founder tentukan target sebelum mulai (contoh format: "≥ N subscriber / ≥ X% pembaca kembali dalam 4 minggu").

**Keputusan setelah validasi:** lanjut Fase 1 penuh / ubah format konten / tunda. Artikel hasil validasi dipakai ulang sebagai konten awal Fase 1.

---

## 3. Roadmap

| Fase | Isi | Prasyarat |
|---|---|---|
| **0** | Fondasi: repo, auth founder + MFA, DB, CI, Compose, backup | — |
| **1** | Media publik + CMS (draft → review → publish), sumber manual, koreksi, SEO → **soft launch** | Fase 0 diterima + hasil validasi §2 |
| **2** | Ingestion RSS terverifikasi + inbox discovery | Fase 1 live dan dipakai rutin |
| **3** | Hermes AI Operator + Telegram (proposal + approval) | Research spike Hermes lolos (R-02) |
| **4** | NALARA Data v1 (katalog dataset + chart di artikel) | Ada kebutuhan nyata dari artikel |
| **5+** | Tools, Labs/API publik, monetisasi | Ada permintaan pembaca nyata + review legal |

Hardening produksi (pentest ringan, restore drill, runbook insiden) adalah **exit criteria Fase 1**, bukan fase terpisah di akhir — karena soft launch terjadi di Fase 1.

---

## 4. Information architecture

### 4.1 Route publik

| Route | Fungsi | Fase |
|---|---|---|
| `/` | Beranda editorial | 1 |
| `/artikel/[slug]` | Detail artikel + sitasi | 1 |
| `/topik/[slug]` | Artikel per topik | 1 |
| `/tentang` | Misi, metodologi, kontak | 1 |
| `/koreksi` | Daftar koreksi publik | 1 |
| `/sitemap.xml`, `/robots.txt` | SEO | 1 |
| `/rss.xml` | RSS publik | 1 (opsional) |
| `/cari` | Pencarian | 2+ |

### 4.2 Route privat (semua butuh auth server-side, kecuali login)

| Route | Fungsi | Fase |
|---|---|---|
| `/os/login` | Login founder + MFA | 0 |
| `/os` | Overview + health | 0 (placeholder) |
| `/os/newsroom`, `/os/newsroom/[id]` | Draft, editor, revisi, preview, publish | 1 |
| `/os/sources` | Source Registry | 1 (manual), 2 (RSS) |
| `/os/audit` | Audit trail | 1 |
| `/os/inbox` | Item discovery dari RSS | 2 |
| `/os/ai` | Proposal AI + approval | 3 |

---

## 5. Arsitektur

### 5.1 Stack

| Komponen | Pilihan | Catatan |
|---|---|---|
| Web + OS + API | Next.js App Router, TypeScript strict, Tailwind | **Satu aplikasi.** Business logic di service layer (`src/server/`), route handler cuma tipis. Backend terpisah (Fastify) hanya lewat ADR kalau ada kebutuhan terukur. |
| Database | PostgreSQL | Migrasi ter-versi; ORM dipilih via ADR (Drizzle direkomendasikan) |
| Worker | Proses Node terpisah | Mulai Fase 2; queue berbasis tabel Postgres dulu, Redis hanya kalau perlu |
| AI | Hermes adapter + tool gateway, proses terisolasi | Fase 3 |
| Telegram | Bot API, founder-only | Fase 3 |
| Deploy | Docker Compose, satu VPS | Tanpa Kubernetes |
| HTTPS | Caddy | TLS otomatis |
| Package manager | pnpm via Corepack | |
| CI | GitHub Actions | |

### 5.2 Arsitektur logis

```text
Pembaca ──HTTPS──> Caddy ──> Next.js (publik + /os + /api)
                                  │
                                  ▼
                             PostgreSQL (jaringan privat)
                                  ▲
                                  │
                       Worker (Fase 2) ──> Sumber terverifikasi (allowlist)

Founder ──> /os ─────────────┐
Founder ──> Telegram (Fase 3)┴─> API ──> Proposal & Approval ──> Tool Gateway
                                                                   │
                                                       Hermes adapter (terisolasi)
```

**Batas kepercayaan:** internet, frontend publik, OS privat, DB, worker, Telegram, runtime AI. Hanya aplikasi utama dan worker yang pegang kredensial DB. Hermes tidak pernah.

### 5.3 Struktur repo (target, sesuaikan dengan repo yang ada)

```text
nalara/
  src/
    app/(public)/        # halaman publik
    app/os/              # dashboard privat
    app/api/v1/          # route handler tipis
    server/              # business logic: auth, articles, sources, audit
    components/
  db/migrations/
  worker/                # mulai Fase 2
  infra/{compose.yaml, compose.prod.yaml, Caddyfile, scripts/}
  docs/{adr/, runbooks/, threat-model.md, decisions.md}
  tests/{unit, integration, e2e}
  .env.example
```

Jangan bikin folder/paket kosong demi kelihatan besar.

---

## 6. Data model

**Konvensi:** UUID PK, `created_at`/`updated_at` UTC (tampil WIB di UI), FK + index untuk query penting, secrets tidak pernah plaintext di DB.

### 6.1 Fase 0
| Tabel | Field utama |
|---|---|
| `founders` | id, email (unik), password_hash (Argon2id), mfa_enabled |
| `mfa_credentials` | id, founder_id, type, secret_encrypted, recovery_codes_hash |
| `sessions` | id, founder_id, token_hash (unik), expires_at, revoked_at, last_seen_at |
| `audit_events` | id, actor_type, actor_id, action, target_type, target_id, request_id, metadata (allowlist), occurred_at |

### 6.2 Fase 1
| Tabel | Field utama |
|---|---|
| `categories` | id, slug (unik), name, description |
| `articles` | id, slug (unik), title, excerpt, category_id, status, current_revision_id, approved_revision_id, published_at |
| `article_revisions` | id, article_id, version, title, body, change_note, created_by — unik (article_id, version) |
| `article_sources` | id, article_id, source_id?, title, url, publisher, accessed_at, claim_note, verified_at |
| `sources` | id, name, organization, type, official_url, license_status, attribution, status (`candidate`/`verified`/`paused`/`disabled`) |
| `corrections` | id, article_id, revision_id, description, visible_at |
| `media_assets` | id, storage_key, mime, attribution, license, alt_text |

**State machine artikel:** `draft → in_review → approved → published → archived`; `in_review → draft` (ditolak). Edit setelah `approved` = approval batal. Publish selalu menunjuk `approved_revision_id`.

### 6.3 Fase 2+ (ringkas, didetailkan saat fase dimulai)
- Fase 2: `source_checks`, `ingestion_runs`, `discovered_items` (unik source_id + canonical_url, fingerprint ter-index), `job_runs`.
- Fase 3: `ai_action_proposals`, `approvals` (token disimpan hash), `ai_conversations`.
- Fase 4: `datasets`, `dataset_versions`.

---

## 7. Kebijakan editorial

**Template artikel:** judul, ringkasan (dek), apa yang terjadi, kenapa penting, konteks, data/angka (dengan periode + satuan + sumber), apa selanjutnya, daftar sumber, tanggal update. Opini/analisis diberi label.

**Publish gate (diblok otomatis jika):**
- Tidak ada sumber terverifikasi (kecuali founder isi alasan eksplisit).
- Ada angka tanpa periode/satuan/sumber.
- Revisi berubah setelah approval.
- Ada gambar dengan lisensi tidak diketahui.

**Aturan:** AI boleh bantu draft, tapi tidak boleh mengarang kutipan, sumber, angka, atau gambar. Tidak menyalin artikel penuh dari RSS. Koreksi menambah revisi baru + catatan publik bila substansial.

---

## 8. Keamanan (berlaku semua fase)

| Ancaman | Kontrol |
|---|---|
| Akses admin ilegal | MFA, session aman, rate limit login, tanpa registrasi publik |
| CSRF / XSS | Cookie SameSite + HttpOnly + Secure, CSRF/origin check di mutasi, sanitasi output, CSP |
| SSRF (Fase 2) | Hanya http(s), tolak IP privat/loopback/metadata, cek ulang DNS + redirect, timeout, batas ukuran |
| Prompt injection (Fase 3) | Konten eksternal = data, bukan instruksi; tool allowlist; approval manusia |
| Approval palsu (Fase 3) | Token sekali pakai, kedaluwarsa, terikat resource + versi, dikonsumsi atomik |
| Bocor secret | `.env` di-gitignore, redaksi log, secret scanning di CI |
| Kehilangan data | Backup harian off-host terenkripsi + restore drill |
| Agent/worker dibobol | User/container terpisah, tanpa Docker socket, tanpa privileged container |

**Hard stops:** tidak ada sudo tanpa password untuk agent; Hermes tidak pernah SQL/SSH/shell; tidak ada auto-publish; tidak ada draft yang bisa diakses publik; tidak rilis dengan temuan keamanan kritis.

**AI tool allowlist (Fase 3):**
- Read-only: `sources.list`, `sources.inspect`, `jobs.status`, `system.health`, `articles.list_pending`.
- Proposal: `sources.propose_create`, `sources.propose_update`, `preferences.propose_update`.
- Write terbatas: `articles.create_draft` (draft saja, ada kuota).
- Dilarang: SQL mentah, shell, SSH, HTTP ke jaringan internal, akses secret, approve diri sendiri, publish.

---

## 9. Fase 0 — Fondasi

**Tujuan:** Clone repo → copy `.env.example` → satu perintah bootstrap → halaman publik placeholder jalan, `/os` redirect ke login, founder bisa login dengan MFA. CI hijau, backup bisa di-restore.

**Bukan Fase 0:** artikel, publish, RSS, Hermes, Telegram, search, analytics.

### 9.1 Tiket

| ID | Tiket | Acceptance criteria |
|---|---|---|
| P0-01 | Audit repo (read-only) | `docs/BASELINE.md` berisi branch, status worktree, stack terdeteksi, konflik, rencana. Tidak ada file source yang diubah. |
| P0-02 | ADR | ADR untuk: ORM/migrasi, session + CSRF, MFA (TOTP vs passkey), proxy, backup. Tiap ADR: konteks, opsi, keputusan, rollback. |
| P0-03 | Scaffold | Next.js + TS strict + pnpm + lint + format. `pnpm install --frozen-lockfile` reproducible. |
| P0-04 | Config & env | Parsing env bertipe; secret wajib yang hilang = app gagal start dengan pesan aman. `.env.example` isinya nama saja. |
| P0-05 | DB & migrasi | Migrasi tabel §6.1. DB kosong bisa migrate; dijalankan ulang aman. |
| P0-06 | Health, error, logging | `/health/live` publik minimal; `/health/ready` cek DB. Format error konsisten + `requestId`. Log redaksi cookie/password/token. |
| P0-07 | Bootstrap founder | CLI lokal bikin tepat satu founder; dijalankan kedua kali menolak; password tidak pernah di-log. |
| P0-08 | Login + MFA | Argon2id; pesan gagal generik; rate limit IP + akun; password benar → challenge MFA singkat (bukan session penuh); recovery code hash + sekali pakai. |
| P0-09 | Session & CSRF | Token session opaque, disimpan hash; logout revoke di server; session expired/revoked/replay ditolak; mutasi tanpa CSRF/origin valid ditolak. |
| P0-10 | Shell web | Landing publik + `/os/login` + `/os` placeholder dengan brand token. Anonim ke `/os` di-redirect; API `/api/v1/os/*` tetap 401 tanpa session. |
| P0-11 | Compose + Caddy | `compose.yaml` (dev) + `compose.prod.yaml`; Postgres tanpa port publik; container non-root; healthcheck. Caddyfile tervalidasi. |
| P0-12 | CI | GitHub Actions: lint, typecheck, test, build, secret scan, dependency audit. Gagal kalau kode sengaja dirusak. |
| P0-13 | Backup & restore | Script backup terenkripsi + restore ke DB terisolasi berhasil, bukti dicatat. |
| P0-14 | Exit audit | `docs/ACCEPTANCE.md` berisi PASS/FAIL/NOT RUN per gate + output perintah. |

### 9.2 API Fase 0

| Method | Path | Akses |
|---|---|---|
| GET | `/health/live` | publik |
| GET | `/health/ready` | internal |
| POST | `/api/v1/auth/login` | publik, rate-limited |
| POST | `/api/v1/auth/mfa/verify` | challenge MFA |
| POST | `/api/v1/auth/mfa/setup` | founder, re-auth |
| POST | `/api/v1/auth/logout` | founder + CSRF |
| GET | `/api/v1/auth/me` | founder |

Format error: `{"error":{"code":"UNAUTHORIZED","message":"...","requestId":"req_..."}}`. Tidak pernah bocorkan stack trace, SQL, atau apakah akun ada.

### 9.3 Test wajib Fase 0
- Anonim akses `/os` dan `/api/v1/os/*` → ditolak.
- Login salah → pesan generik; brute force → kena rate limit.
- Password benar tanpa MFA → tidak dapat session penuh.
- Challenge MFA dipakai ulang / kedaluwarsa → ditolak.
- Session setelah logout → ditolak.
- Mutasi tanpa CSRF/origin valid → ditolak.
- Log tidak berisi password, cookie, token, `DATABASE_URL`.
- Migrasi di DB kosong + dijalankan ulang → sukses.
- Port Postgres tidak terbuka dari luar.
- Backup → restore di DB baru → data founder kembali.

### 9.4 Brand token
`forest #172823`, `ivory #F5F0E6`, `ink #252A29`, `sage #A9B9AC`, `brass #C2A77A` (aksen opsional). Arah: masthead koran modern `NALARA`, serif untuk headline, sans untuk UI. Tanpa gradient, 3D, ikon AI. Kontras WCAG AA, fokus keyboard terlihat, layout aman di lebar 320px.

### 9.5 Exit Fase 0
Semua test §9.3 PASS, `ACCEPTANCE.md` lengkap, founder menulis **PHASE 0 ACCEPTED**.

---

## 10. Fase 1 — Media + CMS + soft launch

**Tujuan:** Founder bisa nulis, review, dan publish artikel bersumber dari `/os`; pembaca bisa baca di HP; situs live di domain.

### 10.1 Tiket

| ID | Tiket | Acceptance criteria |
|---|---|---|
| P1-01 | Skema artikel + revisi | Tabel §6.2. Tiap simpan = revisi baru dengan nomor versi naik. |
| P1-02 | Editor draft | Buat/edit draft, pilih kategori, preview. Edit pakai optimistic version (edit basi ditolak). Konten disanitasi; `<script>` tidak pernah tereksekusi. |
| P1-03 | State machine + publish gate | Transisi sesuai §6.2 dicek di server. Publish gate §7 memblok artikel tanpa sumber / angka tanpa periode. Edit setelah approve membatalkan approval. Tiap publish tercatat di audit (siapa, kapan, revisi mana). |
| P1-04 | Sumber per artikel | Tambah sumber (URL, penerbit, tanggal akses, catatan klaim). Tampil di halaman publik sebagai daftar referensi yang bisa diklik. |
| P1-05 | Source Registry manual | CRUD sumber dengan status + lisensi. Belum ada fetch otomatis. |
| P1-06 | Halaman publik | Beranda, `/topik/[slug]`, `/artikel/[slug]`, `/tentang`. Server-rendered, nyaman dibaca di HP. Draft → 404 untuk anonim. |
| P1-07 | Koreksi | Tambah koreksi = revisi baru + catatan publik di artikel dan di `/koreksi`. Riwayat lama tidak dihapus. |
| P1-08 | SEO | Meta title/description, canonical, Open Graph, `sitemap.xml`, `robots.txt`. Sitemap update saat publish. |
| P1-09 | Media | Upload gambar dengan batas ukuran + cek MIME; wajib isi alt text + lisensi + atribusi; lisensi kosong = tidak bisa dipakai di artikel publish. |
| P1-10 | Deploy + hardening | Deploy ke VPS (setelah founder konfirmasi domain + akses VPS). HTTPS, security header, firewall hanya 22/80/443, SSH key-only, backup harian off-host aktif, restore drill sukses, runbook insiden + rollback ditulis. |

### 10.2 Test wajib Fase 1
- Anonim baca artikel published → 200 + metadata benar.
- Anonim akses draft (via slug/API) → 404, tidak bocor isi.
- Publish tanpa approval valid → ditolak.
- Edit setelah approve → approval batal.
- Payload XSS di editor → tidak tereksekusi di halaman publik.
- Artikel dengan angka tanpa periode/sumber → publish diblok.
- Navigasi keyboard + layout 320px → bisa dipakai.

### 10.3 Exit Fase 1
Founder publish minimal 3 artikel asli bersumber end-to-end; semua test §10.2 PASS; restore drill sukses; situs live. Founder menulis **PHASE 1 ACCEPTED**.

---

## 11. Fase 2–5 (garis besar)

Tiket detail ditulis saat fase akan dimulai, berdasarkan apa yang dipelajari dari fase sebelumnya.

### Fase 2 — Ingestion RSS
**Isi:** verifikasi feed, fetch dengan ETag/Last-Modified, parsing + sanitasi, dedup (canonical URL + fingerprint), retry dengan backoff + jitter, karantina feed bermasalah, inbox discovery di `/os/inbox`.
**Exit:** 2–3 sumber terverifikasi jalan stabil ≥ 2 minggu tanpa duplikat; feed rusak dikarantina tanpa ganggu job lain; test SSRF (loopback, IP privat, metadata cloud, redirect ke privat) semua ditolak.

### Fase 3 — Hermes + Telegram
**Mulai dengan research spike R-02.** Kalau Hermes tidak mendukung autentikasi resmi untuk use case ini, AI tetap opsional dan founder memilih provider berbayar secara eksplisit.
**Isi:** adapter terisolasi, tool gateway (§8), proposal → approval, bot Telegram founder-only (allowlist user ID + chat ID numerik), kill switch.
**Exit:** prompt injection dari konten RSS tidak bisa memicu mutasi; replay/expired/user asing di callback Telegram ditolak; Hermes mati → CMS tetap jalan normal; tidak ada akses langsung agent ke DB/SSH.

### Fase 4 — NALARA Data v1
**Isi:** katalog dataset, provenance + lisensi, versi/revisi, chart aksesibel yang bisa disisipkan ke artikel.
**Exit:** minimal satu dataset publik asli tampil dengan satuan, periode, URL sumber, tanggal revisi, dan transformasi yang bisa direproduksi.

### Fase 5+ — Kondisional
Tools, Labs/API publik, newsletter, monetisasi. Dimulai hanya jika ada permintaan pembaca nyata, operasi stabil, dan review legal/lisensi selesai.

---

## 12. Pertanyaan terbuka

| ID | Pertanyaan | Default sampai terverifikasi |
|---|---|---|
| R-01 | Domain/brand NALARA tersedia dan aman? | Jangan klaim kepemilikan |
| R-02 | Hermes dukung OAuth Codex/ChatGPT secara resmi untuk use case ini? | AI opsional; tanpa billing otomatis |
| R-03 | Endpoint RSS/API mana yang benar-benar ada dan boleh dipakai? | Status `candidate` saja |
| R-04 | Lisensi data & gambar tiap sumber? | Jangan redistribusi tanpa izin |
| R-05 | Provider VPS + biaya final? | Bandingkan quote asli |
| R-06 | Rich-text editor? | Pilih via ADR di Fase 1 |
| R-07 | Target validasi pembaca (§2)? | Founder tentukan sebelum mulai |
| R-08 | Frekuensi terbit realistis? | Kualitas > kuantitas |

**Kandidat sumber (landing page, BUKAN jaminan endpoint):** data.go.id, webapi.bps.go.id, data.bmkg.go.id, bi.go.id, ojk.go.id, kemenkeu.go.id, sirup.lkpp.go.id, peraturan.bpk.go.id.

---

## 13. Aturan kerja untuk Claude Code

- Satu tiket per PR, branch `feat/PX-YY-nama-singkat`, conventional commits.
- Audit repo dulu sebelum mengubah apa pun; pertahankan pekerjaan yang ada.
- Tidak menjalankan perintah destruktif (`rm -rf`, `git reset --hard`, hapus volume, force push) tanpa izin founder.
- Tidak push, deploy, atau pakai layanan berbayar tanpa izin.
- Tidak pernah bilang test lulus kalau belum dijalankan — tulis `NOT RUN` + alasan.
- Secret tidak pernah masuk prompt, commit, log, atau `.env.example`.
- Migrasi destruktif butuh approval terpisah + restore teruji.
- Keputusan founder dicatat di `docs/decisions.md` (tanggal, pertanyaan, pilihan, alasan, rollback).

**Format laporan per tiket:**
```markdown
### PX-YY — Judul
- Commit: [SHA / NOT COMMITTED]
- File berubah: [path]
- Test: [perintah] → PASS / FAIL / NOT RUN
- Security review: PASS / FAIL / NOT RUN
- Masalah diketahui: [...]
- Keputusan founder: PENDING / ACCEPTED / BLOCKED
```

### Prompt kickoff

```text
Kamu lead engineer NALARA. Baca NALARA_PRD_v4_ringkas.md dan audit repository
sebelum mengubah apa pun. Dokumen ini adalah requirement, bukan bukti fitur sudah ada.

Kerjakan HANYA Fase 0. Mulai dengan P0-01 (audit read-only) dan P0-02 (ADR),
lalu berhenti dan minta persetujuan saya.

Setelah disetujui, kerjakan satu tiket per giliran sesuai §9.1, lapor dengan
format §13, lalu berhenti. Jangan mulai Fase 1 sebelum saya menulis
PHASE 0 ACCEPTED.

Jangan mengarang API, lisensi, harga, domain, atau dukungan OAuth. Jangan klaim
test lulus tanpa menjalankannya. Minta izin sebelum perintah destruktif,
resource berbayar, atau deploy.
```
