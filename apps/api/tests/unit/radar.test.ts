// Radar (P5-01): stories, independent sources, deterministic scores. TEST titles only.
import { describe, expect, it } from 'vitest';
import {
  BREAKING_SCORE,
  clusterItems,
  inQuietHours,
  independentSources,
  jaccard,
  keywordsWith,
  rankStories,
  scoreStory,
  tokens,
} from '../../src/modules/radar/score.ts';
import type { RadarItem } from '../../src/modules/radar/score.ts';

const NOW = new Date('2026-11-06T05:00:00Z'); // 12:00 WIB
let next = 0;
function item(title: string, org: string, type = 'media', hoursAgo = 1, summary = ''): RadarItem {
  next += 1;
  const at = new Date(NOW.getTime() - hoursAgo * 3_600_000);
  return {
    id: `00000000-0000-7000-8000-${String(next).padStart(12, '0')}`,
    title,
    summary,
    url: `https://example.invalid/${String(next)}`,
    publishedAt: at,
    firstSeenAt: at,
    source: { id: org, name: org, organization: org, type },
  };
}
const KEYWORDS = keywordsWith([]);

describe('radar tokens and similarity', () => {
  it('drops stopwords and short words, keeps Indonesian content words', () => {
    expect([...tokens('BI menahan suku bunga di level 6 persen')]).toEqual([
      'menahan',
      'suku',
      'bunga',
      'level',
      'persen',
    ]);
    expect(jaccard(tokens('Inflasi Oktober naik'), tokens('Inflasi Oktober naik'))).toBe(1);
  });
});

describe('radar clusters', () => {
  it('puts the same story from several outlets together and keeps others apart', () => {
    const a = item('BI menahan suku bunga acuan di 6 persen TEST', 'Media A');
    const b = item('BI tahan suku bunga acuan 6 persen TEST', 'Media B');
    const c = item('Gempa magnitudo 5 guncang Sulawesi TEST', 'Media C');
    const clusters = clusterItems([a, b, c]);
    expect(clusters).toHaveLength(2);
    expect(clusters.map((cluster) => cluster.length).sort()).toEqual([1, 2]);
  });

  it('counts a syndicated copy and the same organisation once', () => {
    const original = item('Pemerintah umumkan kenaikan harga BBM subsidi TEST', 'Antara');
    const copy = item('Pemerintah umumkan kenaikan harga BBM subsidi TEST', 'Portal X');
    const sameOrg = item('Harga BBM subsidi naik mulai pekan depan TEST', 'Antara');
    const other = item('Kenaikan harga BBM subsidi dibahas DPR TEST', 'Kementerian ESDM');
    expect(independentSources([original, copy, sameOrg])).toBe(1);
    expect(independentSources([original, copy, sameOrg, other])).toBe(2);
  });
});

describe('radar score', () => {
  it('is deterministic and explains its parts', () => {
    const items = [item('Inflasi Oktober 2,8 persen kata BPS TEST', 'BPS', 'statistics', 2)];
    const first = scoreStory(items, KEYWORDS, NOW);
    const second = scoreStory(items, KEYWORDS, NOW);
    expect(first).toEqual(second);
    expect(first?.parts.weight).toBe(20);
    expect(first?.keywords).toContain('inflasi');
    expect(first?.score).toBe(
      (first?.parts.recency ?? 0) +
        (first?.parts.weight ?? 0) +
        (first?.parts.keywords ?? 0) +
        (first?.parts.coverage ?? 0) -
        (first?.parts.penalty ?? 0),
    );
  });

  it('ranks an official, covered, on-topic story above a lone listicle', () => {
    const strong = [
      item(
        'BI menahan suku bunga acuan untuk menjaga rupiah TEST',
        'Bank Indonesia',
        'central_bank',
      ),
      item('BI tahan suku bunga acuan demi rupiah TEST', 'Media A'),
      item('Suku bunga acuan BI ditahan, rupiah menguat TEST', 'Media B'),
    ];
    const weak = [item('Tips cara hemat belanja akhir bulan TEST', 'Media C', 'media', 20)];
    const ranked = rankStories([...weak, ...strong], KEYWORDS, NOW);
    expect(ranked[0]?.items).toHaveLength(3);
    expect(ranked[0]?.independentSources).toBe(3);
    expect(ranked.at(-1)?.parts.penalty).toBeGreaterThan(0);
  });

  it('penalises ceremonial releases, even from official sources', () => {
    const story = scoreStory(
      [item('Menteri menghadiri pelantikan pejabat baru TEST', 'Kementerian X', 'ministry')],
      KEYWORDS,
      NOW,
    );
    expect(story?.parts.penalty).toBeGreaterThan(0);
  });

  it('drops blocked stories (promotions) entirely', () => {
    const ranked = rankStories(
      [item('Promo diskon besar akhir tahun TEST', 'Media A')],
      KEYWORDS,
      NOW,
    );
    expect(ranked).toHaveLength(0);
  });

  it('matches whole words only: AI is not found inside "pantai"', () => {
    const story = scoreStory(
      [item('Wisata pantai ramai saat libur TEST', 'Media A')],
      KEYWORDS,
      NOW,
    );
    expect(story?.keywords).not.toContain('ai');
  });

  it("adds the founder's topics to the boost list", () => {
    const story = scoreStory(
      [item('Kebijakan baterai kendaraan listrik TEST', 'Media A')],
      keywordsWith(['baterai']),
      NOW,
    );
    expect(story?.keywords).toContain('baterai');
  });

  it('marks breaking stories and knows the quiet hours (WIB)', () => {
    const big = [
      item('Gempa besar guncang Jawa, BMKG minta warga waspada banjir TEST', 'BMKG', 'ministry', 0),
      item('Gempa besar guncang Jawa, warga diminta waspada TEST', 'Media A', 'media', 0),
      item('BMKG: gempa besar di Jawa, potensi banjir TEST', 'Media B', 'media', 0),
      item('Gempa guncang Jawa malam ini TEST', 'Media C', 'media', 0),
    ];
    const story = scoreStory(big, KEYWORDS, NOW);
    expect(story?.score).toBeGreaterThanOrEqual(BREAKING_SCORE);
    expect(story?.breaking).toBe(true);
    expect(inQuietHours(new Date('2026-11-06T19:30:00Z'))).toBe(true); // 02:30 WIB
    expect(inQuietHours(new Date('2026-11-06T23:00:00Z'))).toBe(false); // 06:00 WIB
  });
});
