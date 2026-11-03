// P1-04 citations, verification label (ADR-019) and number blocks.
import { describe, expect, it } from 'vitest';
import {
  citationSchema,
  contentSha256,
  isAggregatorUrl,
  revisionContentSchema,
} from '../../src/modules/articles/content.ts';
import type { Citation, RevisionContent } from '../../src/modules/articles/content.ts';
import { parseMarkdown } from '../../src/modules/articles/markdown.ts';
import { publisherKey, verificationLevel } from '../../src/modules/articles/verification.ts';

const cite = (overrides: Partial<Citation> = {}): Citation => ({
  id: '01900000-0000-7000-8000-00000000000a',
  url: 'https://www.bps.go.id/id/pressrelease/2026/11/01/inflasi.html',
  publisher: 'Badan Pusat Statistik',
  title: 'Inflasi Oktober 2026',
  accessedAt: '2026-11-03',
  claimNote: 'Angka inflasi tahunan',
  primary: true,
  verified: true,
  ...overrides,
});

describe('citation rules (ADR-019)', () => {
  it('accepts a complete https citation', () => {
    expect(citationSchema.safeParse(cite()).success).toBe(true);
  });

  it.each([
    ['http://www.bps.go.id/x', 'not https'],
    ['https://news.google.com/rss/articles/abc', 'aggregator'],
    ['https://www.google.com/url?q=https://bps.go.id', 'redirector'],
    ['https://t.co/abc', 'shortener'],
    ['https://s.id/abc', 'shortener'],
    ['https://user:pw@bps.go.id/x', 'credentials'],
  ])('refuses %s (%s)', (url) => {
    expect(citationSchema.safeParse(cite({ url })).success).toBe(false);
  });

  it('names the aggregator rule so the editor can explain it', () => {
    const result = citationSchema.safeParse(cite({ url: 'https://news.google.com/x' }));
    expect(result.success ? [] : result.error.issues.map((issue) => issue.message)).toEqual([
      'aggregator_url',
    ]);
    expect(isAggregatorUrl('https://www.bps.go.id')).toBe(false);
  });

  it('requires publisher and a valid access date', () => {
    expect(citationSchema.safeParse(cite({ publisher: '  ' })).success).toBe(false);
    expect(citationSchema.safeParse(cite({ accessedAt: '03-11-2026' })).success).toBe(false);
    expect(citationSchema.safeParse(cite({ accessedAt: '2026-02-30' })).success).toBe(false);
  });
});

describe('verification label (computed, never declared)', () => {
  const other = (n: number, host: string, primary = false, verified = true) =>
    cite({
      id: `01900000-0000-7000-8000-00000000000${String(n)}`,
      url: `https://${host}/berita/${String(n)}`,
      publisher: host,
      primary,
      verified,
    });

  it('is TERVERIFIKASI with one verified primary source', () => {
    expect(verificationLevel([cite()])).toBe('TERVERIFIKASI');
  });

  it('is TERVERIFIKASI with two independent verified publishers', () => {
    expect(verificationLevel([other(1, 'www.kompas.com'), other(2, 'katadata.co.id')])).toBe(
      'TERVERIFIKASI',
    );
  });

  it('counts two pages of the same outlet once (SEBAGIAN)', () => {
    expect(
      verificationLevel([other(1, 'www.cnbcindonesia.com'), other(2, 'market.cnbcindonesia.com')]),
    ).toBe('SEBAGIAN');
  });

  it('ignores unverified citations entirely', () => {
    expect(verificationLevel([cite({ verified: false })])).toBe('BELUM_TERVERIFIKASI');
    expect(verificationLevel([])).toBe('BELUM_TERVERIFIKASI');
    expect(verificationLevel([other(1, 'a.com'), other(2, 'b.com', true, false)])).toBe('SEBAGIAN');
  });

  it('normalises publishers by registrable domain', () => {
    expect(publisherKey('https://webapi.bps.go.id/v1')).toBe('bps.go.id');
    expect(publisherKey('https://www.bbc.co.uk/news')).toBe('bbc.co.uk');
    expect(publisherKey('https://www.reuters.com/x')).toBe('reuters.com');
  });
});

