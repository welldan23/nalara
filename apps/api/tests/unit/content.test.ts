// P1-01 content model (ADR-011), canonical hash (ADR-012) and slug rules (ADR-016).
import { describe, expect, it } from 'vitest';
import { slugify } from '../../src/modules/articles/articles.ts';
import {
  blockSchema,
  canonicalJson,
  contentSha256,
  httpsUrl,
  revisionContentSchema,
} from '../../src/modules/articles/content.ts';
import type { RevisionContent } from '../../src/modules/articles/content.ts';

const base: RevisionContent = {
  title: 'Judul',
  dek: '',
  articleType: 'explainer',
  categoryId: '01900000-0000-7000-8000-000000000001',
  body: [{ type: 'paragraph', content: [{ type: 'text', text: 'Isi.' }] }],
  bodySource: 'Isi.',
  methodNote: null,
};

describe('content blocks (ADR-011)', () => {
  it('accepts the supported block types', () => {
    const blocks = [
      { type: 'heading', level: 2, content: [{ type: 'text', text: 'Konteks' }] },
      {
        type: 'paragraph',
        content: [
          { type: 'text', text: 'Menurut ', italic: true },
          { type: 'link', text: 'BPS', href: 'https://www.bps.go.id/id/pressrelease' },
        ],
      },
      { type: 'list', ordered: false, items: [[{ type: 'text', text: 'satu' }]] },
      {
        type: 'quote',
        content: [{ type: 'text', text: 'Kutipan.' }],
        attribution: 'Nama, jabatan',
      },
      {
        type: 'stat',
        value: '2,8',
        unit: 'persen (yoy)',
        period: 'Oktober 2026',
        label: 'Inflasi tahunan',
        citationId: '01900000-0000-7000-8000-000000000002',
      },
    ];
    for (const block of blocks) expect(blockSchema.safeParse(block).success, block.type).toBe(true);
  });

  it('rejects anything that could become markup, script or an unsafe link', () => {
    const rejected = [
      { type: 'html', html: '<b>x</b>' },
      { type: 'paragraph', content: [{ type: 'text', text: 'x' }], html: '<script>' },
      { type: 'paragraph', content: [{ type: 'link', text: 'x', href: 'javascript:alert(1)' }] },
      { type: 'paragraph', content: [{ type: 'link', text: 'x', href: 'http://example.org' }] },
      { type: 'paragraph', content: [{ type: 'link', text: 'x', href: 'data:text/html,<p>' }] },
      { type: 'heading', level: 1, content: [{ type: 'text', text: 'H1 is the title' }] },
      { type: 'paragraph', content: [] },
      { type: 'paragraph', content: [{ type: 'text', text: 'bell\u0007' }] },
    ];
    for (const block of rejected) {
      expect(blockSchema.safeParse(block).success, JSON.stringify(block)).toBe(false);
    }
  });

  it('requires value, unit, period, label and a citation for every number (PRD v4 §7)', () => {
    const stat = {
      type: 'stat',
      value: '10',
      unit: 'persen',
      period: '2026',
      label: 'Kenaikan',
      citationId: '01900000-0000-7000-8000-000000000002',
    };
    expect(blockSchema.safeParse(stat).success).toBe(true);
    for (const key of ['value', 'unit', 'period', 'label', 'citationId']) {
      const missing = Object.fromEntries(Object.entries(stat).filter(([name]) => name !== key));
      expect(blockSchema.safeParse(missing).success, key).toBe(false);
      expect(blockSchema.safeParse({ ...stat, [key]: '' }).success, `${key} empty`).toBe(false);
    }
  });

  it('accepts only https URLs without credentials (ADR-019)', () => {
    expect(httpsUrl.safeParse('https://bi.go.id/id/publikasi').success).toBe(true);
    for (const url of [
      'http://bi.go.id',
      'https://user:pass@bi.go.id',
      'ftp://bi.go.id',
      '//bi.go.id',
      'https://bi.go.id/a b',
      `https://bi.go.id/${'a'.repeat(3000)}`,
    ]) {
      expect(httpsUrl.safeParse(url).success, url).toBe(false);
    }
  });

  it('limits sizes so a save cannot exhaust memory', () => {
    const many = Array.from({ length: 501 }, () => base.body[0]);
    expect(revisionContentSchema.safeParse({ ...base, body: many }).success).toBe(false);
    expect(revisionContentSchema.safeParse({ ...base, title: 'x'.repeat(201) }).success).toBe(
      false,
    );
    expect(revisionContentSchema.safeParse({ ...base, title: '   ' }).success).toBe(false);
    expect(revisionContentSchema.safeParse({ ...base, extra: 1 }).success).toBe(false);
  });
});

describe('canonical content hash (ADR-012)', () => {
  it('is independent of key order and ignores the editor source text', () => {
    const reordered = JSON.parse(
      '{"methodNote":null,"bodySource":"different","body":[{"content":[{"text":"Isi.","type":"text"}],"type":"paragraph"}],"categoryId":"01900000-0000-7000-8000-000000000001","articleType":"explainer","dek":"","title":"Judul"}',
    ) as RevisionContent;
    expect(contentSha256(reordered).equals(contentSha256(base))).toBe(true);
  });

  it('changes whenever published content changes', () => {
    const variants: RevisionContent[] = [
      { ...base, title: 'Judul baru' },
      { ...base, dek: 'Ringkasan' },
      { ...base, articleType: 'analysis' },
      { ...base, categoryId: '01900000-0000-7000-8000-000000000009' },
      { ...base, methodNote: 'Catatan metode' },
      { ...base, body: [{ type: 'paragraph', content: [{ type: 'text', text: 'Isi!' }] }] },
    ];
    const hashes = new Set(variants.map((variant) => contentSha256(variant).toString('hex')));
    hashes.add(contentSha256(base).toString('hex'));
    expect(hashes.size).toBe(variants.length + 1);
  });

  it('serialises deterministically', () => {
    expect(canonicalJson({ b: 1, a: [{ d: 2, c: null }] })).toBe('{"a":[{"c":null,"d":2}],"b":1}');
    expect(canonicalJson({ a: undefined, b: 'ü' })).toBe('{"b":"ü"}');
  });
});

describe('slugify (ADR-016)', () => {
  it.each([
    ['Kenapa Harga Beras Naik 10%?', 'kenapa-harga-beras-naik-10'],
    ['  Ekspor & Impor  ', 'ekspor-dan-impor'],
    ['Café Ünïcode — Tes', 'cafe-unicode-tes'],
    ['AI', 'artikel-ai'],
    ['!!!', 'artikel'],
  ])('%s -> %s', (title, slug) => {
    expect(slugify(title)).toBe(slug);
  });

  it('never exceeds 120 characters or ends with a dash', () => {
    const slug = slugify(`${'kata '.repeat(60)}akhir`);
    expect(slug.length).toBeLessThanOrEqual(120);
    expect(slug.endsWith('-')).toBe(false);
  });
});
