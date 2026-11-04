// Source Registry, manual (P1-05, PRD v4 §6.2). The founder records official sources with a
// status and a licence. Nothing here fetches anything (Phase 2). Rules:
// - official URL: https, no credentials, no link shorteners or aggregators, unique;
// - "verified" needs a known licence; "attribution_required" needs the credit line;
// - optimistic locking with expectedVersion; every change is audited with field names only.
import { and, asc, desc, eq, sql } from 'drizzle-orm';
import type { NodePgDatabase } from 'drizzle-orm/node-postgres';
import { z } from 'zod';
import {
  LICENSE_STATUSES,
  SOURCE_STATUSES,
  SOURCE_TYPES,
  sourceChecks,
  sources,
} from '../../db/schema.ts';
import type { schema } from '../../db/schema.ts';
import { AppError } from '../../lib/errors.ts';
import { parseOrThrow } from '../../lib/validation.ts';
import { httpsUrl, isAggregatorUrl, plainText } from '../articles/content.ts';
import { recordAudit } from '../audit/audit.ts';
import { enqueue } from '../../worker/queue.ts';

type Db = NodePgDatabase<typeof schema>;

export type SourceStatus = (typeof SOURCE_STATUSES)[number];

/** Empty optional text is stored as null, so "cleared" and "never set" look the same. */
const optionalText = (max: number) =>
  plainText(max)
    .trim()
    .nullable()
    .default(null)
    .transform((value) => (value === null || value === '' ? null : value));

/** A feed may be plain http (many official feeds are); never credentials or other schemes. */
const feedUrl = z
  .string()
  .trim()
  .max(2048)
  .nullable()
  .default(null)
  .transform((value) => (value === null || value === '' ? null : value))
  .refine((value) => {
    if (value === null) return true;
    try {
      const url = new URL(value);
      return (
        (url.protocol === 'https:' || url.protocol === 'http:') &&
        url.username === '' &&
        url.password === '' &&
        !/\s/.test(value)
      );
    } catch {
      return false;
    }
  }, 'http_url_required');

export const sourceInputSchema = z
  .strictObject({
    name: plainText(160).trim().min(2),
    organization: plainText(160).trim().min(2),
    type: z.enum(SOURCE_TYPES),
    officialUrl: httpsUrl.refine((value) => !isAggregatorUrl(value), 'aggregator_url'),
    licenseStatus: z.enum(LICENSE_STATUSES).default('unknown'),
    licenseNote: optionalText(500),
    attribution: optionalText(300),
    status: z.enum(SOURCE_STATUSES).default('candidate'),
    notes: optionalText(1000),
    feedUrl,
  })
  .superRefine((value, context) => {
    if (value.status === 'verified' && value.licenseStatus === 'unknown') {
      context.addIssue({ code: 'custom', path: ['status'], message: 'verified_needs_license' });
    }
    if (value.licenseStatus === 'attribution_required' && value.attribution === null) {
      context.addIssue({ code: 'custom', path: ['attribution'], message: 'attribution_required' });
    }
  });

export type SourceInput = z.infer<typeof sourceInputSchema>;

export interface SourceView {
  readonly id: string;
  readonly name: string;
  readonly organization: string;
  readonly type: string;
  readonly officialUrl: string;
  readonly licenseStatus: string;
  readonly licenseNote: string | null;
  readonly attribution: string | null;
  readonly status: string;
  readonly notes: string | null;
  readonly feedUrl: string | null;
  readonly feedStatus: string;
  readonly feedTitle: string | null;
  readonly feedCheckedAt: Date | null;
  readonly feedError: string | null;
  readonly consecutiveFailures: number;
  readonly version: number;
  readonly createdAt: Date;
  readonly updatedAt: Date;
}

const columns = {
  id: sources.id,
  name: sources.name,
  organization: sources.organization,
  type: sources.type,
  officialUrl: sources.officialUrl,
  licenseStatus: sources.licenseStatus,
  licenseNote: sources.licenseNote,
  attribution: sources.attribution,
  status: sources.status,
  notes: sources.notes,
  feedUrl: sources.feedUrl,
  feedStatus: sources.feedStatus,
  feedTitle: sources.feedTitle,
  feedCheckedAt: sources.feedCheckedAt,
  feedError: sources.feedError,
  consecutiveFailures: sources.consecutiveFailures,
  version: sources.version,
  createdAt: sources.createdAt,
  updatedAt: sources.updatedAt,
};

const EDITABLE = [
  'name',
  'organization',
  'type',
  'officialUrl',
  'licenseStatus',
  'licenseNote',
  'attribution',
  'status',
  'notes',
  'feedUrl',
] as const satisfies readonly (keyof SourceInput)[];

/** A new or changed feed URL starts from scratch: unchecked, no cache validators, no failures. */
const freshFeed = (url: string | null) => ({
  feedStatus: url === null ? ('none' as const) : ('unchecked' as const),
  feedTitle: null,
  feedCheckedAt: null,
  feedError: null,
  consecutiveFailures: 0,
  nextFetchAt: null,
  etag: null,
  lastModified: null,
});

function duplicateField(error: unknown): 'officialUrl' | 'feedUrl' | null {
  const cause = (error as { cause?: unknown }).cause ?? error;
  const { code, constraint } = cause as { code?: unknown; constraint?: unknown };
  if (code !== '23505') return null;
  if (constraint === 'sources_official_url_unique') return 'officialUrl';
  if (constraint === 'sources_feed_url_unique') return 'feedUrl';
  return null;
}