describe('number blocks (:::angka)', () => {
  const ids = ['01900000-0000-7000-8000-00000000000a', '01900000-0000-7000-8000-00000000000b'];
  const stat = (lines: string[]) => [':::angka', ...lines, ':::'].join('\n');

  it('parses a complete number with its source', () => {
    const { blocks, issues } = parseMarkdown(
      stat([
        'nilai: 2,8',
        'satuan: persen (yoy)',
        'periode: Oktober 2026',
        'label: Inflasi tahunan',
        'sumber: 2',
      ]),
      { citationIds: ids },
    );
    expect(issues).toEqual([]);
    expect(blocks).toEqual([
      {
        type: 'stat',
        value: '2,8',
        unit: 'persen (yoy)',
        period: 'Oktober 2026',
        label: 'Inflasi tahunan',
        citationId: ids[1],
      },
    ]);
  });

  it.each([
    [['nilai: 2,8', 'satuan: persen', 'label: Inflasi', 'sumber: 1'], 'stat_field_missing'],
    [
      ['nilai: 2,8', 'satuan: persen', 'periode: 2026', 'label: Inflasi', 'sumber: 3'],
      'stat_source_unknown',
    ],
    [
      ['nilai: 2,8', 'satuan: persen', 'periode: 2026', 'label: Inflasi', 'sumber: x'],
      'stat_source_unknown',
    ],
  ])('blocks a number without everything a reader needs: %j → %s', (lines, rule) => {
    expect(parseMarkdown(stat(lines), { citationIds: ids }).issues).toEqual([{ line: 1, rule }]);
  });

  it('reports unknown fields, markup and an unclosed block', () => {
    expect(parseMarkdown(':::angka\nwarna: merah\n:::').issues).toEqual([
      { line: 2, rule: 'stat_field_unknown' },
    ]);
    expect(parseMarkdown(':::angka\nlabel: <b>x</b>\n:::').issues).toEqual([
      { line: 2, rule: 'html_not_supported' },
    ]);
    expect(parseMarkdown(':::angka\nnilai: 1').issues).toEqual([
      { line: 1, rule: 'stat_unclosed' },
    ]);
  });
});

describe('revision content with citations', () => {
  const base: RevisionContent = {
    title: 'Judul',
    dek: '',
    articleType: 'explainer',
    categoryId: '01900000-0000-7000-8000-000000000001',
    body: [],
    bodySource: '',
    methodNote: null,
    citations: [cite()],
  };

  it('rejects duplicate citation ids or URLs and stats pointing at unknown citations', () => {
    const issues = (content: unknown) => {
      const result = revisionContentSchema.safeParse(content);
      return result.success ? [] : result.error.issues.map((issue) => issue.message);
    };
    expect(issues({ ...base, citations: [cite(), cite({ url: 'https://bi.go.id/x' })] })).toEqual([
      'duplicate',
    ]);
    expect(
      issues({
        ...base,
        citations: [cite(), cite({ id: '01900000-0000-7000-8000-00000000000b' })],
      }),
    ).toEqual(['duplicate']);
    expect(
      issues({
        ...base,
        body: [
          {
            type: 'stat',
            value: '1',
            unit: 'u',
            period: 'p',
            label: 'l',
            citationId: '01900000-0000-7000-8000-0000000000ff',
          },
        ],
      }),
    ).toEqual(['unknown_citation']);
  });

  it('changes the content hash when a citation is added, edited or (un)verified', () => {
    const hashes = new Set(
      [
        base,
        { ...base, citations: [] },
        { ...base, citations: [cite({ verified: false })] },
        { ...base, citations: [cite({ claimNote: 'lain' })] },
      ].map((content) => contentSha256(content).toString('hex')),
    );
    expect(hashes.size).toBe(4);
  });
});
