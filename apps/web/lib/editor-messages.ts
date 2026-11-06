// Indonesian messages for API validation rules shown in the editor (P1-02).

export const RULE_MESSAGES: Readonly<Record<string, string>> = {
  h1_not_allowed: 'Judul utama (#) diisi di kolom Judul. Pakai ## atau ### untuk subjudul.',
  html_not_supported: 'HTML tidak didukung. Tulis sebagai teks biasa.',
  image_not_supported:
    'Gambar Markdown tidak dipakai. Unggah di Media, lalu salin blok :::gambar dari sana.',
  image_unclosed: 'Blok :::gambar belum ditutup dengan :::.',
  image_field_unknown: 'Blok :::gambar hanya berisi satu baris: media: <id>.',
  image_media_invalid: 'Id media di blok :::gambar tidak valid. Salin ulang dari halaman Media.',
  image_media_unknown: 'Gambar di blok :::gambar tidak ada di pustaka media.',
  code_not_supported: 'Blok kode atau baris berindentasi tidak didukung.',
  table_not_supported: 'Tabel belum didukung.',
  link_must_be_https: 'Tautan harus https:// lengkap, tanpa username atau password.',
  link_malformed: 'Alamat tautan tidak valid.',
  quote_needs_attribution: 'Kutipan wajib ditutup baris sumber: > — Nama, jabatan',
  empty_heading: 'Subjudul kosong.',
  too_many_blocks: 'Artikel terlalu panjang (maksimal 500 blok).',
  unchanged: 'Tidak ada perubahan dibanding versi terakhir.',
  unknown: 'Topik tidak ditemukan.',
  invalid_format: 'Format slug tidak valid (huruf kecil, angka, tanda hubung).',
  stat_unclosed: 'Blok :::angka belum ditutup dengan baris :::',
  chart_unclosed: 'Blok :::grafik belum ditutup dengan baris :::',
  chart_field_unknown: 'Di blok :::grafik hanya ada data:, jenis:, dan judul:',
  chart_field_missing: 'Blok :::grafik butuh data:, jenis:, dan judul: (minimal 3 huruf)',
  chart_data_invalid: 'Tulis data: sebagai slug-dataset@versi, mis. inflasi-bulanan@2',
  chart_kind_invalid: 'jenis: harus garis atau batang',
  stat_field_missing: 'Blok angka wajib berisi nilai, satuan, periode, label, dan sumber.',
  stat_field_unknown:
    'Isian tidak dikenal di blok angka (pakai nilai, satuan, periode, label, sumber).',
  stat_source_unknown: 'Nomor sumber di blok angka tidak ada di daftar sumber.',
  unknown_citation: 'Blok angka menunjuk sumber yang tidak ada.',
  aggregator_url: 'Pakai URL penerbit aslinya, bukan agregator atau penyingkat link.',
  https_required: 'URL harus https:// lengkap, tanpa username atau password.',
  duplicate: 'Sumber ganda (URL atau id sama).',
  too_small: 'Wajib diisi.',
  invalid_format_date: 'Tanggal akses tidak valid.',
  control_characters: 'Ada karakter kontrol yang tidak diizinkan.',
};

export const WARNING_MESSAGES: Readonly<Record<string, string>> = {
  cliche: 'Frasa klise',
  title_all_caps: 'Judul ditulis kapital semua',
  title_too_long: 'Judul lebih dari 14 kata',
  title_excess_punctuation: 'Tanda baca berlebihan di judul',
  dek_missing: 'Ringkasan (dek) masih kosong',
  no_headings: 'Belum ada subjudul; artikel panjang lebih mudah dibaca dengan subjudul',
};

export const STATUS_LABELS: Readonly<Record<string, string>> = {
  draft: 'Draft',
  in_review: 'Ditinjau',
  approved: 'Disetujui',
  published: 'Terbit',
  archived: 'Diarsipkan',
};

export const TYPE_LABELS: Readonly<Record<string, string>> = {
  explainer: 'Penjelas',
  analysis: 'Analisis',
  opinion: 'Opini',
};

/** Starting skeleton from PRD v4 §7. */
export const ARTICLE_TEMPLATE = [
  '## Apa yang terjadi',
  '',
  '',
  '## Kenapa penting',
  '',
  '',
  '## Konteks',
  '',
  '',
  '## Data dan angka',
  '',
  '',
  '## Apa selanjutnya',
  '',
].join('\n');

export const VERIFICATION_LABELS: Readonly<Record<string, string>> = {
  TERVERIFIKASI: 'Terverifikasi',
  SEBAGIAN: 'Sebagian terverifikasi',
  BELUM_TERVERIFIKASI: 'Belum terverifikasi',
};

const CITATION_FIELDS: Readonly<Record<string, string>> = {
  url: 'URL',
  publisher: 'Penerbit',
  title: 'Judul',
  accessedAt: 'Tanggal akses',
  claimNote: 'Catatan klaim',
  id: 'Id',
};

export function describeField(path: string, rule: string): string {
  const citation = /^citations\.(\d+)\.(\w+)$/.exec(path);
  if (citation !== null) {
    const [, index = '0', key = ''] = citation;
    const message = RULE_MESSAGES[rule] ?? `Isian tidak valid (${rule}).`;
    return `Sumber ${String(Number(index) + 1)}, ${CITATION_FIELDS[key] ?? key}: ${message}`;
  }
  if (path === 'description') return 'Tulis apa yang dikoreksi (10–500 karakter).';
  if (path === 'bodySource') return RULE_MESSAGES[rule] ?? `Isi artikel tidak valid (${rule}).`;
  if (path === 'content' && rule === 'unchanged') {
    return 'Belum ada perubahan isi. Koreksi harus mengubah sesuatu.';
  }
  const line = /^bodySource\.line\.(\d+)$/.exec(path)?.[1];
  const message = RULE_MESSAGES[rule] ?? `Isian tidak valid (${rule}).`;
  return line === undefined ? `${path}: ${message}` : `Baris ${line}: ${message}`;
}

export const GATE_MESSAGES: Readonly<Record<string, string>> = {
  no_verified_source:
    'Belum ada sumber yang sudah dicek. Tambah dan cek sumber, atau tulis alasan pengecualian (minimal 20 karakter) saat menyetujui.',
  stat_source_unverified: 'Ada angka yang sumbernya belum dicek.',
  empty_body: 'Isi artikel masih kosong.',
  revision_changed_after_approval: 'Isi berubah setelah disetujui. Ajukan review lagi.',
  image_license_missing:
    'Ada gambar yang lisensi atau atribusinya belum diisi. Lengkapi di halaman Media.',
  chart_dataset_unpublished:
    'Ada grafik dari dataset (atau versi) yang belum terbit. Terbitkan dulu di halaman Data.',
};

export const EVENT_LABELS: Readonly<Record<string, string>> = {
  submit: 'Diajukan untuk review',
  return: 'Dikembalikan ke draft',
  approve: 'Disetujui',
  publish: 'Diterbitkan',
  archive: 'Diarsipkan',
  correct: 'Koreksi diterbitkan',
};
