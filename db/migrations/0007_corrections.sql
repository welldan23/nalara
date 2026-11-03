-- 0007: corrections (P1-07, PRD v4 §7, AC-MEDIA-05). A correction is a new revision of a
-- published article, approved and published in one founder action, with a note. Substantial
-- corrections are shown to readers (article + /koreksi); minor ones (typos) stay internal.
-- Old revisions are never removed (immutability trigger from 0004).

CREATE TABLE corrections (
  id          uuid PRIMARY KEY DEFAULT uuidv7(),
  article_id  uuid NOT NULL REFERENCES articles (id) ON DELETE RESTRICT,
  revision_id uuid NOT NULL,
  description text NOT NULL CHECK (char_length(description) BETWEEN 10 AND 500),
  substantial boolean NOT NULL,
  -- When readers can see it: set for substantial corrections, null for internal ones.
  visible_at  timestamptz,
  created_by  uuid NOT NULL REFERENCES users (id),
  created_at  timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT corrections_revision_fk
    FOREIGN KEY (article_id, revision_id) REFERENCES article_revisions (article_id, id),
  CONSTRAINT corrections_visibility CHECK (substantial = (visible_at IS NOT NULL))
);

CREATE INDEX corrections_article_idx ON corrections (article_id, created_at);
CREATE INDEX corrections_visible_idx ON corrections (visible_at DESC) WHERE visible_at IS NOT NULL;

CREATE TRIGGER corrections_no_update_delete
  BEFORE UPDATE OR DELETE ON corrections
  FOR EACH ROW EXECUTE FUNCTION nalara_reject_mutation();

CREATE TRIGGER corrections_no_truncate
  BEFORE TRUNCATE ON corrections
  FOR EACH STATEMENT EXECUTE FUNCTION nalara_reject_mutation();

GRANT SELECT, INSERT ON corrections TO nalara_app;

-- The workflow gains one action.
ALTER TABLE publication_events DROP CONSTRAINT publication_events_action_check;
ALTER TABLE publication_events ADD CONSTRAINT publication_events_action_check
  CHECK (action IN ('submit', 'return', 'approve', 'publish', 'archive', 'correct'));
