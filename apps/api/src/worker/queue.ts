// Postgres job queue (P2-02, PRD v4 §5). Claiming uses FOR UPDATE SKIP LOCKED inside a single
// UPDATE, so two workers can never take the same job, and a lease (locked_until) so a job whose
// worker died is claimed again once the lease runs out. Only the worker that holds the lease can
// finish a job. Error details are stable codes (e.g. "fetch:address"), never URLs or bodies.
import { and, eq, sql } from 'drizzle-orm';
import type { NodePgDatabase } from 'drizzle-orm/node-postgres';
import { jobRuns } from '../db/schema.ts';
import type { JOB_KINDS, schema } from '../db/schema.ts';

type Db = NodePgDatabase<typeof schema>;
export type JobKind = (typeof JOB_KINDS)[number];

export interface Job {
  readonly id: string;
  readonly kind: JobKind;
  readonly subjectId: string | null;
  readonly attempts: number;
  readonly maxAttempts: number;
}

const ERROR_CODE = /^[a-z_]+(:[a-z_]+)?$/;

/**
 * Queue a job unless one for the same kind and subject is already queued or running (then the
 * existing one stands). Returns the id of the queued job, or null when one already existed.
 */
export async function enqueue(
  db: Pick<Db, 'insert'>,
  job: {
    readonly kind: JobKind;
    readonly subjectId?: string | null;
    readonly runAfter?: Date;
    readonly maxAttempts?: number;
  },
): Promise<string | null> {
  const [row] = await db
    .insert(jobRuns)
    .values({
      kind: job.kind,
      subjectId: job.subjectId ?? null,
      ...(job.runAfter === undefined ? {} : { runAfter: job.runAfter }),
      ...(job.maxAttempts === undefined ? {} : { maxAttempts: job.maxAttempts }),
    })
    .onConflictDoNothing({
      target: [jobRuns.kind, jobRuns.subjectId],
      where: sql`status IN ('queued', 'running')`,
    })
    .returning({ id: jobRuns.id });
  return row?.id ?? null;
}

/** Claim the next due job (or one whose lease expired) for `workerId`, or null. */
export async function claim(
  db: Db,
  workerId: string,
  leaseSeconds: number,
  kinds: readonly JobKind[],
): Promise<Job | null> {
  if (kinds.length === 0) return null;
  const kindList = sql.join(
    kinds.map((kind) => sql`${kind}`),
    sql`, `,
  );
  const result = await db.execute<{
    id: string;
    kind: JobKind;
    subject_id: string | null;
    attempts: number;
    max_attempts: number;
  }>(sql`
    UPDATE job_runs SET
      status = 'running',
      locked_by = ${workerId},
      locked_until = now() + make_interval(secs => ${leaseSeconds}),
      attempts = attempts + 1,
      started_at = now()
    WHERE id = (
      SELECT id FROM job_runs
      WHERE kind IN (${kindList})
        AND ((status = 'queued' AND run_after <= now())
          OR (status = 'running' AND locked_until < now()))
      ORDER BY run_after, id
      LIMIT 1
      FOR UPDATE SKIP LOCKED
    )
    RETURNING id, kind, subject_id, attempts, max_attempts`);
  const row = result.rows[0];
  if (row === undefined) return null;
  return {
    id: row.id,
    kind: row.kind,
    subjectId: row.subject_id,
    attempts: row.attempts,
    maxAttempts: row.max_attempts,
  };
}

export type JobOutcome =
  | { readonly ok: true }
  /** `retryAt` set: try again then (if attempts remain); otherwise the job fails for good. */
  | { readonly ok: false; readonly error: string; readonly retryAt?: Date };

/**
 * Record a job's outcome. Only the worker holding the lease may do so; returns false when the
 * lease was lost (another worker took over after it expired), and nothing is changed.
 */
export async function finish(
  db: Db,
  job: Job,
  workerId: string,
  outcome: JobOutcome,
): Promise<boolean> {
  const owned = and(
    eq(jobRuns.id, job.id),
    eq(jobRuns.status, 'running'),
    eq(jobRuns.lockedBy, workerId),
  );
  if (outcome.ok) {
    const rows = await db
      .update(jobRuns)
      .set({
        status: 'succeeded',
        lockedBy: null,
        lockedUntil: null,
        lastError: null,
        finishedAt: sql`now()`,
      })
      .where(owned)
      .returning({ id: jobRuns.id });
    return rows.length > 0;
  }
  const error = ERROR_CODE.test(outcome.error) ? outcome.error : 'internal';
  const retry = outcome.retryAt !== undefined && job.attempts < job.maxAttempts;
  const rows = await db
    .update(jobRuns)
    .set(
      retry
        ? {
            status: 'queued',
            lockedBy: null,
            lockedUntil: null,
            lastError: error,
            runAfter: outcome.retryAt,
          }
        : {
            status: 'failed',
            lockedBy: null,
            lockedUntil: null,
            lastError: error,
            finishedAt: sql`now()`,
          },
    )
    .where(owned)
    .returning({ id: jobRuns.id });
  return rows.length > 0;
}

/** Exponential backoff with full jitter: random in [0, min(cap, base * 2^(attempt-1))]. */
export function backoffMs(
  attempt: number,
  options: {
    readonly baseMs?: number;
    readonly capMs?: number;
    readonly random?: () => number;
  } = {},
): number {
  const base = options.baseMs ?? 60_000;
  const cap = options.capMs ?? 6 * 60 * 60 * 1000;
  const ceiling = Math.min(cap, base * 2 ** Math.max(0, attempt - 1));
  return Math.floor((options.random ?? Math.random)() * ceiling);
}
