// Autopilot (P5-10, founder: "semua diotomasi, gua tinggal duduk manis"). The API publishes a story
// by itself only when ALL of these hold:
//   - the founder switched autopilot on (/autopilot on, audited), and it is still on;
//   - the Pemeriksa check PASSED for the very revision that was sent (P5-09, judged by the API);
//   - the package told the founder it would publish itself (story_queue.autopilot) and reached the
//     chat at least AUTOPILOT_DELAY_MINUTES ago without a ❌;
//   - the draft cites a primary official source (route fast) and nobody edited it since;
//   - not in quiet hours (01-05 WIB), and fewer than AUTOPILOT_DAILY_MAX today.
// It then runs the same publish as the founder's ✅ (every publish gate applies). A refusal holds
// the story for the founder instead of retrying it every minute.
import { and, count, eq, gt, lt, sql } from 'drizzle-orm';
import type { NodePgDatabase } from 'drizzle-orm/node-postgres';
import { articles, storyQueue, systemSettings } from '../../db/schema.ts';
import type { schema } from '../../db/schema.ts';
import { AppError } from '../../lib/errors.ts';
import type { Actor } from '../articles/articles.ts';
import { recordAudit } from '../audit/audit.ts';
import { inQuietHours } from '../radar/score.ts';
import { publishStoryRevision } from './telegram.ts';

type Db = NodePgDatabase<typeof schema>;

export const AUTOPILOT_DELAY_MINUTES = 15;
export const AUTOPILOT_DAILY_MAX = 8;

export async function autopilotEnabled(db: Db): Promise<boolean> {
  const [row] = await db.select({ on: systemSettings.autopilot }).from(systemSettings);
  return row?.on === true;
}

export async function setAutopilot(
  db: Db,
  actor: { readonly userId: string; readonly requestId?: string },
  enabled: boolean,
  channel: 'telegram' | 'os',
): Promise<void> {
  await db.transaction(async (tx) => {
    await tx
      .update(systemSettings)
      .set({ autopilot: enabled, updatedAt: sql`now()` })
      .where(eq(systemSettings.id, 1));
    await recordAudit(tx, {
      action: 'autopilot.settings',
      actorType: 'founder',
      actorId: actor.userId,
      result: 'success',
      resourceType: 'system_settings',
      ...(actor.requestId === undefined ? {} : { requestId: actor.requestId }),
      metadata: { enabled, channel },
    });
  });
}

/** The line the package carries when it will publish itself. */
export function autopilotNotice(): string {
  return `Autopilot: terbit otomatis ${String(AUTOPILOT_DELAY_MINUTES)} menit setelah pesan ini masuk. Tekan ❌ untuk membatalkan, atau ✅ untuk terbit sekarang.`;
}

/** Publishes every due story; returns the article ids published (for the Kartu IG queue). */
export async function publishDueStories(
  db: Db,
  actor: Actor,
  now: Date = new Date(),
): Promise<{ published: string[]; held: number }> {
  if (!(await autopilotEnabled(db)) || inQuietHours(now)) return { published: [], held: 0 };
  const [today] = await db
    .select({ n: count() })
    .from(storyQueue)
    .where(
      and(
        eq(storyQueue.publishedVia, 'autopilot'),
        gt(
          storyQueue.updatedAt,
          sql`date_trunc('day', now() AT TIME ZONE 'Asia/Jakarta') AT TIME ZONE 'Asia/Jakarta'`,
        ),
      ),
    );
  const room = AUTOPILOT_DAILY_MAX - (today?.n ?? 0);
  if (room <= 0) return { published: [], held: 0 };

  const due = await db
    .select({
      id: storyQueue.id,
      articleId: storyQueue.articleId,
      revisionId: storyQueue.revisionId,
      checkNote: storyQueue.checkNote,
      currentVersion: articles.currentVersion,
    })
    .from(storyQueue)
    .innerJoin(articles, eq(articles.id, storyQueue.articleId))
    .where(
      and(
        eq(storyQueue.status, 'sent'),
        eq(storyQueue.autopilot, true),
        eq(storyQueue.route, 'fast'),
        eq(storyQueue.checkStatus, 'passed'),
        eq(storyQueue.checkRevisionId, storyQueue.revisionId),
        eq(articles.currentRevisionId, storyQueue.revisionId),
        eq(articles.status, 'draft'),
        lt(storyQueue.sentAt, sql`now() - make_interval(mins => ${AUTOPILOT_DELAY_MINUTES})`),
      ),
    )
    .orderBy(storyQueue.sentAt)
    .limit(room);

  const published: string[] = [];
  let held = 0;
  for (const story of due) {
    if (story.articleId === null || story.revisionId === null) continue;
    try {
      await publishStoryRevision(db, actor, {
        storyId: story.id,
        articleId: story.articleId,
        revisionId: story.revisionId,
        expectedVersion: story.currentVersion,
        via: 'autopilot',
      });
      published.push(story.articleId);
    } catch (error) {
      if (!(error instanceof AppError)) throw error;
      // Gate refused or the article moved: leave it to the founder, once.
      held += 1;
      await db
        .update(storyQueue)
        .set({
          checkStatus: 'held',
          checkNote:
            `${story.checkNote ?? ''}\nAutopilot berhenti: ${error.code}. Cek di NALARA OS.`.slice(
              0,
              2000,
            ),
          updatedAt: sql`now()`,
        })
        .where(eq(storyQueue.id, story.id));
    }
  }
  return { published, held };
}
