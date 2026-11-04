// The dataset transform engine (P4-01, ADR-021). Pure and deterministic: the same raw bytes and
// the same spec always give the same observations and the same SHA-256, which is how NALARA proves
// that a published chart really comes from the published source file.
//
// Input is treated as data: strict UTF-8, RFC 4180 CSV, and limits on size, rows, columns, cells
// and series. Every refusal is a TransformError with a stable code and, where useful, the 1-based
// line of the raw file. Nothing here evaluates expressions or code from the spec.
import { createHash } from 'node:crypto';
import { z } from 'zod';

export const LIMITS = {
  rawBytes: 5 * 1024 * 1024,
  rows: 100_000,
  columns: 200,
  cellChars: 1_000,
  series: 20,
  observations: 20_000,
} as const;

export class TransformError extends Error {
  readonly code: string;
  readonly line: number | null;
  constructor(code: string, line: number | null = null) {
    super(`transform refused: ${code}${line === null ? '' : ` (line ${String(line)})`}`);
    this.name = 'TransformError';
    this.code = code;
    this.line = line;
  }
}

const columnName = z.string().trim().min(1).max(100);

export const transformSpecSchema = z
  .strictObject({
    format: z.literal('csv'),
    delimiter: z.enum([',', ';', '\t', '|']),
    decimal: z.enum(['.', ',']),
    thousands: z.enum(['', '.', ',', ' ']),
    /** Lines before the header (titles, notes) to skip. */
    skipRows: z.int().min(0).max(50).default(0),
    periodColumn: columnName,
    periodFormat: z.enum(['year', 'quarter', 'month', 'day']),
    valueColumn: columnName,
    seriesColumn: columnName.optional(),
    /** Keep only rows whose column equals the text exactly (after trimming). */
    filters: z
      .array(z.strictObject({ column: columnName, equals: z.string().max(200) }))
      .max(5)
      .default([]),
    /** Multiply every value, e.g. 0.001 to turn thousands into millions. */
    scale: z
      .number()
      .refine((value) => Number.isFinite(value) && value !== 0, 'scale_invalid')
      .refine((value) => Math.abs(value) >= 1e-9 && Math.abs(value) <= 1e9, 'scale_range')
      .default(1),
    /** Cells that mean "no value" and are skipped (counted, never turned into zero). */
    missing: z.array(z.string().max(20)).max(10).default(['', '-', '–', '...', 'NA', 'n/a']),
  })
  .refine((spec) => spec.decimal !== spec.thousands, {
    message: 'decimal_equals_thousands',
    path: ['thousands'],
  })
  .refine((spec) => spec.delimiter !== spec.decimal, {
    message: 'delimiter_equals_decimal',
    path: ['decimal'],
  });

export type TransformSpec = z.infer<typeof transformSpecSchema>;

export interface Observation {
  /** null when the dataset has a single series. */
  readonly series: string | null;
  /** Normalised: YYYY, YYYY-Qn, YYYY-MM or YYYY-MM-DD. */
  readonly period: string;
  readonly value: number;
}

export interface TransformResult {
  readonly observations: Observation[];
  readonly series: string[];
  readonly periodStart: string;
  readonly periodEnd: string;
  /** Data rows read after the header (before filters). */
  readonly rowsRead: number;
  /** Rows skipped because the value cell was a "missing" marker. */
  readonly rowsMissing: number;
  /** SHA-256 (hex) of the canonical JSON of the observations. */
  readonly sha256: string;
}

/** RFC 4180: quoted fields, "" inside quotes, CR/LF/CRLF line ends, newlines inside quotes. */
export function parseCsv(text: string, delimiter: string): { cells: string[]; line: number }[] {
  const rows: { cells: string[]; line: number }[] = [];
  let cells: string[] = [];
  let cell = '';
  let quoted = false;
  let line = 1;
  let rowLine = 1;
  let afterQuote = false;
  const pushCell = () => {
    if (cell.length > LIMITS.cellChars) throw new TransformError('cell_too_long', rowLine);
    cells.push(cell);
    cell = '';
    afterQuote = false;
    if (cells.length > LIMITS.columns) throw new TransformError('too_many_columns', rowLine);
  };
  const pushRow = () => {
    pushCell();
    rows.push({ cells, line: rowLine });
    if (rows.length > LIMITS.rows + 51) throw new TransformError('too_many_rows');
    cells = [];
  };
  for (let index = 0; index < text.length; index += 1) {
    const char = text[index] ?? '';
    if (quoted) {
      if (char === '"') {
        if (text[index + 1] === '"') {
          cell += '"';
          index += 1;
        } else {
          quoted = false;
          afterQuote = true;
        }
      } else {
        if (char === '\n') line += 1;
        cell += char;
      }
      continue;
    }
    if (char === '"') {
      if (cell !== '' || afterQuote) throw new TransformError('csv_stray_quote', line);
      quoted = true;
    } else if (char === delimiter) {
      pushCell();
    } else if (char === '\r' || char === '\n') {
      if (char === '\r' && text[index + 1] === '\n') index += 1;
      pushRow();
      line += 1;
      rowLine = line;
    } else {
      if (afterQuote) throw new TransformError('csv_stray_quote', line);
      cell += char;
    }
  }
  if (quoted) throw new TransformError('csv_unclosed_quote', rowLine);
  if (cell !== '' || cells.length > 0 || afterQuote) pushRow();
  return rows;
}

