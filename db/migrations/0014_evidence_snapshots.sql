-- 0014: evidence vault (P2-07). When the founder marks a citation as checked, the worker keeps a
-- byte-for-byte copy of the cited page with its SHA-256, so the evidence survives if the publisher
-- later edits or removes it. A snapshot is requested (pending) by the API, captured or failed once
-- by the worker, and immutable from then on. Never rendered: the OS offers it as a download only.

CREATE TABLE evidence_snapshots (
  id            uuid PRIMARY KEY DEFAULT uuidv7(),
  url           text NOT NULL CHECK (url LIKE 'https://%' AND char_length(url) <= 2048),
  status        text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'captured', 'failed')),
  requested_by  uuid NOT NULL REFERENCES users (id),
  requested_at  timestamptz NOT NULL DEFAULT now(),
  captured_at   timestamptz,
  http_status   integer CHECK (http_status IS NULL OR http_status BETWEEN 100 AND 599),
  -- The type the server declared (for information only; downloads are served as attachments).
  content_type  text CHECK (content_type IS NULL OR char_length(content_type) <= 100),
  final_url     text CHECK (final_url IS NULL OR char_length(final_url) <= 2048),
  byte_size     integer CHECK (byte_size IS NULL OR byte_size BETWEEN 0 AND 5242880),
  sha256        bytea CHECK (sha256 IS NULL OR octet_length(sha256) = 32),
  body          bytea,
  error         text CHECK (error IS NULL OR error ~ '^[a-z_]+(:[a-z_0-9]+)?$'),
  CONSTRAINT evidence_captured_complete CHECK (
    status <> 'captured' OR (
      captured_at IS NOT NULL AND body IS NOT NULL AND sha256 IS NOT NULL
      AND byte_size = octet_length(body))),
  CONSTRAINT evidence_failed_has_error CHECK (status <> 'failed' OR error IS NOT NULL)
);

-- At most one pending request per URL.
CREATE UNIQUE INDEX evidence_one_pending ON evidence_snapshots (url) WHERE status = 'pending';
CREATE INDEX evidence_url_idx ON evidence_snapshots (url, requested_at DESC);

-- Pending → captured/failed once; after that the row is evidence and never changes.
CREATE FUNCTION nalara_evidence_once() RETURNS trigger
  LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP <> 'UPDATE' OR OLD.status <> 'pending' OR NEW.status = 'pending'
     OR NEW.url <> OLD.url OR NEW.requested_by <> OLD.requested_by
     OR NEW.requested_at <> OLD.requested_at THEN
    RAISE EXCEPTION 'evidence_snapshots is immutable once captured'
      USING ERRCODE = 'insufficient_privilege';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER evidence_snapshots_once
  BEFORE UPDATE OR DELETE ON evidence_snapshots
  FOR EACH ROW EXECUTE FUNCTION nalara_evidence_once();
CREATE TRIGGER evidence_snapshots_no_truncate
  BEFORE TRUNCATE ON evidence_snapshots
  FOR EACH STATEMENT EXECUTE FUNCTION nalara_reject_mutation();

GRANT SELECT, INSERT ON evidence_snapshots TO nalara_app;
GRANT SELECT (id, url, status) ON evidence_snapshots TO nalara_worker;
GRANT UPDATE (status, captured_at, http_status, content_type, final_url, byte_size, sha256, body,
              error)
  ON evidence_snapshots TO nalara_worker;
