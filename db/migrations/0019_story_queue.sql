-- 0019: proposal queue (P5-02, Phase 5 PLAN, D-31). A radar story the Penulis agent takes on
-- becomes one row: the inbox items it is made of (the only material the draft may cite), the
-- score it had, and what became of it. Quotas (per hour, per day) count these rows. Rows are never
-- deleted; the status only moves forward.

CREATE TABLE story_queue (
  id            uuid PRIMARY KEY DEFAULT uuidv7(),
  -- The radar story id (its earliest item): one queue entry per story, ever.
  story_key     uuid NOT NULL UNIQUE,
  title         text NOT NULL CHECK (char_length(title) BETWEEN 1 AND 300),
  item_ids      uuid[] NOT NULL CHECK (cardinality(item_ids) BETWEEN 1 AND 12),
  score         integer NOT NULL CHECK (score BETWEEN 0 AND 100),
  breaking      boolean NOT NULL DEFAULT false,
  status        text NOT NULL DEFAULT 'drafting' CHECK (status IN (
                  'drafting', 'drafted', 'sent', 'published', 'skipped', 'expired')),
  article_id    uuid REFERENCES articles (id) ON DELETE RESTRICT,
  -- What the agent or the founder said when skipping; shown to the founder, never published.
  note          text CHECK (note IS NULL OR char_length(note) <= 1000),
  queued_at     timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT story_queue_drafted_has_article
    CHECK (status IN ('drafting', 'skipped', 'expired') OR article_id IS NOT NULL)
);

CREATE INDEX story_queue_queued_at_idx ON story_queue (queued_at DESC);
CREATE INDEX story_queue_status_idx ON story_queue (status, queued_at DESC);

CREATE TRIGGER story_queue_no_delete
  BEFORE DELETE ON story_queue
  FOR EACH ROW EXECUTE FUNCTION nalara_reject_mutation();
CREATE TRIGGER story_queue_no_truncate
  BEFORE TRUNCATE ON story_queue
  FOR EACH STATEMENT EXECUTE FUNCTION nalara_reject_mutation();

GRANT SELECT, INSERT ON story_queue TO nalara_app;
GRANT UPDATE (status, article_id, note, updated_at) ON story_queue TO nalara_app;