const MONTHS: Readonly<Record<string, number>> = {
  jan: 1,
  januari: 1,
  january: 1,
  feb: 2,
  februari: 2,
  february: 2,
  peb: 2,
  pebruari: 2,
  mar: 3,
  maret: 3,
  march: 3,
  apr: 4,
  april: 4,
  mei: 5,
  may: 5,
  jun: 6,
  juni: 6,
  june: 6,
  jul: 7,
  juli: 7,
  july: 7,
  agu: 8,
  agt: 8,
  agustus: 8,
  aug: 8,
  august: 8,
  sep: 9,
  sept: 9,
  september: 9,
  okt: 10,
  oktober: 10,
  oct: 10,
  october: 10,
  nov: 11,
  nopember: 11,
  november: 11,
  des: 12,
  desember: 12,
  dec: 12,
  december: 12,
};
const ROMAN: Readonly<Record<string, number>> = { i: 1, ii: 2, iii: 3, iv: 4 };

const pad = (value: number) => String(value).padStart(2, '0');
const validYear = (year: number) => year >= 1800 && year <= 2200;

/** Normalises a period cell, or returns null when it does not match the format. */
export function normalisePeriod(raw: string, format: TransformSpec['periodFormat']): string | null {
  const text = raw.trim().toLowerCase();
  switch (format) {
    case 'year': {
      const match = /^(\d{4})$/.exec(text);
      return match && validYear(Number(match[1])) ? (match[1] ?? null) : null;
    }
    case 'quarter': {
      const patterns: [RegExp, number, number][] = [
        [/^(\d{4})[-\s/]?q([1-4])$/, 1, 2],
        [/^q([1-4])[-\s/](\d{4})$/, 2, 1],
        [/^(?:triwulan|tw)\s+(i{1,3}|iv|[1-4])\s+(\d{4})$/, 2, 1],
      ];
      for (const [pattern, yearGroup, quarterGroup] of patterns) {
        const match = pattern.exec(text);
        if (match === null) continue;
        const year = Number(match[yearGroup]);
        const q = match[quarterGroup] ?? '';
        const quarter = ROMAN[q] ?? Number(q);
        if (validYear(year) && quarter >= 1 && quarter <= 4)
          return `${String(year)}-Q${String(quarter)}`;
      }
      return null;
    }
    case 'month': {
      let year: number | undefined;
      let month: number | undefined;
      let match = /^(\d{4})[-/.](\d{1,2})$/.exec(text);
      if (match !== null) [year, month] = [Number(match[1]), Number(match[2])];
      if (year === undefined) {
        match = /^(\d{1,2})[-/.](\d{4})$/.exec(text);
        if (match !== null) [month, year] = [Number(match[1]), Number(match[2])];
      }
      if (year === undefined) {
        match = /^([a-z]+)\.?[\s-]+(\d{4})$/.exec(text);
        if (match !== null) [month, year] = [MONTHS[match[1] ?? ''], Number(match[2])];
      }
      if (
        year === undefined ||
        month === undefined ||
        !validYear(year) ||
        month < 1 ||
        month > 12
      ) {
        return null;
      }
      return `${String(year)}-${pad(month)}`;
    }
    case 'day': {
      let parts: [number, number, number] | null = null;
      let match = /^(\d{4})-(\d{1,2})-(\d{1,2})$/.exec(text);
      if (match !== null) parts = [Number(match[1]), Number(match[2]), Number(match[3])];
      match = /^(\d{1,2})[/.-](\d{1,2})[/.-](\d{4})$/.exec(text);
      // Day first (Indonesian usage): 31/01/2026.
      if (parts === null && match !== null) {
        parts = [Number(match[3]), Number(match[2]), Number(match[1])];
      }
      if (parts === null) return null;
      const [year, month, day] = parts;
      const date = new Date(Date.UTC(year, month - 1, day));
      if (
        !validYear(year) ||
        date.getUTCFullYear() !== year ||
        date.getUTCMonth() !== month - 1 ||
        date.getUTCDate() !== day
      ) {
        return null;
      }
      return `${String(year)}-${pad(month)}-${pad(day)}`;
    }
  }
}

