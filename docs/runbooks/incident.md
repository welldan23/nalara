# Runbook — Insiden, rollback, dan pemulihan (Phase 0)

Untuk: founder (satu-satunya operator). Pegangan umum: **amankan dulu, perbaiki kemudian, catat semuanya.** Jangan pernah menempelkan secret, recovery code, atau isi `.env` ke chat, issue, atau screenshot.

Singkatan: `C="docker compose -f compose.prod.yaml --env-file /srv/nalara/.env"` (jalankan dari `/srv/nalara/app`).

## 0. Langkah pertama di setiap insiden

1. Catat waktu mulai (UTC) dan gejalanya.
2. Kalau ada kemungkinan penyusup: **tutup akses publik dulu** dengan `$C stop caddy`. API, web, dan DB tetap jalan secara privat, jadi data aman dan bisa diperiksa.
3. Ambil bukti sebelum mengubah apa pun: `$C logs --since 2h > /srv/nalara/incident-<UTC>.log` lalu `chmod 600` file itu.
4. Kerjakan bagian yang sesuai di bawah, lalu tulis catatan insiden (§8).

## 1. Dugaan akun founder dibobol

Tanda-tandanya: ada login yang tidak kamu kenal di `audit_events`, sesi aneh, atau recovery code terpakai padahal bukan kamu.

```bash
$C exec db psql -U postgres -d nalara -c \
  "SELECT created_at, action, result, request_id FROM audit_events ORDER BY created_at DESC LIMIT 50"
```

1. `$C stop caddy`.
2. Cabut **semua** sesi di database (ini yang benar-benar mengeluarkan semua orang):
   ```bash
   $C exec db psql -U postgres -d nalara -c "UPDATE sessions SET revoked_at = now() WHERE revoked_at IS NULL"
   ```
   Lalu ganti `SESSION_SECRET` di `/srv/nalara/.env` (`openssl rand -base64 48`) dan jalankan `$C up -d api`. Mengganti `SESSION_SECRET` saja **tidak** mencabut sesi, karena secret ini hanya menandatangani token CSRF.
3. Ganti password founder. Belum ada CLI khusus untuk ini (risiko R-05 di ACCEPTANCE), jadi ikuti §4 lalu login ulang dan enrol MFA baru.
4. Rotasi recovery code setelah login (`POST /api/v1/auth/mfa/recovery-codes` lewat UI).
5. Kalau ada dugaan server ikut dibobol (bukan cuma akun): anggap **semua** secret bocor. Ganti `SESSION_SECRET`, `MFA_ENCRYPTION_KEY` (lalu enrol MFA ulang), dan ketiga password DB. Pertimbangkan membangun VPS baru dari backup.
6. `$C up -d caddy`.

## 2. Secret bocor (masuk git, chat, atau log)

1. Anggap secret itu sudah dipakai orang. **Ganti dulu**, baru bersihkan jejaknya.
2. Password DB: ubah lewat `ALTER ROLE ... PASSWORD`, perbarui `.env`, lalu `$C up -d`.
3. `SESSION_SECRET`: ganti, lalu `$C up -d api`. Semua token CSRF lama langsung tidak berlaku, tapi sesi tetap hidup. Cabut sesi juga (§1 langkah 2) kalau ada dugaan cookie ikut bocor.
4. `MFA_ENCRYPTION_KEY`: ganti, lalu reset MFA (§4). Secret TOTP lama tidak bisa dibaca dengan kunci baru.
5. Kalau secret sempat masuk git: hapus dari kode lewat PR baru. Riwayat lama dianggap bocor, jadi rotasi tetap wajib. Jangan force-push `main` tanpa keputusan founder.

## 3. Layanan mati atau error

