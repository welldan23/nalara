-- 0012: ingestion (P2-04). The worker fetches due feeds of verified sources and stores new items
-- as discovered_items: material for the founder's inbox, never published. Deduplicated per source
-- by canonical URL; a title fingerprint links the same story across sources. Every fetch is kept
-- in ingestion_runs (immutable).

CREATE TABLE ingestion_runs (
  id               uuid PRIMARY KEY DEFAULT uuidv7(),
  source_id        uuid NOT NULL REFERENCES sources (id) ON DELETE RESTRICT,
  http_status      integer CHECK (http_status IS NULL OR http_status BETWEEN 100 AND 599),
  not_modified     boolean NOT NULL DEFAULT false,
  items_seen       integer NOT NULL DEFAULT 0 CHECK (items_seen BETWEEN 0 AND 1000),
  items_new        integer NOT NULL DEFAULT 0 CHECK (items_new BETWEEN 0 AND 1000),
  error            text CHECK (error IS NULL OR error ~ '^[a-z_]+(:[a-z_0-9]+)?$'),
  duration_ms      integer CHECK (duration_ms IS NULL OR duration_ms >= 0),
  started_at       timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT ingestion_runs_new_le_seen CHECK (items_new <= items_seen)
);

CREATE INDEX ingestion_runs_source_idx ON ingestion_runs (source_id, started_at DESC);

CREATE TABLE discovered_items (
  id               uuid PRIMARY KEY DEFAULT uuidv7(),
  source_id        uuid NOT NULL REFERENCES sources (id) ON DELETE RESTRICT,
  -- Checked at commit: the worker writes the items first, then the run with its final counts.
  run_id           uuid NOT NULL REFERENCES ingestion_runs (id) ON DELETE RESTRICT
                     DEFERRABLE INITIALLY DEFERRED,
  canonical_url    text NOT NULL CHECK (
                     (canonical_url LIKE 'https://%' OR canonical_url LIKE 'http://%')
                     AND char_length(canonical_url) <= 2048),
  guid             text NOT NULL CHECK (char_length(guid) BETWEEN 1 AND 500),
  title            text NOT NULL CHECK (char_length(title) BETWEEN 1 AND 300),
  summary          text NOT NULL DEFAULT '' CHECK (char_length(summary) <= 500),
  published_at     timestamptz,
  -- SHA-256 of the normalised title: the same story from several sources shares it.
  fingerprint      bytea NOT NULL CHECK (octet_length(fingerprint) = 32),
  -- Inbox state, owned by the founder (P2-06).
  status           text NOT NULL DEFAULT 'new' CHECK (status IN ('new', 'seen', 'dismissed', 'used')),
  status_changed_at timestamptz,
  first_seen_at    timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT discovered_items_source_url_unique UNIQUE (source_id, canonical_url)
);

CREATE INDEX discovered_items_fingerprint_idx ON discovered_items (fingerprint);
CREATE INDEX discovered_items_inbox_idx ON discovered_items (status, first_seen_at DESC);

-- Runs are evidence; items may only change their inbox state.
CREATE TRIGGER ingestion_runs_no_update_delete
  BEFORE UPDATE OR DELETE ON ingestion_runs
  FOR EACH ROW EXECUTE FUNCTION nalara_reject_mutation();
CREATE TRIGGER ingestion_runs_no_truncate
  BEFORE TRUNCATE ON ingestion_runs
  FOR EACH STATEMENT EXECUTE FUNCTION nalara_reject_mutation();
CREATE TRIGGER discovered_items_no_delete
  BEFORE DELETE ON discovered_items
  FOR EACH ROW EXECUTE FUNCTION nalara_reject_mutation();
CREATE TRIGGER discovered_items_no_truncate
  BEFORE TRUNCATE ON discovered_items
  FOR EACH STATEMENT EXECUTE FUNCTION nalara_reject_mutation();

GRANT SELECT ON ingestion_runs TO nalara_app;
GRANT SELECT, INSERT ON ingestion_runs TO nalara_worker;
GRANT SELECT ON discovered_items TO nalara_app;
GRANT UPDATE (status, status_changed_at) ON discovered_items TO nalara_app;
-- The worker adds items; it cannot change the founder's inbox state.
GRANT SELECT, INSERT ON discovered_items TO nalara_worker;
