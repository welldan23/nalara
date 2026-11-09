// The proposal package on Telegram (P5-03, D-32 "campuran").
//
// Worker side (the only process that reaches Telegram): a drafted story is sent once all its cited
// sources are archived as evidence. A source that cannot be archived ends the story (skipped).
//   route fast   = the draft cites a primary official source. Buttons: ✅ "Sumber sudah kucek,
//                  terbitkan" and ❌ "Lewati".
//   route review = media sources only. No ✅ here: the founder checks the sources and publishes in
//                  the OS. Button: ❌ "Lewati".
// API side (webhook): a token is single use, expires within a day and acts only on the revision
// that was shown. ✅ records the founder's source check as a new revision (citations marked
// checked), then runs the normal workflow (submit, approve, publish) as the founder, so every
// publish gate still applies.
import { createHash, randomBytes } from 'node:crypto';
import { and, asc, eq, inArray, isNotNull, isNull, lt, or, sql } from 'drizzle-orm';
import type { NodePgDatabase } from 'drizzle-orm/node-postgres';
import {
  articleRevisions,
  articles,
  evidenceSnapshots,
  storyQueue,
  storyTokens,
} from '../../db/schema.ts';
import type { schema } from '../../db/schema.ts';
import { AppError } from '../../lib/errors.ts';
import { saveRevision } from '../articles/articles.ts';
import type { Actor } from '../articles/articles.ts';
import { transition } from '../articles/workflow.ts';
import { callBot, TelegramError } from '../telegram/bot.ts';
import type { BotOptions } from '../telegram/bot.ts';

type Db = NodePgDatabase<typeof schema>;
export type StoryDecision = 'publish' | 'skip';
export type Route = 'fast' | 'review';

export const STORY_TOKEN_PATTERN = /^[A-Za-z0-9_-]{22}$/;
// Telegram allows 4096; the worker appends the OS link.
const MAX_MESSAGE = 3800;
/** Pemeriksa runs every 30 minutes by default (AGENT_INTERVAL_SECONDS); some slack on top. */
export const CHECK_WAIT_MINUTES = 45;
const hash = (token: string) => createHash('sha256').update(token, 'utf8').digest();

interface CitationLike {
  readonly url: string;
  readonly publisher: string;
  readonly primary: boolean;
}

/** Fast only with a primary source; the queue already refuses media marked primary (P5-02). */
export function routeFor(citations: readonly CitationLike[]): Route {
  return citations.some((citation) => citation.primary) ? 'fast' : 'review';
}

const clip = (text: string, max: number) => (text.length > max ? `${text.slice(0, max)}…` : text);

/** Plain text (no parse_mode): nothing the AI wrote can turn into markup or a hidden link. */
export function storyMessage(input: {
  readonly number: number;
  readonly title: string;
  readonly dek: string;
  readonly score: number;
  readonly route: Route;
  readonly bodySource: string;
  readonly citations: readonly CitationLike[];
  /** P5-09: the Pemeriksa agent's outcome, as decided by the API. */
  readonly check?: string;
}): string {
  const sources = input.citations.map(
    (citation, index) =>
      `${String(index + 1)}. ${citation.publisher}${citation.primary ? ' (primer)' : ''}: ${citation.url}`,
  );
  const head = [
    `Usulan #${String(input.number)} NALARA (skor ${String(input.score)})`,
    '',
    input.title,
    input.dek === '' ? null : input.dek,
    '',
    'Sumber (sudah diarsipkan sebagai bukti):',
    ...sources,
    '',
    ...(input.check === undefined ? [] : [`Pemeriksa AI: ${input.check}`, '']),
    input.route === 'fast'
      ? 'Ada sumber resmi primer. Buka dan cek sumbernya, lalu tekan ✅ untuk mencatat bahwa kamu sudah mengecek dan menerbitkan versi ini.'
      : 'Sumbernya media saja. Cek dan terbitkan dari NALARA OS (tombol ✅ sengaja tidak ada di sini).',
    '',
    `Edit cepat di chat ini: "judul ${String(input.number)}: …", "ringkas ${String(input.number)}: …", "lihat ${String(input.number)}".`,
    '',
    'Isi draft (ditulis AI, baca dengan kritis):',
  ].filter((line): line is string => line !== null);
  const text = head.join('\n');
  return `${text}\n${clip(input.bodySource, Math.max(200, MAX_MESSAGE - text.length))}`;
}

