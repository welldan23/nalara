// Founder-facing labels and error texts for NALARA Data (P4-02).

export const FREQUENCY_LABELS: Readonly<Record<string, string>> = {
  annual: 'Tahunan',
  quarterly: 'Triwulanan',
  monthly: 'Bulanan',
  daily: 'Harian',
  irregular: 'Tidak tetap',
};

export const DATASET_STATUS_LABELS: Readonly<Record<string, string>> = {
  draft: 'Draft',
  published: 'Terbit',
  retracted: 'Ditarik',
};

export const PERIOD_FORMAT_LABELS: Readonly<Record<string, string>> = {
  year: 'Tahun (2026)',
  quarter: 'Triwulan (2026-Q3, Triwulan III 2026)',
  month: 'Bulan (2026-10, Oktober 2026, 10/2026)',
  day: 'Tanggal (2026-10-31, 31/10/2026)',
};

const TRANSFORM_ERRORS: Readonly<Record<string, string>> = {
  spec_invalid: 'Aturan pengolahan tidak lengkap atau tidak valid.',
  empty_file: 'File kosong.',
  file_too_large: 'File lebih dari 5 MB.',
  encoding_invalid: 'File bukan teks UTF-8 (simpan ulang sebagai "CSV UTF-8").',
  header_missing: 'Baris judul kolom tidak ditemukan (cek "baris dilewati").',
  header_duplicate: 'Ada dua kolom dengan nama sama.',
  'column_missing:period': 'Kolom periode tidak ditemukan di judul kolom.',
  'column_missing:value': 'Kolom nilai tidak ditemukan di judul kolom.',
  'column_missing:series': 'Kolom seri tidak ditemukan di judul kolom.',
  'column_missing:filter': 'Kolom filter tidak ditemukan.',
  csv_column_count: 'Jumlah kolom di baris ini berbeda dengan judul kolom.',
  csv_stray_quote: 'Tanda kutip (") di tempat yang salah.',
  csv_unclosed_quote: 'Tanda kutip (") tidak ditutup.',
  cell_too_long: 'Ada sel yang terlalu panjang.',
  too_many_columns: 'Terlalu banyak kolom (maks. 200).',
  too_many_rows: 'Terlalu banyak baris (maks. 100.000).',
  too_many_series: 'Terlalu banyak seri (maks. 20).',
  too_many_observations: 'Terlalu banyak titik data (maks. 20.000).',
  period_invalid: 'Periode tidak cocok dengan format yang dipilih.',
  value_invalid: 'Nilai bukan angka (cek pemisah desimal dan ribuan).',
  series_empty: 'Nama seri kosong.',
  duplicate_period: 'Periode yang sama muncul dua kali dalam satu seri.',
  no_observations: 'Tidak ada angka yang terbaca.',
};

const FIELD_ERRORS: Readonly<Record<string, string>> = {
  'slug:duplicate': 'Slug sudah dipakai dataset lain.',
  'slug:slug_invalid': 'Slug hanya huruf kecil, angka, dan tanda hubung.',
  'sourceId:unknown': 'Pilih sumber dari Source Registry.',
  'attribution:attribution_required': 'Lisensi ini mewajibkan baris atribusi.',
  'retrievedOn:future': 'Tanggal pengambilan tidak boleh di masa depan.',
  'licenseStatus:not_publishable':
    'Lisensi belum memungkinkan terbit: pilih terbuka/atribusi, atau "perlu izin" dengan catatan izinnya.',
  'source:not_verified': 'Sumbernya belum Terverifikasi di Source Registry.',
  'dataset:unchanged': 'Tidak ada yang berubah.',
  'filename:filename_invalid': 'Nama file hanya boleh huruf, angka, spasi, titik, tanda hubung.',
};

export function describeDataField(path: string, rule: string): string {
  const line = /^file\.line\.(\d+)$/.exec(path)?.[1];
  const transform = TRANSFORM_ERRORS[rule];
  if (transform !== undefined) {
    return line === undefined ? transform : `Baris ${line}: ${transform}`;
  }
  return FIELD_ERRORS[`${path}:${rule}`] ?? `Isian "${path}" ditolak (${rule}).`;
}

const DELIMITERS: Readonly<Record<string, string>> = {
  ',': 'koma',
  ';': 'titik koma',
  '\t': 'tab',
  '|': 'garis tegak',
};
const SEPARATORS: Readonly<Record<string, string>> = {
  '.': 'titik',
  ',': 'koma',
  ' ': 'spasi',
  '': 'tidak ada',
};

const PERIOD_WORDS: Readonly<Record<string, string>> = {
  year: 'tahunan',
  quarter: 'triwulanan',
  month: 'bulanan',
  day: 'harian',
};

/** The transform rules of a version, in words a reader can follow (P4-04). */
export function describeSpec(spec: Readonly<Record<string, unknown>>): string[] {
  const text = (key: string) => (typeof spec[key] === 'string' ? spec[key] : '');
  const lines = [
    `Baca file CSV dengan pemisah kolom ${DELIMITERS[text('delimiter')] ?? text('delimiter')}, tanda desimal ${SEPARATORS[text('decimal')] ?? text('decimal')}, dan pemisah ribuan ${SEPARATORS[text('thousands')] ?? text('thousands')}.`,
  ];
  if (typeof spec['skipRows'] === 'number' && spec['skipRows'] > 0) {
    lines.push(`Lewati ${String(spec['skipRows'])} baris pertama (judul atau catatan tabel).`);
  }
  lines.push(
    `Ambil periode (${PERIOD_WORDS[text('periodFormat')] ?? text('periodFormat')}) dari kolom "${text('periodColumn')}" dan nilai dari kolom "${text('valueColumn')}".`,
  );
  if (text('seriesColumn') !== '')
    lines.push(`Pisahkan seri menurut kolom "${text('seriesColumn')}".`);
  const filters = Array.isArray(spec['filters'])
    ? (spec['filters'] as { column?: unknown; equals?: unknown }[])
    : [];
  for (const filter of filters) {
    lines.push(`Pakai hanya baris dengan "${String(filter.column)}" = "${String(filter.equals)}".`);
  }
  if (typeof spec['scale'] === 'number' && spec['scale'] !== 1) {
    lines.push(`Kalikan setiap nilai dengan ${String(spec['scale'])}.`);
  }
  const missing = Array.isArray(spec['missing']) ? (spec['missing'] as unknown[]).map(String) : [];
  if (missing.length > 0) {
    lines.push(
      `Sel berisi ${missing.map((token) => (token === '' ? '(kosong)' : `"${token}"`)).join(', ')} dianggap tidak ada angka (dilewati, bukan nol).`,
    );
  }
  return lines;
}
