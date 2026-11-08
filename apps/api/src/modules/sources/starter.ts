// Starter list of sources (founder asked: "kenapa ga lu aja yg bikin list sumber"). Every feed URL
// was fetched on 2026-11-08 and returned RSS with items. They go in as CANDIDATES: nothing is
// fetched until the founder verifies each one in NALARA OS → Sumber (R-03/R-04: the founder
// confirms the licence; nothing here is legal advice).
//
// Licence notes are starting points:
// - Government releases: facts and quotes may be cited with a link and the institution named;
//   never republish whole text or photos.
// - Media: copyrighted. Only headlines and links are used, as leads to the primary source;
//   NALARA never copies their text or photos.
//
// Official sources without RSS (BPS, BI, OJK, Kemenkeu) come with P5-07 (release listing pages).
import { AppError } from '../../lib/errors.ts';
import { createSource } from './sources.ts';
import type { SourceInput } from './sources.ts';

type Starter = Pick<
  SourceInput,
  'name' | 'organization' | 'type' | 'officialUrl' | 'licenseStatus' | 'licenseNote' | 'attribution'
> & { readonly feedUrl: string; readonly notes: string };

const GOV_NOTE =
  'Rilis pemerintah: fakta dan kutipan boleh dikutip dengan menyebut lembaga + tautan. Jangan salin utuh atau ambil foto. Cek ulang syarat di situsnya sebelum verifikasi.';
const MEDIA_NOTE =
  'Media berhak cipta: hanya judul + tautan sebagai petunjuk ke sumber primer. Jangan salin teks atau foto.';

export const STARTER_SOURCES: readonly Starter[] = [
  {
    name: 'Sekretariat Kabinet: Berita',
    organization: 'Sekretariat Kabinet RI',
    type: 'ministry',
    officialUrl: 'https://setkab.go.id',
    feedUrl: 'https://setkab.go.id/feed/',
    licenseStatus: 'attribution_required',
    licenseNote: GOV_NOTE,
    attribution: 'Sekretariat Kabinet RI',
    notes:
      'Kegiatan Presiden, rapat kabinet, peraturan baru. Banyak rilis seremonial (Radar sudah memberi penalti).',
  },
  {
    name: 'Direktorat Jenderal Pajak: Berita',
    organization: 'Direktorat Jenderal Pajak, Kemenkeu',
    type: 'ministry',
    officialUrl: 'https://www.pajak.go.id',
    feedUrl: 'https://www.pajak.go.id/id/rss.xml',
    licenseStatus: 'attribution_required',
    licenseNote: GOV_NOTE,
    attribution: 'Direktorat Jenderal Pajak',
    notes: 'Kebijakan pajak, tenggat SPT, penerimaan pajak.',
  },
  {
    name: 'Lembaga Penjamin Simpanan: Siaran pers',
    organization: 'Lembaga Penjamin Simpanan',
    type: 'regulator',
    officialUrl: 'https://www.lps.go.id',
    feedUrl: 'https://www.lps.go.id/rss',
    licenseStatus: 'attribution_required',
    licenseNote: GOV_NOTE,
    attribution: 'Lembaga Penjamin Simpanan',
    notes: 'Suku bunga penjaminan, bank bermasalah, perlindungan simpanan.',
  },
  {
    name: 'ANTARA: Ekonomi',
    organization: 'ANTARA',
    type: 'media',
    officialUrl: 'https://www.antaranews.com/ekonomi',
    feedUrl: 'https://www.antaranews.com/rss/ekonomi.xml',
    licenseStatus: 'restricted',
    licenseNote: MEDIA_NOTE,
    attribution: null,
    notes: 'Kantor berita negara; sering memuat rilis lembaga lebih cepat dari situs resminya.',
  },
  {
    name: 'ANTARA: Politik',
    organization: 'ANTARA',
    type: 'media',
    officialUrl: 'https://www.antaranews.com/politik',
    feedUrl: 'https://www.antaranews.com/rss/politik.xml',
    licenseStatus: 'restricted',
    licenseNote: MEDIA_NOTE,
    attribution: null,
    notes: 'DPR, partai, kebijakan pemerintah.',
  },
  {
    name: 'CNBC Indonesia: Market',
    organization: 'CNBC Indonesia',
    type: 'media',
    officialUrl: 'https://www.cnbcindonesia.com/market',
    feedUrl: 'https://www.cnbcindonesia.com/market/rss',
    licenseStatus: 'restricted',
    licenseNote: MEDIA_NOTE,
    attribution: null,
    notes: 'Rupiah, IHSG, suku bunga, komoditas.',
  },
  {
    name: 'CNN Indonesia: Ekonomi',
    organization: 'CNN Indonesia',
    type: 'media',
    officialUrl: 'https://www.cnnindonesia.com/ekonomi',
    feedUrl: 'https://www.cnnindonesia.com/ekonomi/rss',
    licenseStatus: 'restricted',
    licenseNote: MEDIA_NOTE,
    attribution: null,
    notes: 'Harga, kebijakan ekonomi, ketenagakerjaan.',
  },
  {
    name: 'CNN Indonesia: Nasional',
    organization: 'CNN Indonesia',
    type: 'media',
    officialUrl: 'https://www.cnnindonesia.com/nasional',
    feedUrl: 'https://www.cnnindonesia.com/nasional/rss',
    licenseStatus: 'restricted',
    licenseNote: MEDIA_NOTE,
    attribution: null,
    notes: 'Politik, hukum, bencana.',
  },
  {
    name: 'Tempo: Bisnis',
    organization: 'Tempo',
    type: 'media',
    officialUrl: 'https://www.tempo.co/ekonomi',
    feedUrl: 'https://rss.tempo.co/bisnis',
    licenseStatus: 'restricted',
    licenseNote: MEDIA_NOTE,
    attribution: null,
    notes: 'Liputan investigasi dan bisnis.',
  },
  {
    name: 'Republika: Ekonomi',
    organization: 'Republika',
    type: 'media',
    officialUrl: 'https://www.republika.co.id/ekonomi',
    feedUrl: 'https://www.republika.co.id/rss/ekonomi',
    licenseStatus: 'restricted',
    licenseNote: MEDIA_NOTE,
    attribution: null,
    notes: 'Ekonomi umum dan syariah.',
  },
  {
    name: 'BBC News Indonesia',
    organization: 'BBC',
    type: 'media',
    officialUrl: 'https://www.bbc.com/indonesia',
    feedUrl: 'https://feeds.bbci.co.uk/indonesia/rss.xml',
    licenseStatus: 'restricted',
    licenseNote: MEDIA_NOTE,
    attribution: null,
    notes: 'Sudut pandang internasional tentang Indonesia.',
  },
];

/** Adds every starter source as a candidate; one that already exists is skipped, never changed. */
export async function seedStarterSources(
  db: Parameters<typeof createSource>[0],
  founderId: string,
): Promise<{ added: string[]; skipped: string[] }> {
  const added: string[] = [];
  const skipped: string[] = [];
  for (const source of STARTER_SOURCES) {
    try {
      await createSource(
        db,
        { userId: founderId, requestId: 'cli-seed-sources' },
        { ...source, status: 'candidate' },
      );
      added.push(source.name);
    } catch (error) {
      const duplicate =
        error instanceof AppError &&
        error.code === 'VALIDATION_FAILED' &&
        (error.fields ?? []).some((field) => field.rule === 'duplicate');
      if (!duplicate) throw error;
      skipped.push(source.name);
    }
  }
  return { added, skipped };
}
