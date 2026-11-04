// The worker loop (P2-02): claim a job, run its handler, record the outcome, repeat. A handler
// that throws never takes the worker down: the job is retried with backoff and the loop goes on.
// stop() stops claiming and waits for the job in hand, so SIGTERM never cuts a job in half
// (a hard kill is covered by the lease: the job is claimed again after it expires).
import type { NodePgDatabase } from 'drizzle-orm/node-postgres';
import type { schema } from '../db/schema.ts';
import { backoffMs, claim, finish } from './queue.ts';
import type { Job, JobKind, JobOutcome } from './queue.ts';

type Db = NodePgDatabase<typeof schema>;

export type JobHandler = (
  job: Job,
  context: { readonly signal: AbortSignal },
) => Promise<JobOutcome>;

export interface WorkerLog {
  info(fields: Record<string, unknown>, msg: string): void;
  warn(fields: Record<string, unknown>, msg: string): void;
}

export interface RunnerOptions {
  readonly workerId: string;
  readonly handlers: Readonly<Partial<Record<JobKind, JobHandler>>>;
  readonly leaseSeconds?: number;
  readonly pollMs?: number;
  /** Called on every loop turn (the container healthcheck reads the heartbeat file). */
  readonly onBeat?: () => void;
  readonly log?: WorkerLog;
}

export interface RunningWorker {
  /** Stop claiming; resolves when the job in hand (if any) is finished. */
  stop(): Promise<void>;
  /** Resolves when the loop has exited. */
  readonly done: Promise<void>;
}

const silent: WorkerLog = { info: () => undefined, warn: () => undefined };

export function startWorker(db: Db, options: RunnerOptions): RunningWorker {
  const leaseSeconds = options.leaseSeconds ?? 120;
  const pollMs = options.pollMs ?? 5_000;
  const log = options.log ?? silent;
  const kinds = Object.keys(options.handlers) as JobKind[];
  const stopping = new AbortController();
  let wake: (() => void) | undefined;

  const pause = (ms: number) =>
    new Promise<void>((resolve) => {
      const timer = setTimeout(resolve, ms);
      wake = () => {
        clearTimeout(timer);
        resolve();
      };
    });

  async function runOne(job: Job): Promise<void> {
    const handler = options.handlers[job.kind];
    let outcome: JobOutcome;
    try {
      outcome =
        handler === undefined
          ? { ok: false, error: 'no_handler' }
          : await handler(job, { signal: stopping.signal });
    } catch {
      // Unexpected failure inside a handler: retry later, never crash the loop.
      outcome = {
        ok: false,
        error: 'internal',
        retryAt: new Date(Date.now() + backoffMs(job.attempts)),
      };
    }
    const recorded = await finish(db, job, options.workerId, outcome);
    log.info(
      {
        job: job.id,
        kind: job.kind,
        attempt: job.attempts,
        ok: outcome.ok,
        ...(outcome.ok ? {} : { error: outcome.error }),
        recorded,
      },
      'job finished',
    );
  }

  const done = (async () => {
    while (!stopping.signal.aborted) {
      options.onBeat?.();
      let job: Job | null = null;
      try {
        job = await claim(db, options.workerId, leaseSeconds, kinds);
      } catch {
        log.warn({}, 'claim failed; database unavailable?');
      }
      if (job === null) {
        await pause(pollMs);
        continue;
      }
      try {
        await runOne(job);
      } catch {
        log.warn({ job: job.id }, 'recording the outcome failed; the lease will expire');
      }
    }
  })();

  return {
    done,
    stop: async () => {
      stopping.abort();
      wake?.();
      await done;
    },
  };
}