/** Parses a number cell with the spec's separators; null when it is not a plain number. */
export function parseValue(
  raw: string,
  spec: Pick<TransformSpec, 'decimal' | 'thousands'>,
): number | null {
  let text = raw.trim().replace(/\u00a0/g, ' ');
  if (spec.thousands !== '') text = text.split(spec.thousands).join('');
  if (spec.decimal === ',') text = text.replace(',', '.');
  if (!/^[-+]?\d+(\.\d+)?$/.test(text)) return null;
  const value = Number(text);
  return Number.isFinite(value) ? value : null;
}

/** Twelve significant digits: hides binary float noise (0.1 * 3) without losing real precision. */
const tidy = (value: number) => Number(value.toPrecision(12));

export function canonicalJson(observations: readonly Observation[]): string {
  return JSON.stringify(observations.map((o) => [o.series, o.period, o.value]));
}

/** Runs a spec over raw bytes. Throws TransformError on anything it cannot read exactly. */
export function runTransform(raw: Buffer, rawSpec: unknown): TransformResult {
  const parsedSpec = transformSpecSchema.safeParse(rawSpec);
  if (!parsedSpec.success) throw new TransformError('spec_invalid');
  const spec = parsedSpec.data;
  if (raw.length === 0) throw new TransformError('empty_file');
  if (raw.length > LIMITS.rawBytes) throw new TransformError('file_too_large');
  let text: string;
  try {
    text = new TextDecoder('utf-8', { fatal: true }).decode(raw);
  } catch {
    throw new TransformError('encoding_invalid');
  }
  if (text.startsWith('﻿')) text = text.slice(1);
  if (text.includes('\u0000')) throw new TransformError('encoding_invalid');

  const rows = parseCsv(text, spec.delimiter).slice(spec.skipRows);
  const headerRow = rows.shift();
  if (headerRow === undefined) throw new TransformError('header_missing');
  const header = headerRow.cells.map((name) => name.trim());
  if (new Set(header).size !== header.length)
    throw new TransformError('header_duplicate', headerRow.line);
  const column = (name: string, what: string) => {
    const index = header.indexOf(name.trim());
    if (index === -1) throw new TransformError(`column_missing:${what}`, headerRow.line);
    return index;
  };
  const periodIndex = column(spec.periodColumn, 'period');
  const valueIndex = column(spec.valueColumn, 'value');
  const seriesIndex = spec.seriesColumn === undefined ? null : column(spec.seriesColumn, 'series');
  const filters = spec.filters.map((filter) => ({
    index: column(filter.column, 'filter'),
    equals: filter.equals.trim(),
  }));
  const missing = new Set(spec.missing.map((token) => token.trim().toLowerCase()));

  const seen = new Set<string>();
  const seriesSeen = new Set<string>();
  const observations: Observation[] = [];
  let rowsRead = 0;
  let rowsMissing = 0;
  for (const row of rows) {
    // A blank line (e.g. at the end of the file) is not a data row.
    if (row.cells.length === 1 && row.cells[0]?.trim() === '') continue;
    rowsRead += 1;
    if (rowsRead > LIMITS.rows) throw new TransformError('too_many_rows', row.line);
    if (row.cells.length !== header.length) throw new TransformError('csv_column_count', row.line);
    const cell = (index: number) => (row.cells[index] ?? '').trim();
    if (filters.some((filter) => cell(filter.index) !== filter.equals)) continue;
    const rawValue = cell(valueIndex);
    if (missing.has(rawValue.toLowerCase())) {
      rowsMissing += 1;
      continue;
    }
    const period = normalisePeriod(cell(periodIndex), spec.periodFormat);
    if (period === null) throw new TransformError('period_invalid', row.line);
    const value = parseValue(rawValue, spec);
    if (value === null) throw new TransformError('value_invalid', row.line);
    const series = seriesIndex === null ? null : cell(seriesIndex);
    if (series === '') throw new TransformError('series_empty', row.line);
    if (series !== null) {
      seriesSeen.add(series);
      if (seriesSeen.size > LIMITS.series) throw new TransformError('too_many_series', row.line);
    }
    const key = `${series ?? ''}\u0000${period}`;
    if (seen.has(key)) throw new TransformError('duplicate_period', row.line);
    seen.add(key);
    observations.push({ series, period, value: tidy(value * spec.scale) });
    if (observations.length > LIMITS.observations) {
      throw new TransformError('too_many_observations', row.line);
    }
  }
  if (observations.length === 0) throw new TransformError('no_observations');
  // Deterministic order whatever the file's order: by series, then period (both by code point).
  const compare = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);
  observations.sort(
    (a, b) => compare(a.series ?? '', b.series ?? '') || compare(a.period, b.period),
  );
  const periods = observations.map((o) => o.period).sort(compare);
  return {
    observations,
    series: [...seriesSeen].sort(compare),
    periodStart: periods[0] ?? '',
    periodEnd: periods.at(-1) ?? '',
    rowsRead,
    rowsMissing,
    sha256: createHash('sha256').update(canonicalJson(observations), 'utf8').digest('hex'),
  };
}
