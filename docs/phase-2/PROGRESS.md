# Phase 2 — Progress

Satu entri per tiket, format sama dengan Phase 1. Rencana: [PLAN.md](PLAN.md).

### P2-01 — Fetch aman (anti-SSRF)
- Commit: lihat PR `feat/P2-01-safe-fetch`
- File baru: `apps/api/src/modules/fetch/{address-policy,safe-fetch}.ts`, `apps/api/tests/unit/safe-fetch.test.ts`
- Perilaku: `safeFetch(url, options)` adalah **satu-satunya** jalan worker ke internet.
  - Hanya `https:` di port 443 dan `http:` di port 80. URL berisi kredensial ditolak.
  - Semua alamat hasil DNS harus publik. Yang ditolak:
    - IPv4: loopback, privat (termasuk jaringan Docker `172.16/12`), link-local (termasuk metadata cloud `169.254.169.254`), CGNAT, multicast, reserved, dokumentasi;
    - IPv6: `::1`, `::`, IPv4-mapped/compatible, NAT64, 6to4, Teredo, ULA, link-local, multicast.
  - Bila **satu saja** alamat dalam jawaban DNS privat, seluruh fetch ditolak.
  - Koneksi memakai alamat yang sudah dicek (fungsi `lookup` di-pin), jadi DNS rebinding tidak bisa menukar alamat di antara cek dan koneksi.
  - IP literal dalam bentuk desimal, hex, atau oktal (`2130706433`, `0x7f.1`, `0177.0.0.1`) dinormalkan oleh parser URL, lalu dicek dengan aturan yang sama.
  - Redirect diikuti manual, maksimal 3. Setiap hop dicek ulang: skema, port, kredensial, dan alamat.
  - Satu batas waktu untuk seluruh fetch (default 15 detik), batas ukuran body **setelah dekompresi** (default 2 MiB, menahan bom gzip), dan allowlist content-type.
  - Header `Host`/`Connection` dari pemanggil diabaikan. User-Agent jujur: `NALARA-Ingest/1.0`.
  - Setiap penolakan berupa `FetchBlocked` dengan alasan tetap, tanpa memuat URL atau isi.
- **Ditemukan saat tes:** `BlockList` Node juga mencocokkan alamat IPv4 dengan aturan IPv6 (sebagai `::ffff:a.b.c.d`), sehingga aturan IPv4-mapped sempat menolak **semua** IPv4. Diperbaiki dengan memakai daftar terpisah untuk IPv4 dan IPv6; tes alamat publik kini ikut menjaga ini.
- Test:
  - `pnpm run check` → PASS **405/405**.
  - Termasuk 34 tes fetch aman, memakai server HTTP lokal dan DNS palsu:
    - 22 alamat terlarang ditolak, 5 alamat publik diizinkan;
    - loopback, `localhost`, `[::1]`, `0.0.0.0`, metadata, privat, dan IP desimal/hex/oktal ditolak **tanpa koneksi sama sekali**;
    - jawaban DNS campuran ditolak (rebinding), juga DNS gagal;
    - redirect ke metadata, ke nama yang menunjuk IP privat, dan ke `file:` ditolak; batas 3 hop;
    - skema, port, dan kredensial;
    - respons terlalu besar, bom gzip, dan server lambat (timeout);
    - content-type, `If-None-Match` → 304, dan `Host` yang tidak bisa diganti.
- Security review: PASS. Belum ada pemanggil; modul ini dipakai worker mulai P2-02/P2-04.
- Keputusan founder: PENDING

**Next:** P2-02 — Worker + antrean job.
