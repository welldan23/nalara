// P4-03 chart blocks: the :::grafik syntax, the block schema and the publish gate.
import { describe, expect, it } from 'vitest';
import { bodySchema } from '../../src/modules/articles/content.ts';
import { publishGate } from '../../src/modules/articles/gate.ts';
import { parseMarkdown } from '../../src/modules/articles/markdown.ts';

const grafik = (...lines: string[]) => [':::grafik', ...lines, ':::'].join('\n');

describe(':::grafik', () => {
  it('becomes a chart block pinned to dataset@version', () => {
    const { blocks, issues } = parseMarkdown(
      grafik('data: Inflasi-Bulanan@2', 'jenis: garis', 'judul: Inflasi tahunan, 2025–2026'),
    );
    expect(issues).toEqual([]);
    expect(blocks).toEqual([
      {
        type: 'chart',
        dataset: 'inflasi-bulanan',
        version: 2,
        kind: 'line',
        title: 'Inflasi tahunan, 2025–2026',
      },
    ]);
    expect(bodySchema.safeParse(blocks).success).toBe(true);
    expect(parseMarkdown(grafik('data: kurs@1', 'jenis: Batang', 'judul: Kurs')).blocks).toEqual([
      { type: 'chart', dataset: 'kurs', version: 1, kind: 'bar', title: 'Kurs' },
    ]);
  });

  it('refuses incomplete, malformed and unsafe blocks with their line', () => {
    const rules = (source: string) =>
      parseMarkdown(source).issues.map((i) => `${i.rule}@${String(i.line)}`);
    expect(rules(':::grafik\ndata: kurs@1')).toEqual(['chart_unclosed@1']);
    expect(rules(grafik('data: kurs@1', 'judul: Kurs'))).toEqual(['chart_field_missing@1']);
    expect(rules(grafik('data: kurs@1', 'jenis: garis', 'judul: Ku'))).toEqual([
      'chart_field_missing@1',
    ]);
    expect(rules(grafik('data: kurs', 'jenis: garis', 'judul: Kurs'))).toEqual([
      'chart_data_invalid@1',
    ]);
    expect(rules(grafik('data: kurs@0', 'jenis: garis', 'judul: Kurs'))).toEqual([
      'chart_data_invalid@1',
    ]);
    expect(rules(grafik('data: ../etc@1', 'jenis: garis', 'judul: Kurs'))).toEqual([
      'chart_data_invalid@1',
    ]);
    expect(rules(grafik('data: kurs@1', 'jenis: pie', 'judul: Kurs'))).toEqual([
      'chart_kind_invalid@1',
    ]);
    expect(rules(grafik('data: kurs@1', 'warna: merah', 'jenis: garis', 'judul: Kurs'))).toEqual([
      'chart_field_unknown@3',
    ]);
    expect(rules(grafik('data: kurs@1', 'jenis: garis', 'judul: <script>x</script>'))).toEqual([
      'html_not_supported@4',
    ]);
  });
});

describe('publish gate', () => {
  const citations = [
    {
      id: '01900000-0000-7000-8000-000000000001',
      url: 'https://www.bps.go.id/',
      publisher: 'BPS',
      title: 'Rilis',
      accessedAt: '2026-11-01',
      claimNote: '',
      primary: true,
      verified: true,
    },
  ];
  const body = parseMarkdown(grafik('data: kurs@2', 'jenis: garis', 'judul: Kurs')).blocks;

  it('holds an article whose chart dataset version is missing or unpublished', () => {
    expect(publishGate({ body, citations }).blockers).toEqual(['chart_dataset_unpublished']);
    expect(
      publishGate({ body, citations }, { charts: new Map([['kurs@2', { published: false }]]) })
        .blockers,
    ).toEqual(['chart_dataset_unpublished']);
    expect(
      publishGate({ body, citations }, { charts: new Map([['kurs@1', { published: true }]]) })
        .blockers,
    ).toEqual(['chart_dataset_unpublished']);
    expect(
      publishGate({ body, citations }, { charts: new Map([['kurs@2', { published: true }]]) })
        .blockers,
    ).toEqual([]);
  });
});
