// Media library (P1-09, ADR-020, PRD v4 §7). Upload → recognise by magic bytes → strip metadata →
// store in PostgreSQL. Alt text is required at upload; licence and credit line may come later, but
// an image without both cannot be published (gate) and is never served to the public.
import { createHash } from 'node:crypto';
import { and, desc, eq, inArray, sql } from 'drizzle-orm';
import type { NodePgDatabase } from 'drizzle-orm/node-postgres';
import { z } from 'zod';
import { USAGE_BASES, articleRevisions, articles, mediaAssets } from '../../db/schema.ts';
import type { schema } from '../../db/schema.ts';
import { AppError } from '../../lib/errors.ts';
import { parseOrThrow } from '../../lib/validation.ts';
import { plainText } from '../articles/content.ts';
import type { Block } from '../articles/content.ts';
import type { GateMedia } from '../articles/gate.ts';
import { recordAudit } from '../audit/audit.ts';
import { ImageError, cleanImage } from './image.ts';

type Db = NodePgDatabase<typeof schema>;
type Reader = Pick<Db, 'select'>;

/** Largest stored image after stripping. */
export const MAX_IMAGE_BYTES = 5 * 1024 * 1024;
/** Base64 of MAX_IMAGE_BYTES plus room for the descriptive fields: the upload route's limit. */
export const MEDIA_UPLOAD_BODY_LIMIT = Math.ceil((MAX_IMAGE_BYTES * 4) / 3) + 64 * 1024;

const optionalText = (min: number, max: number) =>
  plainText(max)
    .trim()
    .nullable()
    .default(null)
    .transform((value) => (value === null || value === '' ? null : value))
    .refine((value) => value === null || value.length >= min, 'too_small');

const describeFields = {
  altText: plainText(300).trim().min(5),
  caption: optionalText(1, 300),
  usageBasis: z.enum(USAGE_BASES),
  license: optionalText(2, 200),
  attribution: optionalText(2, 300),
};

export const describeSchema = z.strictObject(describeFields);

const BASE64 = /^[A-Za-z0-9+/]*={0,2}$/;

export const uploadSchema = z.strictObject({
  ...describeFields,
  /** The file, base64 (standard alphabet). The API is JSON-only (ADR-011). */
  data: z
    .string()
    .max(Math.ceil((MAX_IMAGE_BYTES * 4) / 3) + 4)
    .refine((value) => value.length % 4 === 0 && BASE64.test(value), 'base64_invalid'),
});

export interface MediaView {
  readonly id: string;
  readonly mime: string;
  readonly width: number;
  readonly height: number;
  readonly byteSize: number;
  readonly altText: string;
  readonly caption: string | null;
  readonly usageBasis: string;
  readonly license: string | null;
  readonly attribution: string | null;
  readonly version: number;
  readonly createdAt: Date;
  readonly updatedAt: Date;
}

const columns = {
  id: mediaAssets.id,
  mime: mediaAssets.mime,
  width: mediaAssets.width,
  height: mediaAssets.height,
  byteSize: mediaAssets.byteSize,
  altText: mediaAssets.altText,
  caption: mediaAssets.caption,
  usageBasis: mediaAssets.usageBasis,
  license: mediaAssets.license,
  attribution: mediaAssets.attribution,
  version: mediaAssets.version,
  createdAt: mediaAssets.createdAt,
  updatedAt: mediaAssets.updatedAt,
};

const DESCRIBED = ['altText', 'caption', 'usageBasis', 'license', 'attribution'] as const;

export interface Actor {
  readonly userId: string;
  readonly requestId?: string;
}

const licensed = (row: { license: string | null; attribution: string | null }) =>
  row.license !== null && row.attribution !== null;

export async function uploadMedia(db: Db, actor: Actor, raw: unknown): Promise<MediaView> {
  const { data, ...describe } = parseOrThrow(uploadSchema, raw);
  const decoded = Buffer.from(data, 'base64');
  if (decoded.length === 0) {
    throw new AppError('VALIDATION_FAILED', [{ path: 'data', rule: 'empty' }]);
  }
  let image;
  try {
    image = cleanImage(decoded);
  } catch (error) {
    if (error instanceof ImageError) {
      throw new AppError('VALIDATION_FAILED', [{ path: 'data', rule: error.rule }]);
    }
    throw error;
  }
  if (image.bytes.length > MAX_IMAGE_BYTES) {
    throw new AppError('VALIDATION_FAILED', [{ path: 'data', rule: 'too_big' }]);
  }
  return db.transaction(async (tx) => {
    const [row] = await tx
      .insert(mediaAssets)
      .values({
        ...describe,
        mime: image.mime,
        width: image.width,
        height: image.height,
        byteSize: image.bytes.length,
        data: image.bytes,
        sha256: createHash('sha256').update(image.bytes).digest(),
        createdBy: actor.userId,
      })
      .returning(columns);
    if (row === undefined) throw new Error('insert returned no row');
    await recordAudit(tx, {
      action: 'media.upload',
      actorType: 'founder',
      actorId: actor.userId,
      result: 'success',
      resourceType: 'media',
      resourceId: row.id,
      ...(actor.requestId === undefined ? {} : { requestId: actor.requestId }),
      metadata: {
        mime: row.mime,
        width: row.width,
        height: row.height,
        bytes: row.byteSize,
        usage_basis: row.usageBasis,
        licensed: licensed(row),
        removed: [...image.removed].sort().join(','),
      },
    });
    return row;
  });
}