/** API side, when the draft is submitted: everything the worker needs, without article access. */
export function preparePackage(input: {
  readonly number: number;
  readonly title: string;
  readonly dek: string;
  readonly score: number;
  readonly bodySource: string;
  readonly citations: readonly CitationLike[];
  readonly check?: string;
}): { route: Route; packageText: string; sourceUrls: string[] } {
  const route = routeFor(input.citations);
  return {
    route,
    packageText: storyMessage({ ...input, route }),
    sourceUrls: [...new Set(input.citations.map((citation) => citation.url))],
  };
}

/**
 * Stories that are drafted, prepared and not sent, oldest first. No article content is read. A
 * story waits for the Pemeriksa agent's check (P5-09), but never longer than `checkWaitMinutes`
 * after it was drafted: with the AI off or slow, the founder still gets the package.
 */
async function readyStories(db: Db, limit: number, checkWaitMinutes: number) {
  return db
    .select({
      id: storyQueue.id,
      articleId: storyQueue.articleId,
      route: storyQueue.route,
      revisionId: storyQueue.revisionId,
      packageText: storyQueue.packageText,
      sourceUrls: storyQueue.sourceUrls,
      currentRevisionId: articles.currentRevisionId,
      articleStatus: articles.status,
    })
    .from(storyQueue)
    .innerJoin(articles, eq(articles.id, storyQueue.articleId))
    .where(
      and(
        eq(storyQueue.status, 'drafted'),
        isNull(storyQueue.sentAt),
        or(
          isNotNull(storyQueue.checkRevisionId),
          lt(storyQueue.updatedAt, sql`now() - make_interval(mins => ${checkWaitMinutes})`),
        ),
      ),
    )
    .orderBy(asc(storyQueue.queuedAt))
    .limit(limit);
}

/** Latest snapshot status per URL (uuidv7 ids are time-ordered). */
async function evidenceStatus(db: Db, urls: readonly string[]) {
  if (urls.length === 0) return new Map<string, string>();
  const rows = await db
    .select({
      id: evidenceSnapshots.id,
      url: evidenceSnapshots.url,
      status: evidenceSnapshots.status,
    })
    .from(evidenceSnapshots)
    .where(inArray(evidenceSnapshots.url, [...urls]))
    .orderBy(sql`${evidenceSnapshots.id} DESC`);
  const latest = new Map<string, string>();
  for (const row of rows) if (!latest.has(row.url)) latest.set(row.url, row.status);
  return latest;
}

export interface PackageOptions extends BotOptions {
  /** Public origin for the OS link (https), or null to name the page only. */
  readonly appOrigin?: string | null;
  /** How long a drafted story waits for the Pemeriksa agent's check. Default 45. */
  readonly checkWaitMinutes?: number;
}

/**
 * Worker: sends one package per drafted story whose sources are all archived. Tokens are stored in
 * the same transaction as the send, so a refused message leaves nothing behind and is retried.
 */
