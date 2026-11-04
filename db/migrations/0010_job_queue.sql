-- 0010: worker job queue (P2-02, PRD v4 §5 "queue berbasis tabel Postgres dulu"). The API
-- enqueues; the worker (role nalara_worker, its own minimal privileges) claims jobs with
-- FOR UPDATE SKIP LOCKED and a lease, so two workers never run the same job and a job whose
-- worker died is picked up again once its lease expires.

CREATE TABLE job_runs (
  id            uuid PRIMARY KEY DEFAULT uuidv7(),
  kind          text NOT NULL CHECK (kind IN ('feed_check', 'feed_fetch', 'evidence_snapshot')),
  -- What the job is about (a source, a citation...). Its meaning depends on kind.
  subject_id    uuid,
  status        text NOT NULL DEFAULT 'queued'
                  CHECK (status IN ('queued', 'running', 'succeeded', 'failed')),
  run_after     timestamptz NOT NULL DEFAULT now(),
  attempts      integer NOT NULL DEFAULT 0 CHECK (attempts >= 0),
  max_attempts  integer NOT NULL DEFAULT 5 CHECK (max_attempts BETWEEN 1 AND 20),
  locked_by     text CHECK (locked_by IS NULL OR char_length(locked_by) BETWEEN 1 AND 100),
  locked_until  timestamptz,
  -- A stable error code only (e.g. "fetch:address"), never a URL, body or stack trace.
  last_error    text CHECK (last_error IS NULL OR last_error ~ '^[a-z_]+(:[a-z_]+)?$'),
  created_at    timestamptz NOT NULL DEFAULT now(),
  started_at    timestamptz,
  finished_at   timestamptz,
  CONSTRAINT job_runs_lease CHECK ((status = 'running') = (locked_by IS NOT NULL AND locked_until IS NOT NULL))
);

-- At most one queued or running job per kind and subject: re-enqueueing is a no-op.
CREATE UNIQUE INDEX job_runs_one_active ON job_runs (kind, subject_id)
  WHERE status IN ('queued', 'running');
CREATE INDEX job_runs_due ON job_runs (run_after) WHERE status = 'queued';
CREATE INDEX job_runs_expired ON job_runs (locked_until) WHERE status = 'running';
CREATE INDEX job_runs_recent ON job_runs (created_at DESC);

GRANT SELECT, INSERT ON job_runs TO nalara_app;
GRANT SELECT, INSERT, UPDATE ON job_runs TO nalara_worker;
