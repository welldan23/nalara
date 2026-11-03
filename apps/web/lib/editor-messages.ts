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

export function describeField(path: string, rule: string): string {
  const line = /^bodySource\.line\.(\d+)$/.exec(path)?.[1];
  const message = RULE_MESSAGES[rule] ?? `Isian tidak valid (${rule}).`;
  return line === undefined ? `${path}: ${message}` : `Baris ${line}: ${message}`;
}
