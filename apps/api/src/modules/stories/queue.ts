// Proposal queue (P5-02, Phase 5 PLAN, D-31): the radar's best stories, handed to the Penulis
// agent one at a time, within quotas. Rules live in code, not in the prompt:
//   - only stories scoring MIN_SCORE or more; during quiet hours (01-05 WIB) only breaking ones;
//   - at most MAX_PER_HOUR / MAX_PER_DAY stories, counted from the queue itself;
//   - the draft may cite ONLY the story's own numbered materials (lesson from VORSA × SENTINEL);
//   - it needs a primary official source or two independent organisations, else it is refused;
//   - citations are never marked as checked: the founder's tap does that (P5-03).
import { randomUUID } from 'node:crypto';
import { and, eq, gt, inArray, lt, sql } from 'drizzle-orm';
import type { NodePgDatabase } from 'drizzle-orm/node-postgres';
import { z } from 'zod';
import { categories, discoveredItems, sources, storyQueue, users } from '../../db/schema.ts';
import type { schema } from '../../db/schema.ts';
import { AppError } from '../../lib/errors.ts';
import { parseOrThrow } from '../../lib/validation.ts';
import { createDraft } from '../articles/articles.ts';
import { plainText } from '../articles/content.ts';
import { parseMarkdown } from '../articles/markdown.ts';
import { getAiSettings, usageToday } from '../agent/settings.ts';
import { loadRadar } from '../radar/radar.ts';
import { inQuietHours } from '../radar/score.ts';
import type { Story } from '../radar/score.ts';

type Db = NodePgDatabase<typeof schema>;

export const MIN_SCORE = 55;
export const MAX_PER_HOUR = 3;
export const MAX_PER_DAY = 12;
/** A story the agent took but never finished goes back to nobody after this. */
export const DRAFTING_TIMEOUT_MINUTES = 120;
/** Source types whose own release is a primary source. */
export const OFFICIAL_TYPES = new Set([
  'statistics',
  'central_bank',
  'ministry',
  'regulator',
  'legislation',
]);

export interface Material {
  /** 1-based: what `sumber: N` and `sources` refer to. */
  readonly number: number;
  readonly itemId: string;
  readonly url: string;
  readonly title: string;
  readonly summary: string;
  readonly publishedAt: Date | null;
  readonly publisher: string;
  readonly official: boolean;
}

export interface QueuedStory {
  readonly queueId: string;
  readonly title: string;
  readonly score: number;
  readonly breaking: boolean;
  readonly materials: readonly Material[];
}

export type NextResult =
  | { readonly story: QueuedStory }
  | {
      readonly story: null;
      readonly reason: 'quota_hour' | 'quota_day' | 'quiet_hours' | 'nothing_new';
    };

async function materialsFor(db: Db, itemIds: readonly string[]): Promise<Material[]> {
  if (itemIds.length === 0) return [];
  const rows = await db
    .select({
      id: discoveredItems.id,
      url: discoveredItems.canonicalUrl,
      title: discoveredItems.title,
      summary: discoveredItems.summary,
      publishedAt: discoveredItems.publishedAt,
      organization: sources.organization,
      type: sources.type,
    })
    .from(discoveredItems)
    .innerJoin(sources, eq(sources.id, discoveredItems.sourceId))
    .where(inArray(discoveredItems.id, [...itemIds]));
  const byId = new Map(rows.map((row) => [row.id, row]));
  return itemIds
    .flatMap((id) => {
      const row = byId.get(id);
      return row === undefined
        ? []
        : [
            {
              itemId: row.id,
              url: row.url,
              title: row.title,
              summary: row.summary,
              publishedAt: row.publishedAt,
              publisher: row.organization,
              official: OFFICIAL_TYPES.has(row.type),
            },
          ];
    })
    .map((material, index) => ({ ...material, number: index + 1 }));
}

/** Official sources first, then newest: the order the materials are numbered in. */
function orderedItemIds(story: Story): string[] {
  return [...story.items]
    .sort(
      (a, b) =>
        Number(OFFICIAL_TYPES.has(b.source.type)) - Number(OFFICIAL_TYPES.has(a.source.type)) ||
        (b.publishedAt ?? b.firstSeenAt).getTime() - (a.publishedAt ?? a.firstSeenAt).getTime(),
    )
    .slice(0, 12)
    .map((item) => item.id);
}

/**
 * The story the agent should work on: the one it already holds, or the best new one within the
 * quotas (which is then recorded, so it counts and is never handed out twice).
 */
