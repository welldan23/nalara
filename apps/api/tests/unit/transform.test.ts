// P4-01 transform engine: strict CSV, Indonesian number and period formats, limits, and a
// deterministic result whose SHA-256 proves reproducibility (ADR-021). Data below is TEST data.
import { describe, expect, it } from 'vitest';
import {
  LIMITS,
  TransformError,
  normalisePeriod,
  parseCsv,
  parseValue,
  runTransform,
} from '../../src/modules/data/transform.ts';

const csv = (text: string) => Buffer.from(text, 'utf8');
const base = {
  format: 'csv',
  delimiter: ';',
  decimal: ',',
  thousands: '.',
  periodColumn: 'Bulan',
  periodFormat: 'month',
  valueColumn: 'Inflasi',
};
const refusal = (fn: () => unknown) => {
  try {
    fn();
    return 'accepted';
  } catch (error) {
    if (!(error instanceof TransformError)) throw error;
    return error.line === null ? error.code : `${error.code}@${String(error.line)}`;
  }
};

describe('CSV parser (RFC 4180)', () => {
  it('reads quotes, escaped quotes, embedded newlines and CRLF', () => {
    const rows = parseCsv('a,b\r\n"x, y","say ""hi"""\n"multi\nline",z', ',');
    expect(rows.map((row) => row.cells)).toEqual([
      ['a', 'b'],
      ['x, y', 'say "hi"'],
      ['multi\nline', 'z'],
    ]);
    expect(rows.map((row) => row.line)).toEqual([1, 2, 3]);
  });

  it('refuses stray and unclosed quotes and oversized cells', () => {
    expect(refusal(() => parseCsv('a,b\nx"y,z', ','))).toBe('csv_stray_quote@2');
    expect(refusal(() => parseCsv('a,b\n"x"y,z', ','))).toBe('csv_stray_quote@2');
    expect(refusal(() => parseCsv('a,b\n"open,z', ','))).toBe('csv_unclosed_quote@2');
    expect(refusal(() => parseCsv(`a\n${'x'.repeat(LIMITS.cellChars + 1)}`, ','))).toBe(
      'cell_too_long@2',
    );
    expect(
      refusal(() =>
        parseCsv(
          Array(LIMITS.columns + 1)
            .fill('c')
            .join(','),
          ',',
        ),
      ),
    ).toBe('too_many_columns@1');
  });
});

describe('periods and numbers', () => {
  it('normalises the common Indonesian and international period notations', () => {
    expect(normalisePeriod('2026', 'year')).toBe('2026');
    expect(normalisePeriod('26', 'year')).toBeNull();
    expect(normalisePeriod('2026-Q3', 'quarter')).toBe('2026-Q3');
    expect(normalisePeriod('Q1 2026', 'quarter')).toBe('2026-Q1');
    expect(normalisePeriod('Triwulan IV 2025', 'quarter')).toBe('2025-Q4');
    expect(normalisePeriod('2026-Q5', 'quarter')).toBeNull();
    expect(normalisePeriod('2026-1', 'month')).toBe('2026-01');
    expect(normalisePeriod('10/2026', 'month')).toBe('2026-10');
    expect(normalisePeriod('Oktober 2026', 'month')).toBe('2026-10');
    expect(normalisePeriod('Agt 2026', 'month')).toBe('2026-08');
    expect(normalisePeriod('Sept. 2026', 'month')).toBe('2026-09');
    expect(normalisePeriod('2026-13', 'month')).toBeNull();
    expect(normalisePeriod('Smarch 2026', 'month')).toBeNull();
    expect(normalisePeriod('2026-02-28', 'day')).toBe('2026-02-28');
    expect(normalisePeriod('31/01/2026', 'day')).toBe('2026-01-31');
    expect(normalisePeriod('2026-02-30', 'day')).toBeNull();
    expect(normalisePeriod('1700-01-01', 'day')).toBeNull();
  });

  it('parses numbers with the declared separators only', () => {
    const id = { decimal: ',', thousands: '.' } as const;
    expect(parseValue('1.234,56', id)).toBe(1234.56);
    expect(parseValue('-0,5', id)).toBe(-0.5);
    expect(parseValue('2,8', id)).toBe(2.8);
    expect(parseValue('2.8', { decimal: '.', thousands: '' })).toBe(2.8);
    expect(parseValue('1 234,5', { decimal: ',', thousands: ' ' })).toBe(1234.5);
    for (const bad of ['2,8%', '1e9', 'Infinity', '0x10', '', '1,2,3', 'NaN', '=1+1']) {
      expect(parseValue(bad, id), bad).toBeNull();
    }
  });
});

