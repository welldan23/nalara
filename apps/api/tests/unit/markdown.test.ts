// P1-02 restricted Markdown parser (ADR-011) and style warnings.
import { describe, expect, it } from 'vitest';
import { bodySchema } from '../../src/modules/articles/content.ts';
import { parseInline, parseMarkdown } from '../../src/modules/articles/markdown.ts';
import { styleWarnings } from '../../src/modules/articles/warnings.ts';

describe('parseMarkdown', () => {
  it('turns the article template into valid blocks', () => {
    const source = [
      '## Apa yang terjadi',
      '',
      'BPS merilis **angka inflasi** terbaru',
      'pada awal bulan, lihat [rilis resmi](https://www.bps.go.id/id/pressrelease).',
      '',
      '### Kenapa penting',
      '- harga pangan',
      '- daya beli *rumah tangga*',
      '',
      '1. pertama',
      '2. kedua',
      '',
      '> Inflasi masih terkendali.',
      '> — Nama Pejabat, jabatan',
    ].join('\n');
    const { blocks, issues } = parseMarkdown(source);
    expect(issues).toEqual([]);
    expect(bodySchema.safeParse(blocks).success).toBe(true);
    expect(blocks.map((block) => block.type)).toEqual([
      'heading',
      'paragraph',
      'heading',
      'list',
      'list',
      'quote',
    ]);
    expect(blocks[1]).toEqual({
      type: 'paragraph',
      content: [
        { type: 'text', text: 'BPS merilis ' },
        { type: 'text', text: 'angka inflasi', bold: true },
        { type: 'text', text: ' terbaru pada awal bulan, lihat ' },
        { type: 'link', text: 'rilis resmi', href: 'https://www.bps.go.id/id/pressrelease' },
        { type: 'text', text: '.' },
      ],
    });
    expect(blocks[4]).toMatchObject({ type: 'list', ordered: true });
    expect(blocks[5]).toEqual({
      type: 'quote',
      content: [{ type: 'text', text: 'Inflasi masih terkendali.' }],
      attribution: 'Nama Pejabat, jabatan',
    });
  });

  it.each([
    ['# Judul', 'h1_not_allowed'],
    ['<script>alert(1)</script>', 'html_not_supported'],
    ['teks <img src=x onerror=alert(1)>', 'html_not_supported'],
    ['![foto](https://example.org/a.jpg)', 'image_not_supported'],
    ['```js', 'code_not_supported'],
    ['    indented code', 'code_not_supported'],
    ['| a | b |', 'table_not_supported'],
    ['[klik](javascript:alert(1))', 'link_must_be_https'],
    ['[klik](bukan-url)', 'link_malformed'],
    ['[klik](http://example.org)', 'link_must_be_https'],
    ['[klik](https://user:pw@example.org)', 'link_must_be_https'],
    ['> kutipan tanpa sumber', 'quote_needs_attribution'],
    ['##   ', 'empty_heading'],
  ])('refuses %j with %s', (source, rule) => {
    const { issues } = parseMarkdown(`Paragraf pembuka.\n\n${source}`);
    expect(issues).toContainEqual({ line: 3, rule });
  });

  it('keeps text that merely looks like markup as plain text', () => {
    const { blocks, issues } = parseMarkdown('Harga 5 < 10 dan file_name_ini tetap, 2 * 3 juga.');
    expect(issues).toEqual([]);
    expect(blocks[0]).toEqual({
      type: 'paragraph',
      content: [{ type: 'text', text: 'Harga 5 < 10 dan file_name_ini tetap, 2 * 3 juga.' }],
    });
  });

  it('reports every problem with its line instead of stopping at the first', () => {
    const { issues } = parseMarkdown('# satu\n\nok\n\n<b>dua</b>\n\n![x](https://a.b/c.png)');
    expect(issues).toEqual([
      { line: 1, rule: 'h1_not_allowed' },
      { line: 5, rule: 'html_not_supported' },
      { line: 7, rule: 'image_not_supported' },
    ]);
  });

  it('handles CRLF line endings and empty input', () => {
    expect(parseMarkdown('## A\r\n\r\nB').blocks).toHaveLength(2);
    expect(parseMarkdown('')).toEqual({ blocks: [], issues: [] });
  });
});

describe('parseInline', () => {
  it('leaves unclosed markers as text', () => {
    expect(parseInline('**tebal tanpa tutup')).toEqual([
      { type: 'text', text: '**tebal tanpa tutup' },
    ]);
    expect(parseInline('_miring_ dan *juga*')).toEqual([
      { type: 'text', text: 'miring', italic: true },
      { type: 'text', text: ' dan ' },
      { type: 'text', text: 'juga', italic: true },
    ]);
  });
});

describe('styleWarnings', () => {
  const body = parseMarkdown('Isi.').blocks;

  it('flags clichés, shouting titles and long titles, without blocking anything', () => {
    const warnings = styleWarnings({
      title: 'HARGA BERAS NAIK LAGI!!',
      dek: '',
      body: parseMarkdown('Di era digital ini, mari kita simak datanya. Ternyata naik.').blocks,
    });
    expect(warnings.map((warning) => warning.code).sort()).toEqual([
      'cliche',
      'cliche',
      'cliche',
      'dek_missing',
      'title_all_caps',
      'title_excess_punctuation',
    ]);
    expect(warnings.filter((w) => w.code === 'cliche').map((w) => w.detail)).toEqual([
      'di era digital ini',
      'mari kita simak',
      'ternyata',
    ]);
    expect(
      styleWarnings({ title: Array.from({ length: 15 }, () => 'kata').join(' '), dek: 'x', body }),
    ).toEqual([{ code: 'title_too_long' }]);
  });

  it('does not flag words that merely contain a cliché', () => {
    expect(styleWarnings({ title: 'Ternyatanya', dek: 'Ringkasan', body })).toEqual([]);
  });
});
