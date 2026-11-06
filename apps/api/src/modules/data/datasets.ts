// NALARA Data catalogue (P4-02, ADR-021). Rules:
// - A dataset belongs to a source in the registry; identity (slug, source) never changes.
// - Versions are immutable: raw file + SHA-256, the declarative transform, and the observations
//   + SHA-256. A correction is a new version with a revision note.
// - Publishing needs a verified source, a publishable licence (open, attribution with the credit
//   line, or permission with the permission written down), and the chosen version must still
//   reproduce: the transform is re-run from the stored raw bytes and both hashes must match.
// - Every change is audited (field names and versions only).
import { createHash } from 'node:crypto';
import { and, asc, desc, eq, max, sql } from 'drizzle-orm';
import type { NodePgDatabase } from 'drizzle-orm/node-postgres';
import { z } from 'zod';
import {
  DATASET_FREQUENCIES,
  LICENSE_STATUSES,
  datasetVersions,
  datasets,
  sources,
} from '../../db/schema.ts';
import type { schema } from '../../db/schema.ts';
import { AppError } from '../../lib/errors.ts';
import { parseOrThrow } from '../../lib/validation.ts';
import { httpsUrl, plainText } from '../articles/content.ts';
import { recordAudit } from '../audit/audit.ts';
import { LIMITS, TransformError, runTransform, transformSpecSchema } from './transform.ts';
import type { Observation, TransformResult } from './transform.ts';

type Db = NodePgDatabase<typeof schema>;

export interface Actor {
  readonly userId: string;
  readonly requestId?: string;
}

const optionalText = (limit: number) =>
  plainText(limit)
    .trim()
    .nullable()
    .default(null)
    .transform((value) => (value === null || value === '' ? null : value));

const metadataFields = {
  title: plainText(200).trim().min(3),
  description: plainText(2000).trim().default(''),
  sourcePageUrl: httpsUrl,
  unit: plainText(60).trim().min(1),
  frequency: z.enum(DATASET_FREQUENCIES),
  methodology: plainText(4000).trim().default(''),
  licenseStatus: z.enum(LICENSE_STATUSES).default('unknown'),
  licenseNote: optionalText(500),
  attribution: optionalText(300),
};

const attributionRule = (
  value: { licenseStatus: string; attribution: string | null },
  context: z.RefinementCtx,
) => {
  if (value.licenseStatus === 'attribution_required' && value.attribution === null) {
    context.addIssue({ code: 'custom', path: ['attribution'], message: 'attribution_required' });
  }
};

export const datasetCreateSchema = z
  .strictObject({
    slug: z
      .string()
      .min(3)
      .max(80)
      .regex(/^[a-z0-9]+(-[a-z0-9]+)*$/, 'slug_invalid'),
    sourceId: z.uuid(),
    ...metadataFields,
  })
  .superRefine(attributionRule);

export const datasetUpdateSchema = z
  .strictObject({ ...metadataFields, expectedVersion: z.int().min(1) })
  .superRefine(attributionRule);

const BASE64 = /^[A-Za-z0-9+/]*={0,2}$/;
const fileSchema = z
  .string()
  .min(4)
  .max(Math.ceil((LIMITS.rawBytes * 4) / 3) + 4)
  .refine((value) => value.length % 4 === 0 && BASE64.test(value), 'base64_invalid');

export const versionInputSchema = z.strictObject({
  file: fileSchema,
  filename: z.string().regex(/^[A-Za-z0-9._ ()-]{1,120}$/, 'filename_invalid'),
  fileUrl: httpsUrl,
  retrievedOn: z.iso.date(),
  spec: z.record(z.string(), z.unknown()),
  revisionNote: plainText(1000).trim().min(3),
});

export const previewInputSchema = z.strictObject({
  file: fileSchema,
  spec: z.record(z.string(), z.unknown()),
});

/** Runs the transform and turns its refusal into a field error the editor can show. */
function transformOrThrow(raw: Buffer, spec: unknown): TransformResult {
  try {
    return runTransform(raw, spec);
  } catch (error) {
    if (!(error instanceof TransformError)) throw error;
    throw new AppError('VALIDATION_FAILED', [
      { path: error.line === null ? 'file' : `file.line.${String(error.line)}`, rule: error.code },
    ]);
  }
}

export interface PreviewResult {
  readonly observationCount: number;
  readonly series: string[];
  readonly periodStart: string;
  readonly periodEnd: string;
  readonly rowsRead: number;
  readonly rowsMissing: number;
  readonly sha256: string;
  /** The first observations only, for the founder to eyeball. */
  readonly sample: Observation[];
}