describe('runTransform', () => {
  const file = csv(
    [
      'Inflasi tahunan (persen, yoy) - TEST',
      'Sumber: data contoh, bukan data resmi',
      'Bulan;Kelompok;Inflasi',
      'Oktober 2026;Umum;2,8',
      'September 2026;Umum;2,61',
      'Oktober 2026;Makanan;3,1',
      'September 2026;Makanan;-',
      'September 2026;Lainnya;9,9',
      '',
    ].join('\r\n'),
  );
  const spec = {
    ...base,
    skipRows: 2,
    seriesColumn: 'Kelompok',
    filters: [],
  };

  it('normalises, sorts and hashes deterministically, whatever the row order', () => {
    const result = runTransform(file, spec);
    expect(result.observations).toEqual([
      { series: 'Lainnya', period: '2026-09', value: 9.9 },
      { series: 'Makanan', period: '2026-10', value: 3.1 },
      { series: 'Umum', period: '2026-09', value: 2.61 },
      { series: 'Umum', period: '2026-10', value: 2.8 },
    ]);
    expect(result).toMatchObject({
      series: ['Lainnya', 'Makanan', 'Umum'],
      periodStart: '2026-09',
      periodEnd: '2026-10',
      rowsRead: 5,
      rowsMissing: 1,
    });
    expect(result.sha256).toMatch(/^[0-9a-f]{64}$/);
    // Reproducible: same bytes + spec → same hash; shuffled rows → same observations and hash.
    expect(runTransform(file, spec).sha256).toBe(result.sha256);
    const shuffled = csv(
      [
        'x',
        'y',
        'Bulan;Kelompok;Inflasi',
        'September 2026;Lainnya;9,9',
        'September 2026;Umum;2,61',
        'September 2026;Makanan;-',
        'Oktober 2026;Makanan;3,1',
        'Oktober 2026;Umum;2,8',
      ].join('\n'),
    );
    expect(runTransform(shuffled, spec).sha256).toBe(result.sha256);
    // A different value is a different hash.
    expect(runTransform(Buffer.from(file.toString().replace('2,8', '2,9')), spec).sha256).not.toBe(
      result.sha256,
    );
  });

  it('filters and scales without float noise', () => {
    const result = runTransform(file, {
      ...spec,
      filters: [{ column: 'Kelompok', equals: 'Umum' }],
      scale: 0.1,
    });
    expect(result.observations.map((o) => o.value)).toEqual([0.261, 0.28]);
  });

  it('works for a single series and a UTF-8 BOM', () => {
    const result = runTransform(csv('﻿Tahun,Nilai\n2024,100\n2025,"1,200"\n'), {
      format: 'csv',
      delimiter: ',',
      decimal: '.',
      thousands: ',',
      periodColumn: 'Tahun',
      periodFormat: 'year',
      valueColumn: 'Nilai',
    });
    expect(result.observations).toEqual([
      { series: null, period: '2024', value: 100 },
      { series: null, period: '2025', value: 1200 },
    ]);
    expect(result.series).toEqual([]);
  });

  it('refuses bad specs, encodings and structure with stable codes and line numbers', () => {
    expect(refusal(() => runTransform(file, { ...spec, decimal: '.', thousands: '.' }))).toBe(
      'spec_invalid',
    );
    expect(refusal(() => runTransform(file, { ...spec, scale: 0 }))).toBe('spec_invalid');
    expect(refusal(() => runTransform(file, { ...spec, code: 'process.exit()' }))).toBe(
      'spec_invalid',
    );
    expect(refusal(() => runTransform(Buffer.alloc(0), spec))).toBe('empty_file');
    expect(refusal(() => runTransform(Buffer.alloc(LIMITS.rawBytes + 1, 0x61), spec))).toBe(
      'file_too_large',
    );
    expect(refusal(() => runTransform(Buffer.from([0xff, 0xfe, 0x41]), spec))).toBe(
      'encoding_invalid',
    );
    expect(refusal(() => runTransform(csv('a\u0000b'), spec))).toBe('encoding_invalid');
    expect(refusal(() => runTransform(file, { ...spec, valueColumn: 'Nilai' }))).toBe(
      'column_missing:value@3',
    );
    expect(refusal(() => runTransform(csv('Bulan;Bulan;Inflasi\n'), base))).toBe(
      'header_duplicate@1',
    );
    expect(refusal(() => runTransform(csv('Bulan;Inflasi\nOktober 2026;2,8;x'), base))).toBe(
      'csv_column_count@2',
    );
    expect(refusal(() => runTransform(csv('Bulan;Inflasi\nBulan 13;2,8'), base))).toBe(
      'period_invalid@2',
    );
    expect(refusal(() => runTransform(csv('Bulan;Inflasi\nOktober 2026;2,8%'), base))).toBe(
      'value_invalid@2',
    );
    expect(
      refusal(() => runTransform(csv('Bulan;Inflasi\nOktober 2026;2,8\n2026-10;2,9'), base)),
    ).toBe('duplicate_period@3');
    expect(refusal(() => runTransform(csv('Bulan;Inflasi\nOktober 2026;-'), base))).toBe(
      'no_observations',
    );
    const manySeries = [
      'Bulan;Seri;Inflasi',
      ...Array.from({ length: LIMITS.series + 1 }, (_, n) => `Oktober 2026;S${String(n)};1`),
    ].join('\n');
    expect(refusal(() => runTransform(csv(manySeries), { ...base, seriesColumn: 'Seri' }))).toBe(
      `too_many_series@${String(LIMITS.series + 2)}`,
    );
  });

  it('treats cell text as data: formulas and markup are just text that fails as numbers', () => {
    expect(refusal(() => runTransform(csv('Bulan;Inflasi\nOktober 2026;=SUM(A1:A9)'), base))).toBe(
      'value_invalid@2',
    );
    const labelled = runTransform(
      csv('Bulan;Seri;Inflasi\nOktober 2026;<script>alert(1)</script>;1'),
      { ...base, seriesColumn: 'Seri' },
    );
    expect(labelled.series).toEqual(['<script>alert(1)</script>']);
  });
});