export async function notifyReadyStories(
  db: Db,
  options: PackageOptions,
  limit = 3,
): Promise<{ sent: number; dropped: number; failed: string | null }> {
  let sent = 0;
  let dropped = 0;
  for (const story of await readyStories(
    db,
    limit,
    options.checkWaitMinutes ?? CHECK_WAIT_MINUTES,
  )) {
    const { route, revisionId, packageText, sourceUrls, articleId } = story;
    if (route === null || revisionId === null || packageText === null || articleId === null) {
      continue;
    }
    // Edited in the OS before it went out: the founder is already working on it there.
    if (story.articleStatus !== 'draft' || story.currentRevisionId !== revisionId) continue;
    const urls = sourceUrls ?? [];
    const statuses = await evidenceStatus(db, urls);
    if (urls.some((url) => statuses.get(url) === 'failed')) {
      await db
        .update(storyQueue)
        .set({
          status: 'skipped',
          note: 'Sumber gagal diarsipkan sebagai bukti.',
          updatedAt: sql`now()`,
        })
        .where(and(eq(storyQueue.id, story.id), eq(storyQueue.status, 'drafted')));
      dropped += 1;
      continue;
    }
    if (urls.length === 0 || urls.some((url) => statuses.get(url) !== 'captured')) continue;

    const editUrl =
      options.appOrigin === undefined || options.appOrigin === null
        ? null
        : new URL(`/os/newsroom/${articleId}`, options.appOrigin).href;
    try {
      await db.transaction(async (tx) => {
        const decisions: StoryDecision[] = route === 'fast' ? ['publish', 'skip'] : ['skip'];
        const tokens: Partial<Record<StoryDecision, string>> = {};
        for (const decision of decisions) {
          const token = randomBytes(16).toString('base64url');
          tokens[decision] = token;
          await tx.insert(storyTokens).values({
            storyId: story.id,
            decision,
            revisionId,
            tokenHash: hash(token),
            // The database clock decides (its CHECK allows at most a day); 23 h leaves margin.
            expiresAt: sql`now() + interval '23 hours'`,
          });
        }
        const row = [
          ...(tokens.publish === undefined
            ? []
            : [{ text: '✅ Sumber sudah kucek, terbitkan', callback_data: `p:${tokens.publish}` }]),
          { text: '❌ Lewati', callback_data: `s:${tokens.skip ?? ''}` },
        ];
        await callBot(options, 'sendMessage', {
          chat_id: options.chatId,
          text: `${packageText}\n\n${editUrl === null ? 'Edit di NALARA OS → Newsroom.' : `Edit di OS: ${editUrl}`}`,
          disable_web_page_preview: true,
          reply_markup: { inline_keyboard: [row] },
        });
        await tx
          .update(storyQueue)
          .set({ status: 'sent', sentAt: sql`now()`, updatedAt: sql`now()` })
          .where(and(eq(storyQueue.id, story.id), eq(storyQueue.status, 'drafted')));
      });
      sent += 1;
    } catch (error) {
      return {
        sent,
        dropped,
        failed: error instanceof TelegramError ? error.code : 'unexpected',
      };
    }
  }
  return { sent, dropped, failed: null };
}

/** API: uses a token once. Null when unknown, expired, used, or for another decision. */
export async function consumeStoryToken(
  db: Db,
  token: string,
  claimed: StoryDecision,
): Promise<{ storyId: string; decision: StoryDecision; revisionId: string } | null> {
  if (!STORY_TOKEN_PATTERN.test(token)) return null;
  return db.transaction(async (tx) => {
    const [row] = await tx
      .update(storyTokens)
      .set({ consumedAt: sql`now()` })
      .where(
        and(
          eq(storyTokens.tokenHash, hash(token)),
          eq(storyTokens.decision, claimed),
          isNull(storyTokens.consumedAt),
          sql`${storyTokens.expiresAt} > now()`,
        ),
      )
      .returning({
        storyId: storyTokens.storyId,
        decision: storyTokens.decision,
        revisionId: storyTokens.revisionId,
      });
    if (row === undefined) return null;
    // The sibling button dies with it: one decision per story.
    await tx
      .update(storyTokens)
      .set({ consumedAt: sql`now()` })
      .where(and(eq(storyTokens.storyId, row.storyId), isNull(storyTokens.consumedAt)));
    return row;
  });
}

export type StoryOutcome = 'published' | 'skipped';

