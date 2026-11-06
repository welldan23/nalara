// Charts of NALARA Data versions (P4-03, ADR-021): plain SVG drawn on the server, no script and
// no chart library. Accessible by construction:
// - the SVG is role="img" with a <title> and a <desc> that states the unit, period and latest
//   values;
// - series differ by line style and marker as well as colour;
// - the full data is in a <details> table that works without JavaScript;
// - unit, period, source, retrieval date, version and licence sit under every chart.
// All text from the dataset (series names, title) is rendered as React text, never as markup.
import type { ReactNode } from 'react';

export interface ChartRender {
  readonly datasetTitle: string;
  readonly unit: string;
  readonly frequency: string;
  readonly observations: readonly {
    readonly series: string | null;
    readonly period: string;
    readonly value: number;
  }[];
  readonly series: readonly string[];
  readonly periodStart: string;
  readonly periodEnd: string;
  readonly organization: string;
  readonly sourceName: string;
  readonly sourcePageUrl: string;
  readonly retrievedOn: string;
  readonly revisionNote: string;
  readonly licenseStatus: string;
  readonly attribution: string | null;
  readonly observationsSha256: string;
  /** Present on founder previews only. */
  readonly published?: boolean;
}

export interface ChartBlock {
  readonly type: 'chart';
  readonly dataset: string;
  readonly version: number;
  readonly kind: 'line' | 'bar';
  readonly title: string;
}

const WIDTH = 640;
const HEIGHT = 320;
const MARGIN = { top: 16, right: 16, bottom: 44, left: 64 };
const PLOT_W = WIDTH - MARGIN.left - MARGIN.right;
const PLOT_H = HEIGHT - MARGIN.top - MARGIN.bottom;
const MAX_SERIES_STYLES = 6;

const numberFormat = new Intl.NumberFormat('id-ID', { maximumFractionDigits: 2 });
const dateFormat = new Intl.DateTimeFormat('id-ID', { dateStyle: 'long', timeZone: 'UTC' });

/** Round tick values covering [min, max]. */
export function niceTicks(min: number, max: number, count = 5): number[] {
  if (min === max) {
    const pad = Math.abs(min) > 0 ? Math.abs(min) * 0.1 : 1;
    return niceTicks(min - pad, max + pad, count);
  }
  const raw = (max - min) / count;
  const power = 10 ** Math.floor(Math.log10(raw));
  const step = ([1, 2, 2.5, 5, 10].find((factor) => factor * power >= raw) ?? 10) * power;
  const start = Math.floor(min / step) * step;
  const ticks: number[] = [];
  for (let value = start; value <= max + step * 1e-9; value += step) {
    ticks.push(Number(value.toPrecision(12)));
  }
  if ((ticks.at(-1) ?? max) < max)
    ticks.push(Number((start + step * ticks.length).toPrecision(12)));
  return ticks;
}

/** At most `limit` evenly spaced indexes of `length`, always including the first and last. */
function labelIndexes(length: number, limit: number): number[] {
  if (length <= limit) return Array.from({ length }, (_, index) => index);
  const step = (length - 1) / (limit - 1);
  return [...new Set(Array.from({ length: limit }, (_, index) => Math.round(index * step)))];
}

