// Inbox (P2-06): what the feeds found, for the founder to look at. Material to check, never
// content: items are never public, and "create a draft" starts an article with a citation to the
// original (URL, publisher, title, date accessed) and an empty template, never the publisher's
// text. The citation is not marked as checked: the founder still opens and verifies the source.
import { and, desc, eq, lt, or, sql } from 'drizzle-orm';
import type { SQL } from 'drizzle-orm';
import type { NodePgDatabase } from 'drizzle-orm/node-postgres';
import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import { discoveredItems, sources } from '../../db/schema.ts';
import type { schema, INBOX_STATUSES } from '../../db/schema.ts';
import { AppError } from '../../lib/errors.ts';
import { parseOrThrow } from '../../lib/validation.ts';
import { createDraft } from '../articles/articles.ts';
import { parseMarkdown } from '../articles/markdown.ts';
import { recordAudit } from '../audit/audit.ts';

type Db = NodePgDatabase<typeof schema>;
export type InboxStatus = (typeof INBOX_STATUSES)[number];

export const INBOX_PAGE = 50;

/** Headings only: the founder writes the article in their own words. */
export const DRAFT_TEMPLATE = [
  '## Apa yang terjadi',
  '',
  '## Kenapa penting',
  '',
  '## Konteks',
  '',
  '## Data dan angka',
  '',
  '## Apa selanjutnya',
].join('\n');

export interface InboxItem {
  readonly id: string;
  readonly title: string;
  readonly url: string;
  readonly summary: string;
  readonly publishedAt: Date | null;
  readonly firstSeenAt: Date;
  readonly status: string;
  readonly source: { readonly id: string; readonly name: string; readonly organization: string };
  /** Other sources that carried the same story (same title fingerprint). */
  readonly alsoIn: number;
}

const cursorSchema = z.strictObject({ t: z.iso.datetime(), i: z.uuid() });

function decodeCursor(cursor: string) {
  try {
    const parsed = cursorSchema.parse(
      JSON.parse(Buffer.from(cursor, 'base64url').toString('utf8')),
    );
    return { at: new Date(parsed.t), id: parsed.i };
  } catch {
    throw new AppError('VALIDATION_FAILED', [{ path: 'cursor', rule: 'invalid' }]);
  }
}

export async function listInbox(
  db: Db,
  options: { readonly status?: InboxStatus; readonly sourceId?: string; readonly cursor?: string },
): Promise<{ items: InboxItem[]; nextCursor: string | null }> {
  const conditions: SQL[] = [eq(discoveredItems.status, options.status ?? 'new')];
  if (options.sourceId !== undefined)
    conditions.push(eq(discoveredItems.sourceId, options.sourceId));
  if (options.cursor !== undefined) {
    const after = decodeCursor(options.cursor);
    const older = or(
      lt(discoveredItems.firstSeenAt, after.at),
      and(eq(discoveredItems.firstSeenAt, after.at), lt(discoveredItems.id, after.id)),
    );
    if (older !== undefined) conditions.push(older);
  }
  const rows = await db
    .select({
      id: discoveredItems.id,
      title: discoveredItems.title,
      url: discoveredItems.canonicalUrl,
      summary: discoveredItems.summary,
      publishedAt: discoveredItems.publishedAt,
      firstSeenAt: discoveredItems.firstSeenAt,
      status: discoveredItems.status,
      sourceId: sources.id,
      sourceName: sources.name,
      organization: sources.organization,
      alsoIn: sql<number>`(
        SELECT count(DISTINCT other.source_id)::int FROM discovered_items other
        WHERE other.fingerprint = ${discoveredItems.fingerprint}
          AND other.source_id <> ${discoveredItems.sourceId}
      )`,
    })
    .from(discoveredItems)
    .innerJoin(sources, eq(sources.id, discoveredItems.sourceId))
    .where(and(...conditions))
    .orderBy(desc(discoveredItems.firstSeenAt), desc(discoveredItems.id))
    .limit(INBOX_PAGE + 1);
  const page = rows.slice(0, INBOX_PAGE);
  const last = page.at(-1);
  return {
    items: page.map((row) => ({
      id: row.id,
      title: row.title,
      url: row.url,
      summary: row.summary,
      publishedAt: row.publishedAt,
      firstSeenAt: row.firstSeenAt,
      status: row.status,
      source: { id: row.sourceId, name: row.sourceName, organization: row.organization },
      alsoIn: row.alsoIn,
    })),
    nextCursor:
      rows.length > INBOX_PAGE && last !== undefined
        ? Buffer.from(JSON.stringify({ t: last.firstSeenAt.toISOString(), i: last.id })).toString(
            'base64url',
          )
        : null,
  };
}

