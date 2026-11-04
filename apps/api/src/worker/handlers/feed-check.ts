// feed_check (P2-03b): fetch a source's feed once through the safe fetch, parse it, record the
// result in source_checks and the feed state on the source. The source must be verified when the
// job runs, not only when it was queued. A manual check is never retried: the founder sees the
// outcome and decides. Errors are stable codes; no URL, body or message is stored.
import { eq, sql } from 'drizzle-orm';
import type { NodePgDatabase } from 'drizzle-orm/node-postgres';
import { sourceChecks, sources } from '../../db/schema.ts';
import type { schema } from '../../db/schema.ts';
import { FeedError, parseFeed } from '../../modules/feeds/feed.ts';
import { FetchBlocked, safeFetch } from '../../modules/fetch/safe-fetch.ts';
import type { SafeFetchOptions } from '../../modules/fetch/safe-fetch.ts';
import type { JobHandler } from '../runner.ts';

type Db = NodePgDatabase<typeof schema>;

/** What a feed may be served as. HTML pages and everything else are refused. */
export const FEED_CONTENT_TYPES = [
  'application/rss+xml',
  'application/atom+xml',
  'application/rdf+xml',
  'application/xml',
  'text/xml',
  'application/x-rss+xml',
] as const;

export const FEED_MAX_BYTES = 2 * 1024 * 1024;

export interface FeedFetchResult {
  readonly ok: boolean;
  readonly error: string | null;
  readonly httpStatus: number | null;
  readonly format: 'rss' | 'atom' | 'rdf' | null;
  readonly title: string | null;
  readonly itemCount: number | null;
  readonly durationMs: number;
}

/** Map anything a fetch + parse can throw to a stable code. */
export function errorCode(error: unknown): string {
  if (error instanceof FetchBlocked) return `fetch:${error.reason}`;
  if (error instanceof FeedError) return `feed:${error.rule}`;
  return 'internal';
}

export function httpError(status: number): string {
  if (status === 304) return 'http:not_modified';
  if (status === 404 || status === 410) return 'http:gone';
  if (status === 401 || status === 403) return 'http:forbidden';
  if (status === 429) return 'http:rate_limited';
  if (status >= 500) return 'http:server_error';
  return 'http:unexpected_status';
}

export function feedCheckHandler(db: Db, fetchOptions: SafeFetchOptions = {}): JobHandler {
  return async (job) => {
    if (job.subjectId === null) return { ok: false, error: 'job:no_subject' };
    const [source] = await db
      .select({
        id: sources.id,
        status: sources.status,
        feedUrl: sources.feedUrl,
        feedStatus: sources.feedStatus,
      })
      .from(sources)
      .where(eq(sources.id, job.subjectId));
    if (source === undefined) return { ok: false, error: 'source:missing' };
    if (source.feedUrl === null) return { ok: false, error: 'source:no_feed' };
    // Quarantined since it was queued: leave it alone until the founder releases it.
    if (source.feedStatus === 'quarantined') return { ok: false, error: 'source:quarantined' };

    const started = Date.now();
    let result: FeedFetchResult;
    if (source.status !== 'verified') {
      // Never fetch from a source the founder has not verified, even if it was when queued.
      result = {
        ok: false,
        error: 'source:not_verified',
        httpStatus: null,
        format: null,
        title: null,
        itemCount: null,
        durationMs: 0,
      };
    } else {
      try {
        const response = await safeFetch(source.feedUrl, {
          contentTypes: FEED_CONTENT_TYPES,
          maxBytes: FEED_MAX_BYTES,
          timeoutMs: 15_000,
          ...fetchOptions,
        });
        if (response.status !== 200) {
          result = {
            ok: false,
            error: httpError(response.status),
            httpStatus: response.status,
            format: null,
            title: null,
            itemCount: null,
            durationMs: Date.now() - started,
          };
        } else {
          const feed = parseFeed(response.body, response.url);
          result = {
            ok: true,
            error: null,
            httpStatus: 200,
            format: feed.format,
            title: feed.title === '' ? null : feed.title,
            itemCount: feed.items.length,
            durationMs: Date.now() - started,
          };
        }
      } catch (error) {
        result = {
          ok: false,
          error: errorCode(error),
          httpStatus: null,
          format: null,
          title: null,
          itemCount: null,
          durationMs: Date.now() - started,
        };
      }
    }

    await db.transaction(async (tx) => {
      await tx.insert(sourceChecks).values({
        sourceId: source.id,
        ok: result.ok,
        httpStatus: result.httpStatus,
        feedFormat: result.format,
        itemCount: result.itemCount,
        error: result.error,
        durationMs: result.durationMs,
      });
      await tx
        .update(sources)
        .set(
          result.ok
            ? {
                feedStatus: 'ok',
                feedTitle: result.title,
                feedError: null,
                feedCheckedAt: sql`now()`,
                consecutiveFailures: 0,
                // A good check makes the feed due for ingestion right away (P2-04).
                nextFetchAt: sql`now()`,
              }
            : { feedStatus: 'failing', feedError: result.error, feedCheckedAt: sql`now()` },
        )
        .where(eq(sources.id, source.id));
    });
    return result.ok ? { ok: true } : { ok: false, error: result.error ?? 'internal' };
  };
}
