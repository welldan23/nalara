-- 0011: feeds in the Source Registry (P2-03b). A source may have one RSS/Atom feed URL. Only
-- verified sources are ever fetched (the worker checks the status itself, at run time). The worker
-- may read the few columns it needs and write only the feed state; the founder owns the rest.

ALTER TABLE sources
  ADD COLUMN feed_url text CHECK (
    feed_url IS NULL OR (
      (feed_url LIKE 'https://%' OR feed_url LIKE 'http://%') AND char_length(feed_url) <= 2048)),
  ADD COLUMN feed_status text NOT NULL DEFAULT 'none'
    CHECK (feed_status IN ('none', 'unchecked', 'ok', 'failing', 'quarantined')),
  ADD COLUMN feed_title text CHECK (feed_title IS NULL OR char_length(feed_title) <= 300),
  ADD COLUMN feed_checked_at timestamptz,
  -- A stable error code only (e.g. "fetch:address", "feed:xml_doctype").
  ADD COLUMN feed_error text CHECK (feed_error IS NULL OR feed_error ~ '^[a-z_]+(:[a-z_0-9]+)?$'),
  ADD COLUMN consecutive_failures integer NOT NULL DEFAULT 0 CHECK (consecutive_failures >= 0),
  ADD COLUMN next_fetch_at timestamptz,
  ADD COLUMN etag text CHECK (etag IS NULL OR char_length(etag) <= 300),
  ADD COLUMN last_modified text CHECK (last_modified IS NULL OR char_length(last_modified) <= 100),
  ADD CONSTRAINT sources_feed_status_needs_url CHECK ((feed_url IS NULL) = (feed_status = 'none'));

CREATE UNIQUE INDEX sources_feed_url_unique ON sources (lower(feed_url)) WHERE feed_url IS NOT NULL;
CREATE INDEX sources_feed_due ON sources (next_fetch_at)
  WHERE feed_url IS NOT NULL AND status = 'verified';

-- Every feed check, kept as evidence. Immutable.
CREATE TABLE source_checks (
  id           uuid PRIMARY KEY DEFAULT uuidv7(),
  source_id    uuid NOT NULL REFERENCES sources (id) ON DELETE RESTRICT,
  ok           boolean NOT NULL,
  http_status  integer CHECK (http_status IS NULL OR http_status BETWEEN 100 AND 599),
  feed_format  text CHECK (feed_format IS NULL OR feed_format IN ('rss', 'atom', 'rdf')),
  item_count   integer CHECK (item_count IS NULL OR item_count BETWEEN 0 AND 1000),
  error        text CHECK (error IS NULL OR error ~ '^[a-z_]+(:[a-z_0-9]+)?$'),
  duration_ms  integer CHECK (duration_ms IS NULL OR duration_ms >= 0),
  checked_at   timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT source_checks_outcome CHECK (ok = (error IS NULL))
);

CREATE INDEX source_checks_source_idx ON source_checks (source_id, checked_at DESC);

CREATE TRIGGER source_checks_no_update_delete
  BEFORE UPDATE OR DELETE ON source_checks
  FOR EACH ROW EXECUTE FUNCTION nalara_reject_mutation();
CREATE TRIGGER source_checks_no_truncate
  BEFORE TRUNCATE ON source_checks
  FOR EACH STATEMENT EXECUTE FUNCTION nalara_reject_mutation();

GRANT SELECT ON source_checks TO nalara_app;
GRANT SELECT, INSERT ON source_checks TO nalara_worker;

GRANT SELECT (id, status, feed_url, feed_status, etag, last_modified, consecutive_failures,
              next_fetch_at)
  ON sources TO nalara_worker;
GRANT UPDATE (feed_status, feed_title, feed_checked_at, feed_error, consecutive_failures,
              next_fetch_at, etag, last_modified)
  ON sources TO nalara_worker;