export function previewTransform(raw: unknown): PreviewResult {
  const input = parseOrThrow(previewInputSchema, raw);
  const result = transformOrThrow(Buffer.from(input.file, 'base64'), input.spec);
  return {
    observationCount: result.observations.length,
    series: result.series,
    periodStart: result.periodStart,
    periodEnd: result.periodEnd,
    rowsRead: result.rowsRead,
    rowsMissing: result.rowsMissing,
    sha256: result.sha256,
    sample: result.observations.slice(0, 50),
  };
}

const datasetColumns = {
  id: datasets.id,
  slug: datasets.slug,
  title: datasets.title,
  description: datasets.description,
  sourceId: datasets.sourceId,
  sourcePageUrl: datasets.sourcePageUrl,
  unit: datasets.unit,
  frequency: datasets.frequency,
  methodology: datasets.methodology,
  licenseStatus: datasets.licenseStatus,
  licenseNote: datasets.licenseNote,
  attribution: datasets.attribution,
  status: datasets.status,
  publishedVersion: datasets.publishedVersion,
  publishedAt: datasets.publishedAt,
  version: datasets.version,
  createdAt: datasets.createdAt,
  updatedAt: datasets.updatedAt,
};

export type DatasetView = Awaited<ReturnType<typeof listDatasets>>[number];

export async function listDatasets(db: Db) {
  return db
    .select({
      ...datasetColumns,
      source: { name: sources.name, organization: sources.organization, status: sources.status },
      versions: sql<number>`(SELECT count(*)::int FROM dataset_versions v
                             WHERE v.dataset_id = ${datasets.id})`,
    })
    .from(datasets)
    .innerJoin(sources, eq(sources.id, datasets.sourceId))
    .orderBy(asc(datasets.title), asc(datasets.id));
}

const versionSummary = {
  version: datasetVersions.version,
  rawFilename: datasetVersions.rawFilename,
  rawSize: sql<number>`octet_length(${datasetVersions.raw})`,
  rawSha256: sql<string>`encode(${datasetVersions.rawSha256}, 'hex')`,
  fileUrl: datasetVersions.fileUrl,
  retrievedOn: datasetVersions.retrievedOn,
  spec: datasetVersions.spec,
  observationsSha256: sql<string>`encode(${datasetVersions.observationsSha256}, 'hex')`,
  observationCount: datasetVersions.observationCount,
  series: datasetVersions.series,
  periodStart: datasetVersions.periodStart,
  periodEnd: datasetVersions.periodEnd,
  revisionNote: datasetVersions.revisionNote,
  createdAt: datasetVersions.createdAt,
};

export async function getDataset(db: Db, id: string) {
  const [dataset] = (await listDatasets(db)).filter((row) => row.id === id);
  if (dataset === undefined) return null;
  const versions = await db
    .select(versionSummary)
    .from(datasetVersions)
    .where(eq(datasetVersions.datasetId, id))
    .orderBy(desc(datasetVersions.version));
  return { dataset, versions };
}

function audit(
  db: Pick<Db, 'insert'>,
  actor: Actor,
  action:
    'dataset.create' | 'dataset.update' | 'dataset.version' | 'dataset.publish' | 'dataset.retract',
  id: string,
  metadata: Record<string, string | number>,
) {
  return recordAudit(db, {
    action,
    actorType: 'founder',
    actorId: actor.userId,
    result: 'success',
    resourceType: 'dataset',
    resourceId: id,
    ...(actor.requestId === undefined ? {} : { requestId: actor.requestId }),
    metadata,
  });
}

const isUnique = (error: unknown) =>
  ((error as { cause?: { code?: string } }).cause ?? (error as { code?: string })).code === '23505';

export async function createDataset(db: Db, actor: Actor, raw: unknown): Promise<{ id: string }> {
  const input = parseOrThrow(datasetCreateSchema, raw);
  const [source] = await db
    .select({ id: sources.id })
    .from(sources)
    .where(eq(sources.id, input.sourceId));
  if (source === undefined) {
    throw new AppError('VALIDATION_FAILED', [{ path: 'sourceId', rule: 'unknown' }]);
  }
  try {
    return await db.transaction(async (tx) => {
      const [row] = await tx
        .insert(datasets)
        .values({ ...input, createdBy: actor.userId })
        .returning({ id: datasets.id });
      if (row === undefined) throw new Error('insert returned no row');
      await audit(tx, actor, 'dataset.create', row.id, {
        version: 1,
        license_status: input.licenseStatus,
      });
      return row;
    });
  } catch (error) {
    if (isUnique(error)) {
      throw new AppError('VALIDATION_FAILED', [{ path: 'slug', rule: 'duplicate' }]);
    }
    throw error;
  }
}