function rethrowDuplicate(error: unknown): never {
  const field = duplicateField(error);
  if (field !== null) throw new AppError('VALIDATION_FAILED', [{ path: field, rule: 'duplicate' }]);
  throw error;
}

export interface Actor {
  readonly userId: string;
  readonly requestId?: string;
}

export async function listSources(
  db: Db,
  options: { readonly status?: SourceStatus } = {},
): Promise<SourceView[]> {
  return db
    .select(columns)
    .from(sources)
    .where(options.status === undefined ? undefined : eq(sources.status, options.status))
    .orderBy(asc(sources.name), asc(sources.id));
}

export async function getSource(db: Db, id: string): Promise<SourceView | null> {
  const [row] = await db.select(columns).from(sources).where(eq(sources.id, id));
  return row ?? null;
}

export async function createSource(db: Db, actor: Actor, raw: unknown): Promise<SourceView> {
  const input = parseOrThrow(sourceInputSchema, raw);
  try {
    return await db.transaction(async (tx) => {
      const [row] = await tx
        .insert(sources)
        .values({ ...input, ...freshFeed(input.feedUrl), createdBy: actor.userId })
        .returning(columns);
      if (row === undefined) throw new Error('insert returned no row');
      await recordAudit(tx, {
        action: 'source.create',
        actorType: 'founder',
        actorId: actor.userId,
        result: 'success',
        resourceType: 'source',
        resourceId: row.id,
        ...(actor.requestId === undefined ? {} : { requestId: actor.requestId }),
        metadata: { version: row.version, status: row.status, license_status: row.licenseStatus },
      });
      return row;
    });
  } catch (error) {
    rethrowDuplicate(error);
  }
}

export async function updateSource(
  db: Db,
  actor: Actor,
  id: string,
  raw: unknown,
  expectedVersion: number,
): Promise<SourceView> {
  const input = parseOrThrow(sourceInputSchema, raw);
  try {
    return await db.transaction(async (tx) => {
      const [current] = await tx
        .select(columns)
        .from(sources)
        .where(eq(sources.id, id))
        .for('update');
      if (current === undefined) throw new AppError('NOT_FOUND');
      if (current.version !== expectedVersion) throw new AppError('VERSION_CONFLICT');
      const changed = EDITABLE.filter((key) => current[key] !== input[key]);
      if (changed.length === 0) {
        throw new AppError('VALIDATION_FAILED', [{ path: 'source', rule: 'unchanged' }]);
      }
      const [row] = await tx
        .update(sources)
        .set({
          ...input,
          ...(changed.includes('feedUrl') ? freshFeed(input.feedUrl) : {}),
          version: sql`${sources.version} + 1`,
          updatedAt: sql`now()`,
        })
        .where(and(eq(sources.id, id), eq(sources.version, expectedVersion)))
        .returning(columns);
      if (row === undefined) throw new AppError('VERSION_CONFLICT');
      await recordAudit(tx, {
        action: 'source.update',
        actorType: 'founder',
        actorId: actor.userId,
        result: 'success',
        resourceType: 'source',
        resourceId: row.id,
        ...(actor.requestId === undefined ? {} : { requestId: actor.requestId }),
        metadata: {
          version: row.version,
          status: row.status,
          license_status: row.licenseStatus,
          changed: changed.join(','),
        },
      });
      return row;
    });
  } catch (error) {
    rethrowDuplicate(error);
  }
}

export interface SourceCheckView {
  readonly ok: boolean;
  readonly httpStatus: number | null;
  readonly feedFormat: string | null;
  readonly itemCount: number | null;
  readonly error: string | null;
  readonly durationMs: number | null;
  readonly checkedAt: Date;
}

export async function listSourceChecks(
  db: Db,
  sourceId: string,
  limit = 10,
): Promise<SourceCheckView[]> {
  return db
    .select({
      ok: sourceChecks.ok,
      httpStatus: sourceChecks.httpStatus,
      feedFormat: sourceChecks.feedFormat,
      itemCount: sourceChecks.itemCount,
      error: sourceChecks.error,
      durationMs: sourceChecks.durationMs,
      checkedAt: sourceChecks.checkedAt,
    })
    .from(sourceChecks)
    .where(eq(sourceChecks.sourceId, sourceId))
    .orderBy(desc(sourceChecks.checkedAt), desc(sourceChecks.id))
    .limit(limit);
}

/**
 * Ask the worker to check this source's feed now. Only a verified source with a feed URL; the
 * worker checks the status again when it runs. Returns false when a check is already queued.
 */
export async function requestFeedCheck(db: Db, actor: Actor, id: string): Promise<boolean> {
  return db.transaction(async (tx) => {
    const [source] = await tx
      .select({ status: sources.status, feedUrl: sources.feedUrl })
      .from(sources)
      .where(eq(sources.id, id));
    if (source === undefined) throw new AppError('NOT_FOUND');
    if (source.feedUrl === null) {
      throw new AppError('VALIDATION_FAILED', [{ path: 'feedUrl', rule: 'missing' }]);
    }
    if (source.status !== 'verified') {
      throw new AppError('VALIDATION_FAILED', [{ path: 'status', rule: 'not_verified' }]);
    }
    const queued =
      (await enqueue(tx, { kind: 'feed_check', subjectId: id, maxAttempts: 1 })) !== null;
    await recordAudit(tx, {
      action: 'source.check_feed',
      actorType: 'founder',
      actorId: actor.userId,
      result: 'success',
      resourceType: 'source',
      resourceId: id,
      ...(actor.requestId === undefined ? {} : { requestId: actor.requestId }),
      metadata: { queued },
    });
    return queued;
  });
}
