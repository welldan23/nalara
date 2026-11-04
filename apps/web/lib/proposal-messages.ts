// Founder-facing labels for agent proposals (P3-01). Payloads come from an AI agent: they are
// turned into short label/value text pairs here and rendered as text, never as markup or links.

export const ROLE_LABELS: Readonly<Record<string, string>> = {
  radar: 'Radar',
  penulis: 'Penulis',
  pemeriksa: 'Pemeriksa',
  periset: 'Periset',
  pemantau: 'Pemantau',
};

export const KIND_LABELS: Readonly<Record<string, string>> = {
  'sources.propose_create': 'Tambah sumber baru (sebagai kandidat)',
  'sources.propose_update': 'Ubah data sumber',
  'preferences.propose_update': 'Ubah preferensi agent',
  'inbox.propose_flag': 'Tandai item inbox layak ditulis',
  'articles.propose_note': 'Catatan pemeriksaan draft',
};

export const PROPOSAL_STATUS_LABELS: Readonly<Record<string, string>> = {
  pending: 'Menunggu',
  approved: 'Disetujui',
  rejected: 'Ditolak',
  failed: 'Gagal diterapkan',
  expired: 'Kedaluwarsa',
};

export const PROPOSAL_FAILURES: Readonly<Record<string, string>> = {
  'target:changed': 'Data tujuannya sudah berubah sejak usulan dibuat. Tidak ada yang ditimpa.',
  'target:missing': 'Data tujuannya sudah tidak ada.',
  'target:state': 'Status data tujuannya tidak mengizinkan perubahan ini.',
  'payload:invalid': 'Isi usulan tidak lolos validasi (atau tidak mengubah apa pun).',
  'source:duplicate': 'Sumber dengan URL itu sudah ada.',
  'apply:refused': 'Usulan tidak bisa diterapkan.',
};

const FIELD_LABELS: Readonly<Record<string, string>> = {
  name: 'Nama',
  organization: 'Organisasi',
  type: 'Jenis',
  officialUrl: 'URL resmi',
  licenseStatus: 'Lisensi',
  licenseNote: 'Catatan lisensi',
  attribution: 'Atribusi',
  notes: 'Catatan',
  feedUrl: 'URL feed',
  topics: 'Topik',
  topic: 'Topik',
  relevance: 'Relevansi',
};

const text = (value: unknown): string => {
  if (typeof value === 'string') return value;
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);
  if (Array.isArray(value)) return value.map(text).join(', ');
  if (value === null || value === undefined) return '—';
  return JSON.stringify(value);
};

const fields = (record: unknown): [string, string][] =>
  typeof record === 'object' && record !== null
    ? Object.entries(record).map(([key, value]) => [FIELD_LABELS[key] ?? key, text(value)])
    : [];

/** The proposal's payload as label/value pairs, in plain text. */
export function payloadLines(kind: string, payload: Readonly<Record<string, unknown>>) {
  switch (kind) {
    case 'sources.propose_create':
      return fields(payload['source']);
    case 'sources.propose_update':
      return fields(payload['changes']);
    case 'articles.propose_note':
      return Array.isArray(payload['notes'])
        ? payload['notes'].map((note: unknown, index): [string, string] => {
            const { quote, issue } = (note ?? {}) as { quote?: unknown; issue?: unknown };
            const prefix = typeof quote === 'string' && quote !== '' ? `“${quote}” — ` : '';
            return [`Catatan ${String(index + 1)}`, `${prefix}${text(issue)}`];
          })
        : [];
    default:
      return fields(payload);
  }
}