export async function updateMedia(
  db: Db,
  actor: Actor,
  id: string,
  raw: unknown,
  expectedVersion: number,
): Promise<MediaView> {
  const input = parseOrThrow(describeSchema, raw);
  return db.transaction(async (tx) => {
    const [current] = await tx
      .select(columns)
      .from(mediaAssets)
      .where(eq(mediaAssets.id, id))
      .for('update');
    if (current === undefined) throw new AppError('NOT_FOUND');
    if (current.version !== expectedVersion) throw new AppError('VERSION_CONFLICT');
    const changed = DESCRIBED.filter((key) => current[key] !== input[key]);
    if (changed.length === 0) {
      throw new AppError('VALIDATION_FAILED', [{ path: 'media', rule: 'unchanged' }]);
    }
    const [row] = await tx
      .update(mediaAssets)
      .set({ ...input, version: sql`${mediaAssets.version} + 1`, updatedAt: sql`now()` })
      .where(and(eq(mediaAssets.id, id), eq(mediaAssets.version, expectedVersion)))
      .returning(columns);
    if (row === undefined) throw new AppError('VERSION_CONFLICT');
    await recordAudit(tx, {
      action: 'media.update',
      actorType: 'founder',
      actorId: actor.userId,
      result: 'success',
      resourceType: 'media',
      resourceId: row.id,
      ...(actor.requestId === undefined ? {} : { requestId: actor.requestId }),
      metadata: {
        version: row.version,
        usage_basis: row.usageBasis,
        licensed: licensed(row),
        changed: changed.join(','),
      },
    });
    return row;
  });
}

export async function listMedia(db: Reader, limit = 100): Promise<MediaView[]> {
  return db
    .select(columns)
    .from(mediaAssets)
    .orderBy(desc(mediaAssets.createdAt), desc(mediaAssets.id))
    .limit(Math.min(Math.max(limit, 1), 200));
}

export async function getMedia(db: Reader, id: string): Promise<MediaView | null> {
  const [row] = await db.select(columns).from(mediaAssets).where(eq(mediaAssets.id, id));
  return row ?? null;
}

export interface MediaFile {
  readonly mime: string;
  readonly data: Buffer;
  readonly sha256: Buffer;
}

/** The bytes, for the founder's previews. */
export async function getMediaFile(db: Reader, id: string): Promise<MediaFile | null> {
  const [row] = await db
    .select({ mime: mediaAssets.mime, data: mediaAssets.data, sha256: mediaAssets.sha256 })
    .from(mediaAssets)
    .where(eq(mediaAssets.id, id));
  return row ?? null;
}

/**
 * The bytes for readers: only when the image is licensed and credited AND used by the approved
 * revision of a published article. Anything else is "not found", exactly like an unknown id.
 */
export async function getPublicMediaFile(db: Reader, id: string): Promise<MediaFile | null> {
  const used = sql`EXISTS (
    SELECT 1 FROM ${articles}
    JOIN ${articleRevisions} ON ${articleRevisions.id} = ${articles.approvedRevisionId}
    WHERE ${articles.status} = 'published'
      AND ${articleRevisions.body} @> ${JSON.stringify([{ type: 'image', mediaId: id }])}::jsonb
  )`;
  const [row] = await db
    .select({ mime: mediaAssets.mime, data: mediaAssets.data, sha256: mediaAssets.sha256 })
    .from(mediaAssets)
    .where(
      and(
        eq(mediaAssets.id, id),
        sql`${mediaAssets.license} IS NOT NULL`,
        sql`${mediaAssets.attribution} IS NOT NULL`,
        used,
      ),
    );
  return row ?? null;
}

export const imageIds = (body: readonly Block[]): string[] => [
  ...new Set(body.flatMap((block) => (block.type === 'image' ? [block.mediaId] : []))),
];

/** What readers and previews need to draw each image an article uses. */
export interface MediaRender {
  readonly altText: string;
  readonly caption: string | null;
  readonly attribution: string | null;
  readonly width: number;
  readonly height: number;
  readonly aiGenerated: boolean;
  readonly licensed: boolean;
}

export async function mediaForBody(
  db: Reader,
  body: readonly Block[],
): Promise<Map<string, MediaRender & GateMedia>> {
  const ids = imageIds(body);
  if (ids.length === 0) return new Map();
  const rows = await db.select(columns).from(mediaAssets).where(inArray(mediaAssets.id, ids));
  return new Map(
    rows.map((row) => [
      row.id,
      {
        altText: row.altText,
        caption: row.caption,
        attribution: row.attribution,
        license: row.license,
        width: row.width,
        height: row.height,
        aiGenerated: row.usageBasis === 'ai_generated',
        licensed: licensed(row),
      },
    ]),
  );
}

/** Refuse a body that points at images the library does not have (with the block position). */
export async function assertMediaExist(db: Reader, body: readonly Block[]): Promise<void> {
  const ids = imageIds(body);
  if (ids.length === 0) return;
  const found = await mediaForBody(db, body);
  if (ids.some((id) => !found.has(id))) {
    throw new AppError('VALIDATION_FAILED', [{ path: 'bodySource', rule: 'image_media_unknown' }]);
  }
}
