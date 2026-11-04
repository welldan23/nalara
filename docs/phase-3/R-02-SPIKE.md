# R-02 — Research spike: Hermes, langganan AI, dan opencode

Tanggal: 2026-11-04. Sumber dibaca langsung pada tanggal itu. Ketentuan layanan bisa berubah, jadi **cek ulang sebelum mengaktifkan AI** (D-25).

Pertanyaan PRD v4 §12 R-02: *apakah Hermes mendukung OAuth Codex/ChatGPT secara resmi untuk use case ini?* Founder juga bertanya soal **opencode Go** (langganan flat untuk banyak model).

Use case NALARA berbeda dari asisten coding biasa. Yang dibutuhkan:
- proses di server yang jalan sendiri (terjadwal), juga saat founder tidak sedang login;
- memproses konten dari luar (RSS, halaman sumber);
- hasilnya dipakai untuk media yang dibaca publik.

## 1. Temuan

| Jalur | Yang terverifikasi | Yang tidak jelas / berisiko |
|---|---|---|
| **Hermes Agent + OpenAI Codex (ChatGPT OAuth)** | Hermes punya provider "ChatGPT/Codex Subscription": login lewat *device code* lalu kredensial disimpan di `~/.hermes/auth.json` ([docs provider Hermes](https://hermes-agent.nousresearch.com/docs/integrations/providers)) | Dokumen Hermes sendiri menulis bahwa tier ChatGPT mana yang boleh dan bagaimana pemakaian dihitung **"not currently documented"**. Tidak ada pernyataan dari OpenAI bahwa token langganan ChatGPT boleh dipakai proses server otomatis untuk produk |
| **Hermes + endpoint OpenAI-compatible** | Hermes bisa memakai endpoint apa pun yang menyediakan `/v1/chat/completions` (base URL + API key) | Aman secara ketentuan selama provider-nya API berbayar biasa |
| **opencode Go** | Langganan $10/bulan (Go Plus $40). Dapat API key. Endpoint per model di bawah `https://opencode.ai/inference/go/` (format OpenAI, Anthropic, Google). Ada batas pemakaian per 5 jam, per minggu, dan per bulan ([docs Go](https://opencode.ai/docs/en/go/)) | Dokumen Go: dirancang untuk **"OpenCode and other coding agents"**, dan trafik dipantau untuk penyalahgunaan. [Terms of Service](https://opencode.ai/legal/terms-of-service) melarang antara lain *"any processes that run or are activated while you are not logged into the Services"* dan *"automatically or programmatically extracts data or Output"*, serta membatasi pemakaian untuk *"your own internal use … not on behalf of or for the benefit of any third party"*. Worker terjadwal di server untuk media publik bertabrakan dengan kalimat-kalimat itu |
| **opencode Go — privasi** | Default: endpoint yang melatih model dari data request diblok; region default Eropa & AS. Retensi sebagian besar model 0 hari, sebagian 30 hari | Beberapa model "Contributor" melatih dari prompt. Harus dimatikan bila dipakai |

## 2. Kesimpulan

- **R-02 tidak lolos untuk jalur langganan.** Baik ChatGPT/Codex lewat Hermes maupun opencode Go tidak punya izin yang jelas untuk proses server otomatis yang melayani media publik. opencode bahkan punya kalimat yang secara langsung bertentangan.
- Sesuai PRD v4 §11 Fase 3: **AI tetap opsional, dan founder memilih provider berbayar secara eksplisit** (D-25).
- Jalur yang aman: **API berbayar per pemakaian** dengan ketentuan yang mengizinkan pemakaian lewat aplikasi. Contohnya API OpenAI, Anthropic, Google, atau OpenRouter, semuanya lewat format OpenAI-compatible. Biayanya bisa ditekan dengan batas token per hari di NALARA sendiri.
- Hermes **tidak wajib**. NALARA membangun runner agent kecil sendiri. Runner ini berbicara ke API AI lewat format OpenAI-compatible, dan ke NALARA hanya lewat tool gateway. Kalau nanti founder ingin memakai Hermes sebagai runtime, Hermes cukup diarahkan ke tool gateway yang sama. Batas keamanannya tidak berubah, karena yang dijaga adalah gateway-nya.

## 3. Yang dibangun sekarang (tanpa biaya, tanpa akun baru)

Semua bagian Fase 3 bisa dibangun dan diuji **dengan AI mati dan model palsu lokal** di tes:

1. proposal → approval;
2. tool gateway dengan allowlist;
3. kill switch;
4. runner agent multi-peran;
5. bot Telegram (tes memakai server Telegram palsu).

Mengaktifkan AI sungguhan hanya butuh tiga hal: D-25 (provider + batas biaya), API key di server, dan menyalakan saklar AI di `/os`.

## 4. Cek ulang sebelum mengaktifkan (checklist founder)

- [ ] Ketentuan provider yang dipilih mengizinkan pemakaian lewat aplikasi server
- [ ] Data request **tidak** dipakai untuk melatih model (cek setting akun)
- [ ] Batas biaya bulanan di dashboard provider sudah dipasang
- [ ] API key dibuat khusus untuk NALARA (bisa dicabut sendiri)