const EDITABLE = [
  'title',
  'description',
  'sourcePageUrl',
  'unit',
  'frequency',
  'methodology',
  'licenseStatus',
  'licenseNote',
  'attribution',
] as const;

export async function updateDataset(
  db: Db,
  actor: Actor,
  id: string,
  raw: unknown,
): Promise<{ version: number }> {
  const { expectedVersion, ...input } = parseOrThrow(datasetUpdateSchema, raw);
  return db.transaction(async (tx) => {
    const [current] = await tx
      .select(datasetColumns)
      .from(datasets)
      .where(eq(datasets.id, id))
      .for('update');
    if (current === undefined) throw new AppError('NOT_FOUND');
    if (current.version !== expectedVersion) throw new AppError('VERSION_CONFLICT');
    const changed = EDITABLE.filter((key) => current[key] !== input[key]);
    if (changed.length === 0) {
      throw new AppError('VALIDATION_FAILED', [{ path: 'dataset', rule: 'unchanged' }]);
    }
    // A published dataset must stay publishable; the database checks it as well.
    if (
      current.status === 'published' &&
      !publishableLicense(input.licenseStatus, input.licenseNote)
    ) {
      throw new AppError('VALIDATION_FAILED', [{ path: 'licenseStatus', rule: 'not_publishable' }]);
    }
    const [row] = await tx
      .update(datasets)
      .set({ ...input, version: sql`${datasets.version} + 1`, updatedAt: sql`now()` })
      .where(eq(datasets.id, id))
      .returning({ version: datasets.version });
    if (row === undefined) throw new AppError('VERSION_CONFLICT');
    await audit(tx, actor, 'dataset.update', id, {
      version: row.version,
      changed: changed.join(','),
    });
    return row;
  });
}

function publishableLicense(status: string, note: string | null): boolean {
  return (
    status === 'open' ||
    status === 'attribution_required' ||
    (status === 'permission_required' && note !== null)
  );
}

const sha256 = (data: Buffer | string) => createHash('sha256').update(data).digest();

/** Adds the next version from a raw file and a transform spec. */
export async function addVersion(
  db: Db,
  actor: Actor,
  datasetId: string,
  raw: unknown,
): Promise<{ version: number; observationCount: number; observationsSha256: string }> {
  const input = parseOrThrow(versionInputSchema, raw);
  const today = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Jakarta' }).format(new Date());
  if (input.retrievedOn > today) {
    throw new AppError('VALIDATION_FAILED', [{ path: 'retrievedOn', rule: 'future' }]);
  }
  const bytes = Buffer.from(input.file, 'base64');
  const result = transformOrThrow(bytes, input.spec);
  return db.transaction(async (tx) => {
    const [dataset] = await tx
      .select({ id: datasets.id, status: datasets.status })
      .from(datasets)
      .where(eq(datasets.id, datasetId))
      .for('update');
    if (dataset === undefined) throw new AppError('NOT_FOUND');
    if (dataset.status === 'retracted') throw new AppError('NOT_EDITABLE');
    const [latest] = await tx
      .select({ n: max(datasetVersions.version) })
      .from(datasetVersions)
      .where(eq(datasetVersions.datasetId, datasetId));
    const version = (latest?.n ?? 0) + 1;
    await tx.insert(datasetVersions).values({
      datasetId,
      version,
      raw: bytes,
      rawSha256: sha256(bytes),
      rawFilename: input.filename,
      fileUrl: input.fileUrl,
      retrievedOn: input.retrievedOn,
      spec: parsedSpec(input.spec),
      observations: result.observations,
      observationsSha256: Buffer.from(result.sha256, 'hex'),
      observationCount: result.observations.length,
      series: result.series,
      periodStart: result.periodStart,
      periodEnd: result.periodEnd,
      revisionNote: input.revisionNote,
      createdBy: actor.userId,
    });
    await audit(tx, actor, 'dataset.version', datasetId, {
      dataset_version: version,
      observations: result.observations.length,
    });
    return {
      version,
      observationCount: result.observations.length,
      observationsSha256: result.sha256,
    };
  });
}

/** The spec as the engine read it (defaults filled in), so every re-run reads the same thing. */
function parsedSpec(spec: unknown): Record<string, unknown> {
  // runTransform has already accepted it.
  return { ...transformSpecSchema.parse(spec) };
}

export interface VerifyResult {
  readonly rawMatches: boolean;
  readonly observationsMatch: boolean;
  readonly observationsSha256: string;
}

