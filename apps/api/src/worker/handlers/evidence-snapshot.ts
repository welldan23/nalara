// evidence_snapshot (P2-07): capture one cited page, byte for byte, through the safe fetch. The
// bytes are stored with their SHA-256; nothing is parsed or executed. Transient failures (timeout,
// network, 5xx, 429) are retried by the queue; anything else, or the last attempt, marks the
// snapshot failed with a stable code.
import { createHash } from 'node:crypto';
import { and, eq, sql } from 'drizzle-orm';
import type { NodePgDatabase } from 'drizzle-orm/node-postgres';
import { evidenceSnapshots } from '../../db/schema.ts';
import type { schema } from '../../db/schema.ts';
import { safeFetch } from '../../modules/fetch/safe-fetch.ts';
import type { SafeFetchOptions } from '../../modules/fetch/safe-fetch.ts';
import { backoffMs } from '../queue.ts';
import type { JobHandler } from '../runner.ts';
import { errorCode, httpError } from './feed-check.ts';

type Db = NodePgDatabase<typeof schema>;

export const EVIDENCE_MAX_BYTES = 5 * 1024 * 1024;

/** What can be kept as evidence: documents and data, not scripts, images or executables. */
export const EVIDENCE_CONTENT_TYPES = [
  'text/html',
  'application/xhtml+xml',
  'text/plain',
  'application/pdf',
  'text/csv',
  'application/json',
  'application/xml',
  'text/xml',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  'application/vnd.ms-excel',
] as const;

const TRANSIENT = new Set([
  'fetch:timeout',
  'fetch:network',
  'fetch:dns',
  'http:server_error',
  'http:rate_limited',
]);

export function evidenceSnapshotHandler(db: Db, fetchOptions: SafeFetchOptions = {}): JobHandler {
  return async (job) => {
    if (job.subjectId === null) return { ok: false, error: 'job:no_subject' };
    const [snapshot] = await db
      .select({ id: evidenceSnapshots.id, url: evidenceSnapshots.url })
      .from(evidenceSnapshots)
      .where(and(eq(evidenceSnapshots.id, job.subjectId), eq(evidenceSnapshots.status, 'pending')));
    if (snapshot === undefined) return { ok: false, error: 'evidence:not_pending' };

    let error: string;
    try {
      const response = await safeFetch(snapshot.url, {
        contentTypes: EVIDENCE_CONTENT_TYPES,
        maxBytes: EVIDENCE_MAX_BYTES,
        timeoutMs: 30_000,
        ...fetchOptions,
      });
      if (response.status === 200) {
        await db
          .update(evidenceSnapshots)
          .set({
            status: 'captured',
            capturedAt: sql`now()`,
            httpStatus: 200,
            contentType: (response.headers['content-type'] ?? '').slice(0, 100) || null,
            finalUrl: response.url.slice(0, 2048),
            byteSize: response.body.length,
            sha256: createHash('sha256').update(response.body).digest(),
            body: response.body,
          })
          .where(
            and(eq(evidenceSnapshots.id, snapshot.id), eq(evidenceSnapshots.status, 'pending')),
          );
        return { ok: true };
      }
      error = httpError(response.status);
    } catch (caught) {
      error = errorCode(caught);
    }
    if (TRANSIENT.has(error) && job.attempts < job.maxAttempts) {
      // Stays pending; the queue tries again later.
      return { ok: false, error, retryAt: new Date(Date.now() + backoffMs(job.attempts)) };
    }
    await db
      .update(evidenceSnapshots)
      .set({ status: 'failed', error })
      .where(and(eq(evidenceSnapshots.id, snapshot.id), eq(evidenceSnapshots.status, 'pending')));
    return { ok: false, error };
  };
}
