// NALARA Data for readers (P4-04). Only published datasets, and of those only the versions up to
// the published one. Everything a reader needs to check a number is here: source, licence,
// methodology, the transform rules, every version with its revision note and hashes. The raw file
// never leaves the OS; the normalised data is downloadable only when the licence allows reuse.
import { and, asc, desc, eq, lte, sql } from 'drizzle-orm';
import type { NodePgDatabase } from 'drizzle-orm/node-postgres';
import { datasetVersions, datasets, sources } from '../../db/schema.ts';
import type { schema } from '../../db/schema.ts';

type Reader = Pick<NodePgDatabase<typeof schema>, 'select'>;

/** Licences under which readers may download and reuse the normalised data. */
export const DOWNLOADABLE_LICENSES: ReadonlySet<string> = new Set(['open', 'attribution_required']);

const summary = {
  slug: datasets.slug,
  title: datasets.title,
  description: datasets.description,
  unit: datasets.unit,
  frequency: datasets.frequency,
  publishedVersion: datasets.publishedVersion,
  publishedAt: datasets.publishedAt,
  organization: sources.organization,
  sourceName: sources.name,
};

export async function publicDatasets(db: Reader) {
  return db
    .select(summary)
    .from(datasets)
    .innerJoin(sources, eq(sources.id, datasets.sourceId))
    .where(eq(datasets.status, 'published'))
    .orderBy(asc(datasets.title), asc(datasets.slug));
}

export async function publicDataset(db: Reader, slug: string) {
  const [dataset] = await db
    .select({
      ...summary,
      id: datasets.id,
      sourcePageUrl: datasets.sourcePageUrl,
      methodology: datasets.methodology,
      licenseStatus: datasets.licenseStatus,
      licenseNote: datasets.licenseNote,
      attribution: datasets.attribution,
    })
    .from(datasets)
    .innerJoin(sources, eq(sources.id, datasets.sourceId))
    .where(and(eq(datasets.slug, slug), eq(datasets.status, 'published')));
  if (dataset?.publishedVersion == null) return null;
  const versions = await db
    .select({
      version: datasetVersions.version,
      retrievedOn: datasetVersions.retrievedOn,
      fileUrl: datasetVersions.fileUrl,
      spec: datasetVersions.spec,
      revisionNote: datasetVersions.revisionNote,
      observationCount: datasetVersions.observationCount,
      series: datasetVersions.series,
      periodStart: datasetVersions.periodStart,
      periodEnd: datasetVersions.periodEnd,
      rawSha256: sql<string>`encode(${datasetVersions.rawSha256}, 'hex')`,
      observationsSha256: sql<string>`encode(${datasetVersions.observationsSha256}, 'hex')`,
      createdAt: datasetVersions.createdAt,
    })
    .from(datasetVersions)
    .where(
      and(
        eq(datasetVersions.datasetId, dataset.id),
        lte(datasetVersions.version, dataset.publishedVersion),
      ),
    )
    .orderBy(desc(datasetVersions.version));
  const [current] = await db
    .select({ observations: datasetVersions.observations })
    .from(datasetVersions)
    .where(
      and(
        eq(datasetVersions.datasetId, dataset.id),
        eq(datasetVersions.version, dataset.publishedVersion),
      ),
    );
  const visible = Object.fromEntries(
    Object.entries(dataset).filter(([key]) => key !== 'id'),
  ) as Omit<typeof dataset, 'id'>;
  return {
    dataset: { ...visible, downloadable: DOWNLOADABLE_LICENSES.has(dataset.licenseStatus) },
    versions,
    observations: current?.observations ?? [],
  };
}

const csvCell = (value: string) => {
  // Neutralise spreadsheet formulas and quote what needs quoting (RFC 4180).
  const safe = /^[=+\-@\t\r]/.test(value) ? `'${value}` : value;
  return /[",\r\n]/.test(safe) ? `"${safe.replaceAll('"', '""')}"` : safe;
};

/** The normalised data of one published version as CSV, when the licence allows reuse. */
export async function publicDatasetCsv(
  db: Reader,
  slug: string,
  version: number | undefined,
): Promise<{ csv: string; version: number; attribution: string | null } | null> {
  const found = await publicDataset(db, slug);
  if (!found?.dataset.downloadable) return null;
  const wanted = version ?? found.dataset.publishedVersion ?? 0;
  if (!found.versions.some((row) => row.version === wanted)) return null;
  const [row] = await db
    .select({ observations: datasetVersions.observations })
    .from(datasetVersions)
    .innerJoin(datasets, eq(datasets.id, datasetVersions.datasetId))
    .where(and(eq(datasets.slug, slug), eq(datasetVersions.version, wanted)));
  if (row === undefined) return null;
  const lines = ['series,period,value'];
  for (const observation of row.observations) {
    lines.push(
      [csvCell(observation.series ?? ''), observation.period, String(observation.value)].join(','),
    );
  }
  return {
    csv: `${lines.join('\r\n')}\r\n`,
    version: wanted,
    attribution: found.dataset.attribution,
  };
}
