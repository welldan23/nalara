// Indonesian labels and messages for the Source Registry (P1-05). The API returns codes only.

export const SOURCE_TYPE_LABELS: Readonly<Record<string, string>> = {
  statistics: 'Lembaga statistik',
  central_bank: 'Bank sentral',
  ministry: 'Kementerian/lembaga',
  regulator: 'Regulator',
  legislation: 'Peraturan/legislasi',
  company: 'Perusahaan',
  academic: 'Akademik/riset',
  international: 'Organisasi internasional',
  media: 'Media',
  other: 'Lainnya',
};

export const LICENSE_LABELS: Readonly<Record<string, string>> = {
  unknown: 'Belum diketahui',
  open: 'Terbuka (boleh dipakai)',
  attribution_required: 'Boleh dipakai dengan atribusi',
  permission_required: 'Perlu izin',
  restricted: 'Terbatas / tidak boleh dipakai ulang',
};

export const SOURCE_STATUS_LABELS: Readonly<Record<string, string>> = {
  candidate: 'Kandidat',
  verified: 'Terverifikasi',
  paused: 'Dijeda',
  disabled: 'Nonaktif',
};

export const SOURCE_STATUS_HELP =
  'Kandidat: baru dicatat. Terverifikasi: situs resmi dan lisensinya sudah dicek. Dijeda: sementara tidak dipakai. Nonaktif: tidak dipakai lagi (sumber tidak pernah dihapus).';

const FIELD_LABELS: Readonly<Record<string, string>> = {
  name: 'Nama',
  organization: 'Lembaga',
  type: 'Jenis',
  officialUrl: 'URL resmi',
  licenseStatus: 'Lisensi',
  licenseNote: 'Catatan lisensi',
  attribution: 'Atribusi',
  status: 'Status',
  notes: 'Catatan',
};

const RULES: Readonly<Record<string, string>> = {
  too_small: 'terlalu pendek (minimal 2 karakter).',
  too_big: 'terlalu panjang.',
  https_required: 'harus alamat https lengkap, tanpa nama pengguna atau kata sandi.',
  aggregator_url: 'pakai situs resmi penerbit, bukan pemendek link atau agregator.',
  duplicate: 'sumber dengan URL ini sudah terdaftar.',
  control_characters: 'mengandung karakter tak terlihat. Ketik ulang.',
  verified_needs_license: 'isi lisensinya dulu sebelum menandai terverifikasi.',
  attribution_required: 'tulis kalimat atribusinya (lisensi ini mewajibkan atribusi).',
  unchanged: 'belum ada yang diubah.',
};

export function describeSourceField(path: string, rule: string): string {
  if (path === 'source' && rule === 'unchanged') return 'Belum ada yang diubah.';
  const label = FIELD_LABELS[path] ?? path;
  return `${label}: ${RULES[rule] ?? `tidak valid (${rule}).`}`;
}