/** Re-runs a stored version from its raw bytes: both hashes must match what was stored. */
export async function verifyVersion(
  db: Db,
  datasetId: string,
  version: number,
): Promise<VerifyResult> {
  const [row] = await db
    .select({
      raw: datasetVersions.raw,
      rawSha256: datasetVersions.rawSha256,
      spec: datasetVersions.spec,
      observationsSha256: datasetVersions.observationsSha256,
    })
    .from(datasetVersions)
    .where(and(eq(datasetVersions.datasetId, datasetId), eq(datasetVersions.version, version)));
  if (row === undefined) throw new AppError('NOT_FOUND');
  const rawMatches = sha256(row.raw).equals(row.rawSha256);
  let observationsSha256: string;
  try {
    observationsSha256 = runTransform(row.raw, row.spec).sha256;
  } catch {
    // The stored spec no longer reproduces anything (it never should): report a mismatch.
    observationsSha256 = '';
  }
  return {
    rawMatches,
    observationsMatch: observationsSha256 === row.observationsSha256.toString('hex'),
    observationsSha256,
  };
}

const publishSchema = z.strictObject({ version: z.int().min(1), expectedVersion: z.int().min(1) });

export async function publishDataset(
  db: Db,
  actor: Actor,
  id: string,
  raw: unknown,
): Promise<{ status: 'published'; publishedVersion: number }> {
  const input = parseOrThrow(publishSchema, raw);
  const check = await verifyVersion(db, id, input.version);
  if (!check.rawMatches || !check.observationsMatch) throw new AppError('INTEGRITY_FAILED');
  return db.transaction(async (tx) => {
    const [current] = await tx
      .select({
        version: datasets.version,
        status: datasets.status,
        licenseStatus: datasets.licenseStatus,
        licenseNote: datasets.licenseNote,
        sourceStatus: sources.status,
      })
      .from(datasets)
      .innerJoin(sources, eq(sources.id, datasets.sourceId))
      .where(eq(datasets.id, id))
      .for('update', { of: datasets });
    if (current === undefined) throw new AppError('NOT_FOUND');
    if (current.version !== input.expectedVersion) throw new AppError('VERSION_CONFLICT');
    const blockers: { path: string; rule: string }[] = [];
    if (current.sourceStatus !== 'verified')
      blockers.push({ path: 'source', rule: 'not_verified' });
    if (!publishableLicense(current.licenseStatus, current.licenseNote)) {
      blockers.push({ path: 'licenseStatus', rule: 'not_publishable' });
    }
    if (blockers.length > 0) throw new AppError('GATE_BLOCKED', blockers);
    await tx
      .update(datasets)
      .set({
        status: 'published',
        publishedVersion: input.version,
        publishedAt: sql`now()`,
        version: sql`${datasets.version} + 1`,
        updatedAt: sql`now()`,
      })
      .where(eq(datasets.id, id));
    await audit(tx, actor, 'dataset.publish', id, { dataset_version: input.version });
    return { status: 'published', publishedVersion: input.version };
  });
}

/** Takes a dataset off the public site (articles using it are then held by the publish gate). */
export async function retractDataset(
  db: Db,
  actor: Actor,
  id: string,
  raw: unknown,
): Promise<void> {
  const { expectedVersion } = parseOrThrow(
    z.strictObject({ expectedVersion: z.int().min(1) }),
    raw,
  );
  await db.transaction(async (tx) => {
    const [current] = await tx
      .select({
        version: datasets.version,
        status: datasets.status,
        published: datasets.publishedVersion,
      })
      .from(datasets)
      .where(eq(datasets.id, id))
      .for('update');
    if (current === undefined) throw new AppError('NOT_FOUND');
    if (current.version !== expectedVersion) throw new AppError('VERSION_CONFLICT');
    if (current.status !== 'published') throw new AppError('INVALID_TRANSITION');
    await tx
      .update(datasets)
      .set({ status: 'retracted', version: sql`${datasets.version} + 1`, updatedAt: sql`now()` })
      .where(eq(datasets.id, id));
    await audit(tx, actor, 'dataset.retract', id, { dataset_version: current.published ?? 0 });
  });
}

/** The raw file of one version, for the founder (served as an attachment). */
export async function getRawFile(db: Db, datasetId: string, version: number) {
  const [row] = await db
    .select({
      raw: datasetVersions.raw,
      filename: datasetVersions.rawFilename,
      sha256: sql<string>`encode(${datasetVersions.rawSha256}, 'hex')`,
    })
    .from(datasetVersions)
    .where(and(eq(datasetVersions.datasetId, datasetId), eq(datasetVersions.version, version)));
  return row ?? null;
}