/**
 * API: acts on a consumed token for the founder. Refuses (VERSION_CONFLICT) when the draft is no
 * longer the revision that was shown. Publishing goes through the normal workflow, so the publish
 * gate, approval binding and audit all apply as in the OS.
 */
export async function decideStory(
  db: Db,
  actor: Actor,
  used: { readonly storyId: string; readonly decision: StoryDecision; readonly revisionId: string },
): Promise<StoryOutcome> {
  const [story] = await db
    .select({
      id: storyQueue.id,
      status: storyQueue.status,
      route: storyQueue.route,
      articleId: storyQueue.articleId,
    })
    .from(storyQueue)
    .where(eq(storyQueue.id, used.storyId));
  // Edited from the chat since this message (P5-04): a new package with new buttons is on its way.
  if (story?.status === 'drafted') throw new AppError('VERSION_CONFLICT');
  if (story?.status !== 'sent' || story.articleId === null) {
    throw new AppError('INVALID_TRANSITION');
  }
  const [article] = await db
    .select({
      currentRevisionId: articles.currentRevisionId,
      currentVersion: articles.currentVersion,
      status: articles.status,
    })
    .from(articles)
    .where(eq(articles.id, story.articleId));
  if (used.decision === 'skip') {
    await db
      .update(storyQueue)
      .set({ status: 'skipped', note: 'Dilewati founder lewat Telegram.', updatedAt: sql`now()` })
      .where(and(eq(storyQueue.id, story.id), eq(storyQueue.status, 'sent')));
    return 'skipped';
  }
  if (story.route !== 'fast') throw new AppError('FORBIDDEN');
  // ✅ acts only on the revision that was shown: any edit since then voids it.
  if (article?.currentRevisionId !== used.revisionId || article.status !== 'draft') {
    throw new AppError('VERSION_CONFLICT');
  }

  await publishStoryRevision(db, actor, {
    storyId: story.id,
    articleId: story.articleId,
    revisionId: used.revisionId,
    expectedVersion: article.currentVersion,
    via: 'founder',
  });
  return 'published';
}

/**
 * Publishes exactly one revision of a sent story: a new revision with the citations marked checked
 * (by the founder's tap, or by the Pemeriksa check under autopilot), then the normal workflow
 * (submit, approve, publish) as the founder, so every publish gate still applies.
 */
export async function publishStoryRevision(
  db: Db,
  actor: Actor,
  target: {
    readonly storyId: string;
    readonly articleId: string;
    readonly revisionId: string;
    readonly expectedVersion: number;
    readonly via: 'founder' | 'autopilot';
  },
): Promise<void> {
  const [revision] = await db
    .select()
    .from(articleRevisions)
    .where(eq(articleRevisions.id, target.revisionId));
  if (revision === undefined) throw new AppError('NOT_FOUND');
  const checked = await saveRevision(db, actor, target.articleId, {
    expectedVersion: target.expectedVersion,
    content: {
      title: revision.title,
      dek: revision.dek,
      articleType: revision.articleType,
      categoryId: revision.categoryId,
      body: revision.body,
      bodySource: revision.bodySource,
      methodNote: revision.methodNote,
      citations: (revision.citations as Record<string, unknown>[]).map((citation) => ({
        ...citation,
        verified: true,
      })),
    },
    changeNote:
      target.via === 'founder'
        ? 'Sumber dicek founder lewat tombol Telegram (D-32).'
        : 'Sumber dicek agent Pemeriksa (P5-09); terbit otomatis lewat autopilot founder (P5-10).',
  });
  for (const action of ['submit', 'approve', 'publish'] as const) {
    await transition(db, actor, target.articleId, action, { expectedVersion: checked.version });
  }
  await db
    .update(storyQueue)
    .set({ status: 'published', publishedVia: target.via, updatedAt: sql`now()` })
    .where(and(eq(storyQueue.id, target.storyId), eq(storyQueue.status, 'sent')));
}
