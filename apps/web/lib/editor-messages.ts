// Indonesian messages for API validation rules shown in the editor (P1-02).

export const RULE_MESSAGES: Readonly<Record<string, string>> = {
  h1_not_allowed: 'Judul utama (#) diisi di kolom Judul. Pakai ## atau ### untuk subjudul.',
  html_not_supported: 'HTML tidak didukung. Tulis sebagai teks biasa.',
  image_not_supported: 'Gambar belum didukung di isi artikel (menyusul di P1-09).',
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
  const line = /^bodySource\.line\.(\d+)$/.exec(path)?.[1];
  const message = RULE_MESSAGES[rule] ?? `Isian tidak valid (${rule}).`;
  return line === undefined ? `${path}: ${message}` : `Baris ${line}: ${message}`;
}
