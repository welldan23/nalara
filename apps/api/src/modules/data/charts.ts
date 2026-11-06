// Chart data for article bodies (P4-03, ADR-021). A chart block names `dataset@version`; this
// reads exactly that immutable version plus what the reader must see next to it: unit, period,
// source, retrieval date, revision note and licence. `published` says whether the dataset is
// public and the version is one it has published (the publish gate requires it).
import { and, eq, or, sql } from 'drizzle-orm';
import type { SQL } from 'drizzle-orm';
import type { NodePgDatabase } from 'drizzle-orm/node-postgres';
import { datasetVersions, datasets, sources } from '../../db/schema.ts';
import type { schema } from '../../db/schema.ts';
import type { Block } from '../articles/content.ts';

type Reader = Pick<NodePgDatabase<typeof schema>, 'select'>;

export interface ChartData {
  readonly datasetTitle: string;
  readonly unit: string;
  readonly frequency: string;
  readonly observations: readonly { series: string | null; period: string; value: number }[];
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
  readonly published: boolean;
}

export const chartKey = (dataset: string, version: number) => `${dataset}@${String(version)}`;

/** Every `dataset@version` the body charts, read in one query. Missing refs are absent. */
export async function chartsForBody(
  db: Reader,
  body: readonly Block[],
): Promise<Map<string, ChartData>> {
  const refs = new Map<string, { dataset: string; version: number }>();
  for (const block of body) {
    if (block.type === 'chart') {
      refs.set(chartKey(block.dataset, block.version), block);
    }
  }
  if (refs.size === 0) return new Map();
  const conditions: SQL[] = [];
  for (const ref of refs.values()) {
    const condition = and(eq(datasets.slug, ref.dataset), eq(datasetVersions.version, ref.version));
    if (condition !== undefined) conditions.push(condition);
  }
  const rows = await db
    .select({
      slug: datasets.slug,
      version: datasetVersions.version,
      datasetTitle: datasets.title,
      unit: datasets.unit,
      frequency: datasets.frequency,
      observations: datasetVersions.observations,
      series: datasetVersions.series,
      periodStart: datasetVersions.periodStart,
      periodEnd: datasetVersions.periodEnd,
      organization: sources.organization,
      sourceName: sources.name,
      sourcePageUrl: datasets.sourcePageUrl,
      retrievedOn: datasetVersions.retrievedOn,
      revisionNote: datasetVersions.revisionNote,
      licenseStatus: datasets.licenseStatus,
      attribution: datasets.attribution,
      observationsSha256: sql<string>`encode(${datasetVersions.observationsSha256}, 'hex')`,
      published: sql<boolean>`(${datasets.status} = 'published'
        AND ${datasetVersions.version} <= ${datasets.publishedVersion})`,
    })
    .from(datasetVersions)
    .innerJoin(datasets, eq(datasets.id, datasetVersions.datasetId))
    .innerJoin(sources, eq(sources.id, datasets.sourceId))
    .where(or(...conditions));
  return new Map(
    rows.map(({ slug, version, ...data }) => [chartKey(slug, version), data] as const),
  );
}
