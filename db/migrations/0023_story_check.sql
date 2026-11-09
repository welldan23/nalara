-- 0023: the Pemeriksa agent checks each drafted story against its archived sources (P5-09,
-- founder: "AI semua yang ngerjain"). The agent quotes the draft and the source; the API checks
-- that both quotes really exist and that every number in the draft is backed by a source quote.
-- Only the API decides the outcome:
--   passed = every check held, a primary official source backs the draft, nothing sensitive;
--   held   = anything else; the founder decides, with the reasons listed.
-- The result is bound to one revision: an edit makes it stale.
ALTER TABLE story_queue
  ADD COLUMN check_status text CHECK (check_status IN ('passed', 'held')),
  ADD COLUMN check_revision_id uuid REFERENCES article_revisions (id) ON DELETE RESTRICT,
  ADD COLUMN check_note text CHECK (check_note IS NULL OR char_length(check_note) <= 2000),
  ADD COLUMN checked_at timestamptz,
  ADD CONSTRAINT story_queue_check_complete CHECK (
    (check_status IS NULL) = (check_revision_id IS NULL)
    AND (check_status IS NULL) = (checked_at IS NULL));

GRANT UPDATE (check_status, check_revision_id, check_note, checked_at) ON story_queue TO nalara_app;
