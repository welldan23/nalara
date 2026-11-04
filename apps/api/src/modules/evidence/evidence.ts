// Evidence vault (P2-07): when a citation is marked as checked, keep a copy of what the page said.
// The API records a pending request and queues the worker; the worker captures it once through the
// safe fetch. A recent copy (30 days) is reused instead of fetching again. Copies are evidence for
// the founder, never content: they are downloaded as attachments, never rendered by NALARA.
import { and, desc, eq, inArray, sql } from 'drizzle-orm';
import type { NodePgDatabase } from 'drizzle-orm/node-postgres';
import { evidenceSnapshots } from '../../db/schema.ts';
import type { schema } from '../../db/schema.ts';
import { enqueue } from '../../worker/queue.ts';

type Db = NodePgDatabase<typeof schema>;

export const EVIDENCE_FRESH_DAYS = 30;

export interface EvidenceView {
  readonly id: string;
  readonly url: string;
  readonly status: string;
  readonly requestedAt: Date;
  readonly capturedAt: Date | null;
  readonly httpStatus: number | null;
  readonly contentType: string | null;
  readonly byteSize: number | null;
  /** Hex SHA-256 of the stored bytes. */
  readonly sha256: string | null;
  readonly error: string | null;
}

const columns = {
  id: evidenceSnapshots.id,
  url: evidenceSnapshots.url,
  status: evidenceSnapshots.status,
  requestedAt: evidenceSnapshots.requestedAt,
  capturedAt: evidenceSnapshots.capturedAt,
  httpStatus: evidenceSnapshots.httpStatus,
  contentType: evidenceSnapshots.contentType,
  byteSize: evidenceSnapshots.byteSize,
  sha256: evidenceSnapshots.sha256,
  error: evidenceSnapshots.error,
};

const view = (row: {
  id: string;
  url: string;
  status: string;
  requestedAt: Date;
  capturedAt: Date | null;
  httpStatus: number | null;
  contentType: string | null;
  byteSize: number | null;
  sha256: Buffer | null;
  error: string | null;
}): EvidenceView => ({ ...row, sha256: row.sha256?.toString('hex') ?? null });

/**
 * Request snapshots for the checked citations among `citations`. Skips URLs with a pending request
 * or a capture from the last EVIDENCE_FRESH_DAYS days. Returns how many were requested.
 */
export async function requestEvidence(
  db: Db,
  userId: string,
  citations: readonly { readonly url: string; readonly verified: boolean }[],
): Promise<number> {
  const urls = [...new Set(citations.filter((c) => c.verified).map((c) => c.url))];
  if (urls.length === 0) return 0;
  const recent = await db
    .select({ url: evidenceSnapshots.url })
    .from(evidenceSnapshots)
    .where(
      and(
        inArray(evidenceSnapshots.url, urls),
        sql`(${evidenceSnapshots.status} = 'pending' OR (${evidenceSnapshots.status} = 'captured'
          AND ${evidenceSnapshots.capturedAt} > now() - make_interval(days => ${EVIDENCE_FRESH_DAYS})))`,
      ),
    );
  const covered = new Set(recent.map((row) => row.url));
  let requested = 0;
  for (const url of urls.filter((candidate) => !covered.has(candidate))) {
    await db.transaction(async (tx) => {
      const [row] = await tx
        .insert(evidenceSnapshots)
        .values({ url, requestedBy: userId })
        .onConflictDoNothing({
          target: evidenceSnapshots.url,
          where: sql`status = 'pending'`,
        })
        .returning({ id: evidenceSnapshots.id });
      if (row === undefined) return;
      await enqueue(tx, { kind: 'evidence_snapshot', subjectId: row.id, maxAttempts: 3 });
      requested += 1;
    });
  }
  return requested;
}

/** The latest snapshot per URL (metadata only, never the bytes). */
export async function latestEvidence(
  db: Db,
  urls: readonly string[],
): Promise<Record<string, EvidenceView>> {
  if (urls.length === 0) return {};
  const rows = await db
    .select(columns)
    .from(evidenceSnapshots)
    .where(inArray(evidenceSnapshots.url, [...new Set(urls)]))
    .orderBy(desc(evidenceSnapshots.requestedAt), desc(evidenceSnapshots.id));
  const latest: Record<string, EvidenceView> = {};
  for (const row of rows) latest[row.url] ??= view(row);
  return latest;
}

export async function getEvidenceFile(
  db: Db,
  id: string,
): Promise<{ readonly body: Buffer; readonly sha256: Buffer; readonly url: string } | null> {
  const [row] = await db
    .select({
      body: evidenceSnapshots.body,
      sha256: evidenceSnapshots.sha256,
      url: evidenceSnapshots.url,
    })
    .from(evidenceSnapshots)
    .where(and(eq(evidenceSnapshots.id, id), eq(evidenceSnapshots.status, 'captured')));
  if (row?.body == null || row.sha256 === null) return null;
  return { body: row.body, sha256: row.sha256, url: row.url };
}