export async function nextStory(db: Db, now = new Date()): Promise<NextResult> {
  // A story held too long is released (expired) so the queue never stalls.
  await db
    .update(storyQueue)
    .set({ status: 'expired', note: 'Tidak selesai dalam batas waktu.', updatedAt: now })
    .where(
      and(
        eq(storyQueue.status, 'drafting'),
        lt(storyQueue.queuedAt, new Date(now.getTime() - DRAFTING_TIMEOUT_MINUTES * 60_000)),
      ),
    );
  const [held] = await db
    .select()
    .from(storyQueue)
    .where(eq(storyQueue.status, 'drafting'))
    .orderBy(storyQueue.queuedAt)
    .limit(1);
  if (held !== undefined) {
    return {
      story: {
        queueId: held.id,
        title: held.title,
        score: held.score,
        breaking: held.breaking,
        materials: await materialsFor(db, held.itemIds),
      },
    };
  }

  const count = async (since: Date) =>
    (
      await db
        .select({ n: sql<number>`count(*)::int` })
        .from(storyQueue)
        .where(gt(storyQueue.queuedAt, since))
    )[0]?.n ?? 0;
  const hourAgo = new Date(now.getTime() - 3_600_000);
  const dayAgo = new Date(now.getTime() - 86_400_000);
  if ((await count(dayAgo)) >= MAX_PER_DAY) return { story: null, reason: 'quota_day' };
  if ((await count(hourAgo)) >= MAX_PER_HOUR) return { story: null, reason: 'quota_hour' };

  const quiet = inQuietHours(now);
  const radar = await loadRadar(db, { now, limit: 30 });
  const candidates = radar.stories.filter(
    (story) => story.score >= MIN_SCORE && (!quiet || story.breaking),
  );
  for (const story of candidates) {
    const itemIds = orderedItemIds(story);
    // Never a story already queued, nor one sharing an item with an earlier queue entry.
    const [taken] = await db
      .select({ id: storyQueue.id })
      .from(storyQueue)
      .where(
        sql`${storyQueue.storyKey} = ${story.id} OR ${storyQueue.itemIds} && ARRAY[${sql.join(
          itemIds.map((id) => sql`${id}`),
          sql`, `,
        )}]::uuid[]`,
      )
      .limit(1);
    if (taken !== undefined) continue;
    const [row] = await db
      .insert(storyQueue)
      .values({
        storyKey: story.id,
        title: story.title.slice(0, 300),
        itemIds,
        score: story.score,
        breaking: story.breaking,
        queuedAt: now,
        updatedAt: now,
      })
      .onConflictDoNothing({ target: storyQueue.storyKey })
      .returning({ id: storyQueue.id });
    if (row === undefined) continue;
    return {
      story: {
        queueId: row.id,
        title: story.title,
        score: story.score,
        breaking: story.breaking,
        materials: await materialsFor(db, itemIds),
      },
    };
  }
  return { story: null, reason: quiet && candidates.length === 0 ? 'quiet_hours' : 'nothing_new' };
}

const numbers = z.array(z.int().min(1).max(12)).max(12);

export const submitSchema = z.strictObject({
  queueId: z.uuid(),
  categorySlug: z.string().max(60),
  title: plainText(200).trim().min(5),
  dek: plainText(400).trim(),
  bodySource: z.string().max(40_000),
  /** Material numbers to cite, in the order `sumber: N` uses them in the body. */
  sources: numbers.min(1),
  /** Which of those are primary (must be official sources). */
  primary: numbers.default([]),
});

export interface AgentContext {
  readonly requestId: string;
  readonly role: string;
}

/** Enough independent support: one primary official source, or two separate organisations. */
export function hasEnoughSources(cited: readonly Material[], primary: ReadonlySet<number>) {
  if (cited.some((material) => material.official && primary.has(material.number))) return true;
  return new Set(cited.map((material) => material.publisher.toLowerCase())).size >= 2;
}