export async function countNewInbox(db: Db): Promise<number> {
  const [row] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(discoveredItems)
    .where(eq(discoveredItems.status, 'new'));
  return row?.count ?? 0;
}

export interface Actor {
  readonly userId: string;
  readonly requestId?: string;
}

/** Seen / dismissed / back to new. "used" is set only by createDraftFromItem. */
export async function setInboxStatus(
  db: Db,
  actor: Actor,
  id: string,
  status: 'new' | 'seen' | 'dismissed',
): Promise<void> {
  await db.transaction(async (tx) => {
    const rows = await tx
      .update(discoveredItems)
      .set({ status, statusChangedAt: sql`now()` })
      .where(eq(discoveredItems.id, id))
      .returning({ id: discoveredItems.id });
    if (rows.length === 0) throw new AppError('NOT_FOUND');
    await recordAudit(tx, {
      action: 'inbox.status',
      actorType: 'founder',
      actorId: actor.userId,
      result: 'success',
      resourceType: 'discovered_item',
      resourceId: id,
      ...(actor.requestId === undefined ? {} : { requestId: actor.requestId }),
      metadata: { status },
    });
  });
}

const draftSchema = z.strictObject({ categoryId: z.uuid() });

/** Today in Asia/Jakarta as YYYY-MM-DD (the citation's "accessed" date). */
function jakartaToday(): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Jakarta' }).format(new Date());
}

/**
 * A draft that cites the item and starts from an empty template. Two steps (the draft has its
 * own transaction): if marking the item fails afterwards, it simply stays in the inbox.
 */
export async function createDraftFromItem(
  db: Db,
  actor: Actor,
  id: string,
  raw: unknown,
): Promise<{ articleId: string }> {
  const { categoryId } = parseOrThrow(draftSchema, raw);
  const [item] = await db
    .select({
      title: discoveredItems.title,
      url: discoveredItems.canonicalUrl,
      organization: sources.organization,
    })
    .from(discoveredItems)
    .innerJoin(sources, eq(sources.id, discoveredItems.sourceId))
    .where(eq(discoveredItems.id, id));
  if (item === undefined) throw new AppError('NOT_FOUND');
  const citationId = randomUUID();
  const { blocks } = parseMarkdown(DRAFT_TEMPLATE, { citationIds: [citationId] });
  const saved = await createDraft(db, actor, {
    content: {
      // A working title for the founder to rewrite; never published as is (review + approval).
      title: item.title,
      dek: '',
      articleType: 'explainer',
      categoryId,
      body: blocks,
      bodySource: DRAFT_TEMPLATE,
      methodNote: null,
      citations: [
        {
          id: citationId,
          url: item.url,
          publisher: item.organization,
          title: item.title,
          accessedAt: jakartaToday(),
          claimNote: '',
          primary: false,
          verified: false,
        },
      ],
    },
    changeNote: 'Draft dari inbox',
  });
  await db.transaction(async (tx) => {
    await tx
      .update(discoveredItems)
      .set({ status: 'used', statusChangedAt: sql`now()` })
      .where(eq(discoveredItems.id, id));
    await recordAudit(tx, {
      action: 'inbox.draft',
      actorType: 'founder',
      actorId: actor.userId,
      result: 'success',
      resourceType: 'discovered_item',
      resourceId: id,
      ...(actor.requestId === undefined ? {} : { requestId: actor.requestId }),
      metadata: { article: saved.articleId },
    });
  });
  return { articleId: saved.articleId };
}
