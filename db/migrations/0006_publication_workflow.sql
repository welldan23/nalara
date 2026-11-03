-- 0006: editorial workflow (P1-03, ADR-012, PRD v4 §6.2, §7). Every status transition is an
-- immutable publication event recording who, when, which revision and its content hash.

-- Founder's explicit reason to publish without a verified source (PRD v4 §7). Part of the
-- approval: cleared whenever the approval is cleared.
ALTER TABLE articles
  ADD COLUMN source_exception text
    CONSTRAINT articles_source_exception_length
      CHECK (source_exception IS NULL OR char_length(source_exception) BETWEEN 20 AND 500),
  ADD CONSTRAINT articles_source_exception_needs_approval
    CHECK (source_exception IS NULL OR approved_revision_id IS NOT NULL);

CREATE TABLE publication_events (
  id             uuid PRIMARY KEY DEFAULT uuidv7(),
  article_id     uuid NOT NULL REFERENCES articles (id) ON DELETE RESTRICT,
  revision_id    uuid NOT NULL,
  action         text NOT NULL CHECK (action IN ('submit', 'return', 'approve', 'publish', 'archive')),
  from_status    text NOT NULL,
  to_status      text NOT NULL,
  content_sha256 bytea NOT NULL CHECK (octet_length(content_sha256) = 32),
  verification   text NOT NULL CHECK (verification IN ('TERVERIFIKASI', 'SEBAGIAN', 'BELUM_TERVERIFIKASI')),
  note           text CHECK (note IS NULL OR char_length(note) <= 500),
  actor_id       uuid NOT NULL REFERENCES users (id),
  created_at     timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT publication_events_revision_fk
    FOREIGN KEY (article_id, revision_id) REFERENCES article_revisions (article_id, id)
);

CREATE INDEX publication_events_article_idx ON publication_events (article_id, created_at);

CREATE TRIGGER publication_events_no_update_delete
  BEFORE UPDATE OR DELETE ON publication_events
  FOR EACH ROW EXECUTE FUNCTION nalara_reject_mutation();

CREATE TRIGGER publication_events_no_truncate
  BEFORE TRUNCATE ON publication_events
  FOR EACH STATEMENT EXECUTE FUNCTION nalara_reject_mutation();

GRANT SELECT, INSERT ON publication_events TO nalara_app;