function ChartSvg(props: {
  readonly block: ChartBlock;
  readonly chart: ChartRender;
  readonly id: string;
}): ReactNode {
  const { block, chart } = props;
  const periods = [...new Set(chart.observations.map((o) => o.period))].sort();
  const seriesNames: (string | null)[] = chart.series.length > 0 ? [...chart.series] : [null];
  const values = chart.observations.map((o) => o.value);
  const ticks = niceTicks(Math.min(0, ...values), Math.max(0, ...values));
  const yMin = ticks[0] ?? 0;
  const yMax = ticks.at(-1) ?? 1;
  const y = (value: number) => MARGIN.top + PLOT_H - ((value - yMin) / (yMax - yMin)) * PLOT_H;
  const band = PLOT_W / Math.max(periods.length, 1);
  const xCenter = (index: number) =>
    block.kind === 'bar'
      ? MARGIN.left + band * index + band / 2
      : MARGIN.left + (periods.length === 1 ? PLOT_W / 2 : (PLOT_W * index) / (periods.length - 1));
  const lookup = new Map(
    chart.observations.map((o) => [`${o.series ?? ''}\u0000${o.period}`, o.value]),
  );
  const valueAt = (series: string | null, period: string) =>
    lookup.get(`${series ?? ''}\u0000${period}`);

  const latest = seriesNames
    .map((series) => {
      const last = [...periods].reverse().find((period) => valueAt(series, period) !== undefined);
      if (last === undefined) return null;
      const value = valueAt(series, last) ?? 0;
      return `${series ?? 'Nilai terakhir'}: ${numberFormat.format(value)} ${chart.unit} (${last})`;
    })
    .filter((text): text is string => text !== null);
  const description = `Grafik ${block.kind === 'line' ? 'garis' : 'batang'} ${chart.datasetTitle}, satuan ${chart.unit}, periode ${chart.periodStart} sampai ${chart.periodEnd}. ${latest.join('. ')}.`;

  return (
    <svg
      className={`chart chart-${block.kind}`}
      viewBox={`0 0 ${String(WIDTH)} ${String(HEIGHT)}`}
      role="img"
      aria-labelledby={`${props.id}-title ${props.id}-desc`}
      preserveAspectRatio="xMidYMid meet"
    >
      <title id={`${props.id}-title`}>{block.title}</title>
      <desc id={`${props.id}-desc`}>{description}</desc>
      {ticks.map((tick) => (
        <g key={tick} className="chart-grid">
          <line x1={MARGIN.left} x2={WIDTH - MARGIN.right} y1={y(tick)} y2={y(tick)} />
          <text x={MARGIN.left - 8} y={y(tick)} dy="0.32em" textAnchor="end">
            {numberFormat.format(tick)}
          </text>
        </g>
      ))}
      {yMin < 0 && yMax > 0 && (
        <line
          className="chart-zero"
          x1={MARGIN.left}
          x2={WIDTH - MARGIN.right}
          y1={y(0)}
          y2={y(0)}
        />
      )}
      {labelIndexes(periods.length, 6).map((index) => (
        <text
          key={periods[index]}
          className="chart-axis"
          x={xCenter(index)}
          y={HEIGHT - MARGIN.bottom + 20}
          // Line charts put the first and last point on the plot's edges: keep their labels inside.
          textAnchor={
            block.kind === 'line' && periods.length > 1 && index === 0
              ? 'start'
              : block.kind === 'line' && periods.length > 1 && index === periods.length - 1
                ? 'end'
                : 'middle'
          }
        >
          {periods[index]}
        </text>
      ))}
      {block.kind === 'line'
        ? seriesNames.map((series, seriesIndex) => {
            // A gap in the data breaks the line instead of joining across it.
            let path = '';
            let open = false;
            periods.forEach((period, index) => {
              const value = valueAt(series, period);
              if (value === undefined) {
                open = false;
                return;
              }
              path += `${open ? 'L' : 'M'}${xCenter(index).toFixed(1)} ${y(value).toFixed(1)}`;
              open = true;
            });
            return (
              <g
                key={series ?? 'nilai'}
                className={`chart-series chart-s${String(seriesIndex % MAX_SERIES_STYLES)}`}
              >
                <path d={path} fill="none" />
                {periods.length <= 60 &&
                  periods.map((period, index) => {
                    const value = valueAt(series, period);
                    return value === undefined ? null : (
                      <circle key={period} cx={xCenter(index)} cy={y(value)} r={3} />
                    );
                  })}
              </g>
            );
          })
        : periods.map((period, index) => {
            const width = (band * 0.8) / seriesNames.length;
            return seriesNames.map((series, seriesIndex) => {
              const value = valueAt(series, period);
              if (value === undefined) return null;
              const top = Math.min(y(value), y(Math.max(0, yMin)));
              return (
                <rect
                  key={`${period}-${series ?? ''}`}
                  className={`chart-bar chart-s${String(seriesIndex % MAX_SERIES_STYLES)}`}
                  x={MARGIN.left + band * index + band * 0.1 + width * seriesIndex}
                  y={top}
                  width={Math.max(width - 1, 1)}
                  height={Math.max(Math.abs(y(value) - y(Math.max(0, yMin))), 1)}
                />
              );
            });
          })}
    </svg>
  );
}

