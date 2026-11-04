// feed_fetch and the feed scheduler (P2-04). Every due feed of a verified source with a healthy or
// failing (not quarantined, not unchecked) feed is fetched about once an hour, politely:
// If-None-Match / If-Modified-Since, so an unchanged feed costs one 304 and no parsing. New items
// are inserted with ON CONFLICT DO NOTHING on (source, canonical URL), so a feed fetched twice
// never creates a duplicate. Failures back off exponentially with jitter; after QUARANTINE_AFTER
// failures in a row (or at once, for an internal address) the feed is quarantined (P2-05).
import { createHash, randomUUID } from 'node:crypto';
import { and, eq, inArray, isNotNull, lte, sql } from 'drizzle-orm';
import type { NodePgDatabase } from 'drizzle-orm/node-postgres';
import { discoveredItems, ingestionRuns, sources } from '../../db/schema.ts';
import type { schema } from '../../db/schema.ts';
import { parseFeed } from '../../modules/feeds/feed.ts';
import type { FeedItem } from '../../modules/feeds/feed.ts';
import { safeFetch } from '../../modules/fetch/safe-fetch.ts';
import type { SafeFetchOptions } from '../../modules/fetch/safe-fetch.ts';
import { backoffMs, enqueue } from '../queue.ts';
import type { JobHandler } from '../runner.ts';
import { FEED_CONTENT_TYPES, FEED_MAX_BYTES, errorCode, httpError } from './feed-check.ts';

type Db = NodePgDatabase<typeof schema>;

/** How often a healthy feed is fetched. */
export const FETCH_INTERVAL_MS = 60 * 60 * 1000;
/** First retry after a failure (then doubling with jitter, capped at 6 hours). */
export const FAILURE_BASE_MS = 15 * 60 * 1000;
/** Consecutive failures before a feed is quarantined (P2-05). */
export const QUARANTINE_AFTER = 5;
/**
 * Errors that quarantine at once: the feed URL points at an internal address or a forbidden
 * scheme/port (possibly after a redirect). Retrying would only knock on the same door again.
 */
const QUARANTINE_NOW = new Set([
  'fetch:address',
  'fetch:scheme',
  'fetch:port',
  'fetch:credentials',
]);

/** What a failed fetch does to the feed: back off, or stop until the founder looks at it. */
export function afterFailure(failures: number, error: string): 'retry' | 'quarantine' {
  return failures >= QUARANTINE_AFTER || QUARANTINE_NOW.has(error) ? 'quarantine' : 'retry';
}

/** Feeds that may be fetched at all: verified source, feed checked once, not quarantined. */
const fetchable = () =>
  and(
    eq(sources.status, 'verified'),
    isNotNull(sources.feedUrl),
    inArray(sources.feedStatus, ['ok', 'failing']),
  );

/**
 * Queue a feed_fetch for every due feed. Returns how many were queued. "Due" is judged by the
 * database clock, the same clock that wrote next_fetch_at: comparing against the worker's own
 * clock would skip a feed whenever the two drift by a few milliseconds.
 */
export async function scheduleDueFeeds(db: Db): Promise<number> {
  const due = await db
    .select({ id: sources.id })
    .from(sources)
    .where(and(fetchable(), lte(sources.nextFetchAt, sql`now()`)))
    .limit(100);
  let queued = 0;
  for (const source of due) {
    if (
      (await enqueue(db, { kind: 'feed_fetch', subjectId: source.id, maxAttempts: 1 })) !== null
    ) {
      queued += 1;
    }
  }
  return queued;
}

/** Same story, different source: lower case, letters and digits only, single spaces. */
export function titleFingerprint(title: string): Buffer {
  const normal = title
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim();
  return createHash('sha256').update(normal).digest();
}

const clip = (value: string | undefined, max: number) =>
  value === undefined || value.length > max ? null : value;

