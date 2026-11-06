// Kartu NALARA: the deck is built only from what the published article already says.
import { describe, expect, it } from 'vitest';
import { buildDeck, clip, joinNames, MAX_SLIDES } from '../../src/modules/cards/deck.ts';
import type { PublicArticle } from '../../src/modules/public/articles.ts';

const t = (text: string) => [{ type: 'text' as const, text }];
const CITE = '01900000-0000-7000-8000-00000000000a';

function article(overrides: Partial<PublicArticle> = {}): PublicArticle {
  return {
    slug: 'harga-beras',
    title: 'Kenapa harga beras naik (TEST)',
    dek: 'Ringkasan TEST.',
    articleType: 'explainer',
    category: { slug: 'ekonomi', name: 'Ekonomi' },
    publishedAt: new Date('2026-11-06T03:00:00Z'),
    firstPublishedAt: new Date('2026-11-06T03:00:00Z'),
    verification: 'TERVERIFIKASI',
    roots: ['Badan Pusat Statistik'],
    citations: [
      {
        id: CITE,
        url: 'https://www.bps.go.id/id/pressrelease/x.html',
        publisher: 'Badan Pusat Statistik',
        title: 'Rilis TEST',
        accessedAt: '2026-11-06',
        primary: true,
      },
    ],
    body: [
      {
        type: 'stat',
        value: '2,8',
        unit: 'persen',
        period: 'Oktober 2026',
        label: 'Inflasi TEST',
        citationId: CITE,
      },
      { type: 'heading', level: 2, content: t('Konteks') },
      { type: 'paragraph', content: t('Isi TEST pertama. Kalimat kedua.') },
    ],
    methodNote: null,
    sourceException: null,
    corrections: [],
    media: {},
    charts: {},
    ...overrides,
  };
}

describe('Kartu NALARA deck', () => {
  it('builds cover, stat, point and evidence slides from the article', () => {
    const deck = buildDeck(article(), { origin: 'https://nalara.example' });
    expect(deck.slides.map((slide) => slide.kind)).toEqual(['cover', 'stat', 'point', 'evidence']);
    const stat = deck.slides[1];
    expect(stat?.kind === 'stat' && stat.source).toBe('Bukti: Badan Pusat Statistik');
    expect(deck.context.evidenceLine).toBe('Bukti: Badan Pusat Statistik');
    const evidence = deck.slides.at(-1);
    expect(evidence?.kind === 'evidence' && evidence.link).toBe(
      'nalara.example/artikel/harga-beras',
    );
  });

  it('writes a caption with every source link and the article link', () => {
    const { caption } = buildDeck(article(), { origin: 'https://nalara.example' });
    expect(caption).toContain('Kenapa harga beras naik (TEST)');
    expect(caption).toContain('• Inflasi TEST: 2,8 persen (Oktober 2026)');
    expect(caption).toContain(
      '1. Badan Pusat Statistik: https://www.bps.go.id/id/pressrelease/x.html',
    );
    expect(caption).toContain('Baca lengkap: https://nalara.example/artikel/harga-beras');
    expect(caption).toContain('#NALARA #Ekonomi');
  });

  it('never stamps a piece that is not verified', () => {
    const deck = buildDeck(article({ verification: 'BELUM_TERVERIFIKASI', roots: [] }), {
      origin: null,
    });
    const cover = deck.slides[0];
    expect(cover?.kind === 'cover' && cover.verification).toBe('');
    expect(deck.context.evidenceLine).toBeNull();
  });

  it('keeps the cover and the evidence and cuts the middle to fit', () => {
    const body = Array.from({ length: 6 }, (_, index) => [
      { type: 'heading' as const, level: 2 as const, content: t(`Bagian ${String(index)}`) },
      { type: 'paragraph' as const, content: t('Isi.') },
    ]).flat();
    const deck = buildDeck(article({ body: [...article().body, ...body] }), { origin: null });
    expect(deck.slides.length).toBeLessThanOrEqual(MAX_SLIDES);
    expect(deck.slides[0]?.kind).toBe('cover');
    expect(deck.slides.at(-1)?.kind).toBe('evidence');
  });

  it('uses only licensed article images for the cover, with their credit', () => {
    const mediaId = '01900000-0000-7000-8000-0000000000bb';
    const deck = buildDeck(
      article({
        body: [{ type: 'image', mediaId }, ...article().body],
        media: {
          [mediaId]: {
            altText: 'TEST',
            caption: null,
            attribution: 'Dok. TEST / CC BY 4.0',
            width: 10,
            height: 10,
            aiGenerated: false,
          },
        },
      }),
      { origin: null },
    );
    const cover = deck.slides[0];
    expect(cover?.kind === 'cover' && cover.imageId).toBe(mediaId);
    expect(cover?.kind === 'cover' && cover.credit).toBe('Foto: Dok. TEST / CC BY 4.0');
  });

  it('clips text at a sentence or a word, and joins names in Indonesian', () => {
    expect(clip('Satu dua. Tiga empat lima enam.', 15)).toBe('Satu dua.');
    expect(clip('Satu dua tiga empat', 12)).toBe('Satu dua…');
    expect(joinNames(['BPS', 'BI', 'OJK'])).toBe('BPS, BI, dan OJK');
  });
});