const LICENSE_TEXT: Readonly<Record<string, string>> = {
  open: 'terbuka',
  attribution_required: 'boleh dipakai dengan atribusi',
  permission_required: 'dipakai dengan izin',
};

export function ChartFigure(props: {
  readonly block: ChartBlock;
  readonly chart: ChartRender | undefined;
  readonly id: string;
  /** Founder previews explain a missing or unpublished dataset; readers see nothing. */
  readonly preview: boolean;
}): ReactNode {
  const { block, chart } = props;
  if (chart === undefined) {
    return props.preview ? (
      <p className="image-missing">
        Grafik: dataset {block.dataset} versi {block.version} tidak ditemukan.
      </p>
    ) : null;
  }
  const seriesNames = chart.series.length > 0 ? chart.series : [];
  const periods = [...new Set(chart.observations.map((o) => o.period))].sort();
  const lookup = new Map(
    chart.observations.map((o) => [`${o.series ?? ''}\u0000${o.period}`, o.value]),
  );
  const columns: (string | null)[] = seriesNames.length > 0 ? [...seriesNames] : [null];
  return (
    <figure className="chart-figure" data-testid="chart">
      <figcaption className="chart-title">{block.title}</figcaption>
      {props.preview && chart.published === false && (
        <p className="image-missing">
          Dataset ini belum terbit (atau versinya belum diterbitkan): artikel tidak bisa terbit.
        </p>
      )}
      <ChartSvg block={block} chart={chart} id={props.id} />
      {seriesNames.length > 0 && (
        <ul className="chart-legend">
          {seriesNames.map((series, index) => (
            <li key={series} className={`chart-s${String(index % MAX_SERIES_STYLES)}`}>
              <svg width="28" height="10" aria-hidden="true">
                <line x1="0" x2="28" y1="5" y2="5" />
              </svg>
              {series}
            </li>
          ))}
        </ul>
      )}
      <p className="chart-source">
        Satuan: {chart.unit}. Periode: {chart.periodStart} sampai {chart.periodEnd}. Sumber:{' '}
        {chart.organization} ({chart.sourceName}),{' '}
        <a href={`/data/${encodeURIComponent(block.dataset)}`}>{chart.datasetTitle}</a>, versi data{' '}
        {block.version}, diambil {dateFormat.format(new Date(`${chart.retrievedOn}T00:00:00Z`))}.
        {LICENSE_TEXT[chart.licenseStatus] !== undefined &&
          ` Lisensi: ${LICENSE_TEXT[chart.licenseStatus] ?? ''}.`}
        {chart.attribution !== null && ` ${chart.attribution}`}
      </p>
      <details className="chart-data">
        <summary>Lihat data ({chart.observations.length} angka)</summary>
        <div className="table-scroll">
          <table>
            <caption>
              {chart.datasetTitle}, dalam {chart.unit}
            </caption>
            <thead>
              <tr>
                <th scope="col">Periode</th>
                {columns.map((series) => (
                  <th key={series ?? 'nilai'} scope="col">
                    {series ?? 'Nilai'}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {periods.map((period) => (
                <tr key={period}>
                  <th scope="row">{period}</th>
                  {columns.map((series) => {
                    const value = lookup.get(`${series ?? ''}\u0000${period}`);
                    return (
                      <td key={series ?? 'nilai'}>
                        {value === undefined ? '–' : numberFormat.format(value)}
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="muted hash">SHA-256 data: {chart.observationsSha256}</p>
      </details>
    </figure>
  );
}