export function feedFetchHandler(db: Db, fetchOptions: SafeFetchOptions = {}): JobHandler {
  return async (job) => {
    if (job.subjectId === null) return { ok: false, error: 'job:no_subject' };
    const [source] = await db
      .select({
        id: sources.id,
        feedUrl: sources.feedUrl,
        etag: sources.etag,
        lastModified: sources.lastModified,
        failures: sources.consecutiveFailures,
      })
      .from(sources)
      .where(and(eq(sources.id, job.subjectId), fetchable()));
    // Paused, disabled, quarantined or unchecked since it was queued: do nothing at all.
    if (source?.feedUrl == null) return { ok: false, error: 'source:not_fetchable' };

    const started = Date.now();
    let httpStatus: number | null = null;
    let error: string | null = null;
    let items: readonly FeedItem[] = [];
    let validators: { etag: string | null; lastModified: string | null } | null = null;
    let notModified = false;
    try {
      const response = await safeFetch(source.feedUrl, {
        contentTypes: FEED_CONTENT_TYPES,
        maxBytes: FEED_MAX_BYTES,
        timeoutMs: 20_000,
        headers: {
          ...(source.etag === null ? {} : { 'if-none-match': source.etag }),
          ...(source.lastModified === null ? {} : { 'if-modified-since': source.lastModified }),
        },
        ...fetchOptions,
      });
      httpStatus = response.status;
      if (response.status === 304) {
        notModified = true;
      } else if (response.status === 200) {
        items = parseFeed(response.body, response.url).items;
        validators = {
          etag: clip(response.headers['etag'], 300),
          lastModified: clip(response.headers['last-modified'], 100),
        };
      } else {
        error = httpError(response.status);
      }
    } catch (caught) {
      error = errorCode(caught);
    }
    const durationMs = Date.now() - started;

    await db.transaction(async (tx) => {
      // Items first, then the immutable run record with the final counts (deferred FK).
      const runId = randomUUID();
      let itemsNew = 0;
      if (items.length > 0) {
        const rows = await tx
          .insert(discoveredItems)
          .values(
            items.map((item) => ({
              sourceId: source.id,
              runId,
              canonicalUrl: item.canonicalUrl,
              guid: item.guid,
              title: item.title,
              summary: item.summary,
              publishedAt: item.publishedAt,
              fingerprint: titleFingerprint(item.title),
            })),
          )
          .onConflictDoNothing({ target: [discoveredItems.sourceId, discoveredItems.canonicalUrl] })
          .returning({ id: discoveredItems.id });
        itemsNew = rows.length;
      }
      await tx.insert(ingestionRuns).values({
        id: runId,
        sourceId: source.id,
        httpStatus,
        notModified,
        itemsSeen: items.length,
        itemsNew,
        error,
        durationMs,
      });
      const failures = error === null ? 0 : source.failures + 1;
      if (error !== null && afterFailure(failures, error) === 'quarantine') {
        // Stop fetching this feed until the founder releases it; other feeds carry on.
        await tx
          .update(sources)
          .set({
            feedStatus: 'quarantined',
            feedError: error,
            feedCheckedAt: sql`now()`,
            consecutiveFailures: failures,
            nextFetchAt: null,
            feedQuarantinedAt: sql`now()`,
          })
          .where(eq(sources.id, source.id));
        return;
      }
      const delay =
        error === null
          ? FETCH_INTERVAL_MS
          : Math.max(FAILURE_BASE_MS / 2, backoffMs(failures, { baseMs: FAILURE_BASE_MS }));
      await tx
        .update(sources)
        .set({
          feedStatus: error === null ? 'ok' : 'failing',
          feedError: error,
          feedCheckedAt: sql`now()`,
          consecutiveFailures: failures,
          nextFetchAt: sql`now() + make_interval(secs => ${delay / 1000})`,
          ...(validators ?? {}),
        })
        .where(eq(sources.id, source.id));
    });
    return error === null ? { ok: true } : { ok: false, error };
  };
}