export async function submitDraft(
  db: Db,
  context: AgentContext,
  raw: unknown,
): Promise<{ articleId: string; version: number }> {
  const input = parseOrThrow(submitSchema, raw);
  const settings = await getAiSettings(db);
  if ((await usageToday(db)).drafts >= settings.dailyDraftQuota) {
    throw new AppError('QUOTA_EXCEEDED');
  }
  const [entry] = await db.select().from(storyQueue).where(eq(storyQueue.id, input.queueId));
  if (entry?.status !== 'drafting') throw new AppError('FORBIDDEN');
  const materials = await materialsFor(db, entry.itemIds);
  const byNumber = new Map(materials.map((material) => [material.number, material]));
  const order = [...new Set(input.sources)];
  const cited = order.map((number) => byNumber.get(number));
  // Only the story's own numbered materials can be cited: nothing invented, nothing outside.
  if (cited.some((material) => material === undefined)) {
    throw new AppError('VALIDATION_FAILED', [{ path: 'sources', rule: 'unknown_material' }]);
  }
  const citedMaterials = cited.filter((material): material is Material => material !== undefined);
  const primary = new Set(input.primary);
  for (const number of primary) {
    const material = byNumber.get(number);
    if (material === undefined || !material.official || !order.includes(number)) {
      throw new AppError('VALIDATION_FAILED', [{ path: 'primary', rule: 'not_official' }]);
    }
  }
  if (!hasEnoughSources(citedMaterials, primary)) {
    throw new AppError('VALIDATION_FAILED', [{ path: 'sources', rule: 'insufficient' }]);
  }
  const [category] = await db
    .select({ id: categories.id })
    .from(categories)
    .where(eq(categories.slug, input.categorySlug));
  if (category === undefined) {
    throw new AppError('VALIDATION_FAILED', [{ path: 'categorySlug', rule: 'unknown' }]);
  }
  const [founder] = await db.select({ id: users.id }).from(users).where(eq(users.role, 'founder'));
  if (founder === undefined) throw new AppError('NOT_READY');

  const citationIds = citedMaterials.map(() => randomUUID());
  const parsed = parseMarkdown(input.bodySource, { citationIds });
  if (parsed.issues.length > 0) {
    throw new AppError('VALIDATION_FAILED', [{ path: 'bodySource', rule: 'markdown' }]);
  }
  const accessedAt = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Jakarta' }).format(
    new Date(),
  );
  const saved = await createDraft(
    db,
    { userId: founder.id, requestId: context.requestId, agentRole: context.role },
    {
      content: {
        title: input.title,
        dek: input.dek,
        articleType: 'explainer',
        categoryId: category.id,
        body: parsed.blocks,
        bodySource: input.bodySource,
        methodNote: null,
        citations: citedMaterials.map((material, index) => ({
          id: citationIds[index] ?? randomUUID(),
          url: material.url,
          publisher: material.publisher,
          title: material.title.slice(0, 300),
          accessedAt,
          claimNote: '',
          primary: primary.has(material.number),
          // Never checked by the agent: the founder's tap does that (P5-03).
          verified: false,
        })),
      },
      changeNote: `Draft dari antrean Radar (skor ${String(entry.score)}), ditulis agent Penulis. Wajib dicek founder.`,
    },
  );
  await db.transaction(async (tx) => {
    await tx
      .update(storyQueue)
      .set({ status: 'drafted', articleId: saved.articleId, updatedAt: sql`now()` })
      .where(and(eq(storyQueue.id, entry.id), eq(storyQueue.status, 'drafting')));
    await tx
      .update(discoveredItems)
      .set({ status: 'used', statusChangedAt: sql`now()` })
      .where(inArray(discoveredItems.id, entry.itemIds));
  });
  return { articleId: saved.articleId, version: saved.version };
}

export const skipSchema = z.strictObject({
  queueId: z.uuid(),
  reason: plainText(1000).trim().min(3),
});

/** The agent decides a story is not worth a NALARA piece (or cannot be supported). */
export async function skipStory(db: Db, raw: unknown): Promise<void> {
  const input = parseOrThrow(skipSchema, raw);
  const rows = await db
    .update(storyQueue)
    .set({ status: 'skipped', note: input.reason, updatedAt: sql`now()` })
    .where(and(eq(storyQueue.id, input.queueId), eq(storyQueue.status, 'drafting')))
    .returning({ id: storyQueue.id });
  if (rows.length === 0) throw new AppError('FORBIDDEN');
}

export interface QueueRow {
  readonly id: string;
  readonly title: string;
  readonly score: number;
  readonly breaking: boolean;
  readonly status: string;
  readonly articleId: string | null;
  readonly note: string | null;
  readonly queuedAt: Date;
}

/** The founder's view of the queue: newest first. */
export async function listQueue(db: Db, limit = 30): Promise<QueueRow[]> {
  return db
    .select({
      id: storyQueue.id,
      title: storyQueue.title,
      score: storyQueue.score,
      breaking: storyQueue.breaking,
      status: storyQueue.status,
      articleId: storyQueue.articleId,
      note: storyQueue.note,
      queuedAt: storyQueue.queuedAt,
    })
    .from(storyQueue)
    .orderBy(sql`${storyQueue.queuedAt} DESC`)
    .limit(limit);
}
