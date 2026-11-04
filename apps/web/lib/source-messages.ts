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
  feedUrl: 'URL feed',
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
  http_url_required: 'harus alamat http(s) lengkap, tanpa nama pengguna atau kata sandi.',
  missing: 'belum diisi.',
  not_verified: 'feed hanya dicek untuk sumber berstatus Terverifikasi.',
};

export function describeSourceField(path: string, rule: string): string {
  if (path === 'source' && rule === 'unchanged') return 'Belum ada yang diubah.';
  const label = FIELD_LABELS[path] ?? path;
  return `${label}: ${RULES[rule] ?? `tidak valid (${rule}).`}`;
}

export const FEED_STATUS_LABELS: Readonly<Record<string, string>> = {
  none: 'Tanpa feed',
  unchecked: 'Belum dicek',
  ok: 'Feed sehat',
  failing: 'Feed bermasalah',
  quarantined: 'Dikarantina',
};

/** Worker error codes → what the founder can do about them. */
export const FEED_ERRORS: Readonly<Record<string, string>> = {
  'source:not_verified':
    'Sumber tidak berstatus Terverifikasi saat dicek, jadi feed tidak diambil.',
  'fetch:address': 'Alamat feed menunjuk ke jaringan internal atau privat, jadi ditolak.',
  'fetch:dns': 'Nama domain feed tidak ditemukan.',
  'fetch:timeout': 'Server feed terlalu lama menjawab.',
  'fetch:too_large': 'Feed lebih besar dari 2 MB.',
  'fetch:content_type': 'Alamat ini bukan feed RSS/Atom (mis. halaman HTML).',
  'fetch:port': 'Port tidak diizinkan: hanya 80 (http) dan 443 (https).',
  'fetch:scheme': 'Hanya http dan https yang diizinkan.',
  'fetch:redirect_limit': 'Terlalu banyak pengalihan (redirect).',
  'fetch:network': 'Koneksi ke server feed gagal.',
  'http:gone': 'Feed tidak ditemukan di server (404/410).',
  'http:forbidden': 'Server feed menolak akses (401/403).',
  'http:rate_limited': 'Server feed membatasi permintaan (429). Coba lagi nanti.',
  'http:server_error': 'Server feed sedang error (5xx).',
  'feed:not_a_feed': 'Isinya bukan RSS atau Atom.',
  'feed:encoding': 'Encoding feed tidak didukung (hanya UTF-8 atau Latin-1).',
  'feed:xml_doctype': 'Feed memakai DOCTYPE, yang ditolak demi keamanan.',
  'feed:xml_malformed': 'XML feed rusak.',
  'feed:xml_entity': 'Feed memakai entity yang tidak dikenal.',
};

export const feedErrorText = (code: string | null) =>
  code === null ? '' : (FEED_ERRORS[code] ?? `Gagal (${code}).`);
