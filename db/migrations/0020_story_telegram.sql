-- 0020: the proposal package on Telegram (P5-03, D-32). When a drafted story's cited sources are
-- archived, the worker sends the founder one message with buttons. The route decides what the ✅
-- button may do (D-32, "campuran"):
--   fast   = the draft cites a primary official source: ✅ records the founder's source check and
--            publishes that exact revision;
--   review = media sources only: no ✅ in Telegram; the founder checks and publishes in the OS.
-- A button token is single use, expires within 24 hours, and is bound to the revision that was
-- shown: if the draft changes afterwards, the token is refused.

-- The API prepares the package when the draft is submitted (text, revision, sources, route), so
-- the worker never reads article content: it only checks the evidence and that the draft is still
-- that revision, then sends.
ALTER TABLE story_queue
  ADD COLUMN route        text CHECK (route IS NULL OR route IN ('fast', 'review')),
  ADD COLUMN revision_id  uuid REFERENCES article_revisions (id) ON DELETE RESTRICT,
  ADD COLUMN package_text text CHECK (package_text IS NULL OR char_length(package_text) <= 4000),
  ADD COLUMN source_urls  text[] CHECK (source_urls IS NULL OR cardinality(source_urls) <= 12),
  ADD COLUMN sent_at      timestamptz;

CREATE TABLE story_tokens (
  id           uuid PRIMARY KEY DEFAULT uuidv7(),
  story_id     uuid NOT NULL REFERENCES story_queue (id) ON DELETE RESTRICT,
  decision     text NOT NULL CHECK (decision IN ('publish', 'skip')),
  -- The revision shown in the message; the button acts on nothing else.
  revision_id  uuid NOT NULL REFERENCES article_revisions (id) ON DELETE RESTRICT,
  token_hash   bytea NOT NULL UNIQUE CHECK (octet_length(token_hash) = 32),
  created_at   timestamptz NOT NULL DEFAULT now(),
  expires_at   timestamptz NOT NULL,
  consumed_at  timestamptz,
  CONSTRAINT story_tokens_expiry CHECK (
    expires_at > created_at AND expires_at <= created_at + interval '1 day'),
  CONSTRAINT story_tokens_one_per_decision UNIQUE (story_id, decision)
);

-- Consumed once; nothing else ever changes, nothing is deleted.
CREATE FUNCTION nalara_story_token_once() RETURNS trigger
  LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP <> 'UPDATE' OR OLD.consumed_at IS NOT NULL OR NEW.consumed_at IS NULL
     OR NEW.id <> OLD.id OR NEW.story_id <> OLD.story_id OR NEW.decision <> OLD.decision
     OR NEW.revision_id <> OLD.revision_id OR NEW.token_hash <> OLD.token_hash
     OR NEW.created_at <> OLD.created_at OR NEW.expires_at <> OLD.expires_at THEN
    RAISE EXCEPTION 'story_tokens are consumed once'
      USING ERRCODE = 'insufficient_privilege';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER story_tokens_once
  BEFORE UPDATE OR DELETE ON story_tokens
  FOR EACH ROW EXECUTE FUNCTION nalara_story_token_once();
CREATE TRIGGER story_tokens_no_truncate
  BEFORE TRUNCATE ON story_tokens
  FOR EACH STATEMENT EXECUTE FUNCTION nalara_reject_mutation();

-- The API consumes tokens and decides (publish runs the normal workflow as the founder).
GRANT SELECT ON story_tokens TO nalara_app;
GRANT UPDATE (consumed_at) ON story_tokens TO nalara_app;
GRANT UPDATE (route, revision_id, package_text, source_urls) ON story_queue TO nalara_app;

-- The worker (the only process that reaches Telegram) finds drafted stories whose sources are
-- archived, sends the prepared text and stores the tokens. It never reads article content: only
-- whether the draft is still the prepared revision.
GRANT SELECT ON story_queue TO nalara_worker;
GRANT UPDATE (status, sent_at, note, updated_at) ON story_queue TO nalara_worker;
GRANT SELECT (id, current_revision_id, status) ON articles TO nalara_worker;
GRANT SELECT (story_id), INSERT ON story_tokens TO nalara_worker;