| Gejala | Cek | Tindakan |
|---|---|---|
| Situs tidak bisa dibuka | `$C ps`, `$C logs --tail 100 caddy` | Container restart sendiri (`unless-stopped`). Kalau tetap mati: `$C up -d` |
| API `503` | `$C logs --tail 100 api`, lalu `$C exec api wget -qO- http://127.0.0.1:4000/health/ready` | Biasanya DB belum siap atau migrasi belum jalan (`$C run --rm migrate`) |
| DB tidak healthy | `$C logs --tail 100 db`, `df -h` | Disk penuh → §5. Jangan hapus volume `db-data` |
| Sertifikat TLS gagal | `$C logs caddy \| grep -i acme` | Cek DNS mengarah ke VPS dan port 80/443 terbuka. Caddy mencoba ulang sendiri |
| Login selalu gagal | Lockout 15 menit setelah 5 kali salah | Tunggu 15 menit. Kalau terus terjadi, ada yang mencoba menebak password: lihat §1 |

Selama DB mati, sesi gagal tertutup (API menolak, tidak meloloskan). Jadi DB mati tidak membuka celah, hanya membuat OS tidak bisa dipakai.

## 4. Founder kehilangan authenticator **dan** semua recovery code

Phase 0 belum punya CLI break-glass yang teruji (risiko R-05). Jalur darurat ini butuh akses shell server dan **meninggalkan jejak audit**:

```bash
$C exec -T db psql -U postgres -d nalara -v ON_ERROR_STOP=1 <<'SQL'
BEGIN;
UPDATE users SET mfa_enabled = false, totp_secret_enc = NULL, totp_last_step = NULL, updated_at = now()
  WHERE role = 'founder';
DELETE FROM recovery_codes;
UPDATE sessions SET revoked_at = now() WHERE revoked_at IS NULL;
INSERT INTO audit_events (actor_type, action, result, metadata)
  VALUES ('system', 'mfa.break_glass_reset', 'success', '{"via":"server-shell"}');
COMMIT;
SQL
```

Setelah itu login dengan password akan meminta enrol MFA baru. Simpan recovery code yang baru secara offline. Kalau passwordnya juga lupa, belum ada jalur yang aman tanpa kode baru, jadi ini dicatat sebagai tiket lanjutan.

## 5. Disk hampir penuh (`check-disk.sh` memberi ALERT)

```bash
df -h && docker system df
```

1. Log container sudah dibatasi (10 MB × 3 per service). Biasanya yang memenuhi disk adalah image lama dan backup.
2. Hapus image yang tidak dipakai: `docker image prune` (aman, **tanpa** `-a --volumes`).
3. Retensi backup: `infra/scripts/prune.sh` (dry-run), lalu `--apply`.
4. **Jangan pernah** menjalankan `docker volume prune` atau `docker compose down -v` di produksi. Itu menghapus database.

## 6. Alert backup basi (`check-backup-age.sh`)

1. Jalankan backup manual: `AGE_RECIPIENTS_FILE=/srv/nalara/backup.pub infra/scripts/backup.sh`.
2. Kalau gagal, lihat pesan errornya: DB mati (§3), disk penuh (§5), atau file kunci publik hilang.
3. Uji restore minimal sebulan sekali ([backup-restore.md](backup-restore.md) §5).

## 7. Rollback deploy

1. Kode: `git checkout <tag/commit sebelumnya>`, lalu `$C build` dan `$C up -d`.
2. Migrasi hanya maju (tidak ada `down`). Kalau rilis baru membawa migrasi yang bermasalah:
   - Ambil backup **sebelum** deploy (selalu, lihat [deploy-vps.md](deploy-vps.md) §3).
   - Restore ke database atau volume **baru** ([backup-restore.md](backup-restore.md) §6). Jangan pernah restore di atas DB live.
   - Arahkan stack ke data hasil restore, jalankan kode versi lama, lalu `$C run --rm migrate` (harus melaporkan up to date).
3. Darurat: `$C stop caddy` menutup akses publik tanpa mematikan data.

## 8. Catatan insiden (wajib, 15 menit setelah pulih)

Tulis di `docs/incidents/<YYYY-MM-DD>-<ringkas>.md` (tanpa secret):

- Waktu mulai, waktu ketahuan, dan waktu pulih (UTC)
- Apa yang terjadi dan dampaknya
- Langkah yang diambil
- Secret apa saja yang dirotasi (nama saja, bukan nilainya)
- Pencegahan: tiket atau ADR lanjutan
