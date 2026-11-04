// Indonesian labels and messages for the media library (P1-09). The API returns codes only.

export const USAGE_BASIS_LABELS: Readonly<Record<string, string>> = {
  own_work: 'Karya sendiri (foto/grafik NALARA)',
  licensed: 'Berlisensi (mis. Creative Commons, stok berbayar)',
  official_release: 'Rilis resmi lembaga (untuk pemberitaan)',
  public_domain: 'Domain publik',
  ai_generated: 'Ilustrasi dibuat dengan AI (diberi label)',
};

const FIELD_LABELS: Readonly<Record<string, string>> = {
  data: 'Berkas',
  altText: 'Teks alternatif',
  caption: 'Keterangan',
  usageBasis: 'Dasar pemakaian',
  license: 'Lisensi',
  attribution: 'Atribusi',
};

const RULES: Readonly<Record<string, string>> = {
  unsupported_type: 'hanya PNG, JPEG, atau WebP. SVG, GIF, dan berkas lain ditolak.',
  corrupt: 'berkas rusak atau bukan gambar utuh.',
  dimensions_too_large: 'terlalu besar (maksimal 6000 px per sisi).',
  too_big: 'lebih dari 5 MB setelah metadata dibuang.',
  base64_invalid: 'gagal dibaca. Pilih ulang berkasnya.',
  empty: 'kosong.',
  too_small: 'terlalu pendek.',
  too_big_text: 'terlalu panjang.',
  control_characters: 'mengandung karakter tak terlihat. Ketik ulang.',
  invalid_value: 'pilih salah satu pilihan.',
  unchanged: 'belum ada yang diubah.',
};

export function describeMediaField(path: string, rule: string): string {
  if (path === 'media' && rule === 'unchanged') return 'Belum ada yang diubah.';
  const label = FIELD_LABELS[path] ?? path;
  if (path === 'altText' && rule === 'too_small') {
    return 'Teks alternatif wajib, minimal 5 karakter: jelaskan isi gambar untuk pembaca tunanetra.';
  }
  if (rule === 'too_big' && path !== 'data') return `${label}: ${RULES['too_big_text'] ?? ''}`;
  return `${label}: ${RULES[rule] ?? `tidak valid (${rule}).`}`;
}

/** The block the founder pastes into an article to place this image. */
export const imageSnippet = (id: string) => `:::gambar\nmedia: ${id}\n:::`;

/** Same limit as the API: the original file, before metadata is stripped. */
export const MAX_UPLOAD_BYTES = 5 * 1024 * 1024;
