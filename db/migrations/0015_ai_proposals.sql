-- 0015: proposals and approvals (P3-01, PRD v4 §6.3, ADR-020). AI agents never change anything
-- themselves: what they want changed becomes a proposal, and only the founder's approval applies
-- it. A proposal is written once and decided once (pending → approved/rejected/failed/expired);
-- its payload and target never change. Each decision is kept in approvals, which is immutable.

CREATE TABLE ai_action_proposals (
  id             uuid PRIMARY KEY DEFAULT uuidv7(),
  kind           text NOT NULL CHECK (kind IN (
                   'sources.propose_create', 'sources.propose_update',
                   'preferences.propose_update', 'inbox.propose_flag', 'articles.propose_note')),
  agent_role     text NOT NULL CHECK (agent_role IN (
                   'radar', 'penulis', 'pemeriksa', 'periset', 'pemantau')),
  -- Validated by the API per kind; bounded so a runaway agent cannot fill the database.
  payload        jsonb NOT NULL CHECK (jsonb_typeof(payload) = 'object'
                   AND octet_length(payload::text) <= 16384),
  reason         text NOT NULL CHECK (char_length(reason) BETWEEN 1 AND 1000),
  -- What the proposal is about, and the version it was written against (optimistic lock).
  target_type    text CHECK (target_type IS NULL OR target_type IN (
                   'source', 'preferences', 'discovered_item', 'article')),
  target_id      uuid,
  target_version integer CHECK (target_version IS NULL OR target_version >= 1),
  status         text NOT NULL DEFAULT 'pending' CHECK (status IN (
                   'pending', 'approved', 'rejected', 'failed', 'expired')),
  -- Why an approved proposal could not be applied (stable code, never a message).
  failure        text CHECK (failure IS NULL OR failure ~ '^[a-z_]+(:[a-z_0-9]+)?$'),
  -- What applying it created (e.g. the new source).
  result_id      uuid,
  created_at     timestamptz NOT NULL DEFAULT now(),
  expires_at     timestamptz NOT NULL DEFAULT now() + interval '7 days',
  decided_at     timestamptz,
  CONSTRAINT proposals_target_complete CHECK ((target_type IS NULL) = (target_id IS NULL)),
  CONSTRAINT proposals_decided CHECK ((status = 'pending') = (decided_at IS NULL)),
  CONSTRAINT proposals_failed_has_code CHECK ((status = 'failed') = (failure IS NOT NULL)),
  CONSTRAINT proposals_expiry_after_creation CHECK (expires_at > created_at)
);

CREATE INDEX proposals_pending_idx ON ai_action_proposals (created_at DESC) WHERE status = 'pending';
CREATE INDEX proposals_list_idx ON ai_action_proposals (status, created_at DESC);
CREATE INDEX proposals_target_idx ON ai_action_proposals (target_type, target_id);

-- Decided once; nothing but the decision columns ever changes, and nothing is deleted.
CREATE FUNCTION nalara_proposal_once() RETURNS trigger
  LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP <> 'UPDATE' OR OLD.status <> 'pending' OR NEW.status = 'pending'
     OR NEW.kind <> OLD.kind OR NEW.agent_role <> OLD.agent_role
     OR NEW.payload <> OLD.payload OR NEW.reason <> OLD.reason
     OR NEW.target_type IS DISTINCT FROM OLD.target_type
     OR NEW.target_id IS DISTINCT FROM OLD.target_id
     OR NEW.target_version IS DISTINCT FROM OLD.target_version
     OR NEW.created_at <> OLD.created_at OR NEW.expires_at <> OLD.expires_at THEN
    RAISE EXCEPTION 'ai_action_proposals is decided once'
      USING ERRCODE = 'insufficient_privilege';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER proposals_once
  BEFORE UPDATE OR DELETE ON ai_action_proposals
  FOR EACH ROW EXECUTE FUNCTION nalara_proposal_once();
CREATE TRIGGER proposals_no_truncate
  BEFORE TRUNCATE ON ai_action_proposals
  FOR EACH STATEMENT EXECUTE FUNCTION nalara_reject_mutation();

-- One decision per proposal, by the founder, through the OS or Telegram (P3-04).
CREATE TABLE approvals (
  id           uuid PRIMARY KEY DEFAULT uuidv7(),
  proposal_id  uuid NOT NULL UNIQUE REFERENCES ai_action_proposals (id) ON DELETE RESTRICT,
  decision     text NOT NULL CHECK (decision IN ('approve', 'reject')),
  channel      text NOT NULL CHECK (channel IN ('os', 'telegram')),
  decided_by   uuid NOT NULL REFERENCES users (id),
  decided_at   timestamptz NOT NULL DEFAULT now()
);

CREATE TRIGGER approvals_no_update_delete
  BEFORE UPDATE OR DELETE ON approvals
  FOR EACH ROW EXECUTE FUNCTION nalara_reject_mutation();
CREATE TRIGGER approvals_no_truncate
  BEFORE TRUNCATE ON approvals
  FOR EACH STATEMENT EXECUTE FUNCTION nalara_reject_mutation();

-- What the founder tells the agents (topics, house notes). A single row, versioned so a
-- proposal written against an old version fails instead of overwriting newer wishes.
CREATE TABLE agent_preferences (
  id          smallint PRIMARY KEY DEFAULT 1 CHECK (id = 1),
  topics      text[] NOT NULL DEFAULT '{}' CHECK (cardinality(topics) <= 20),
  notes       text NOT NULL DEFAULT '' CHECK (char_length(notes) <= 2000),
  version     integer NOT NULL DEFAULT 1 CHECK (version >= 1),
  updated_at  timestamptz NOT NULL DEFAULT now()
);

-- D-17 topics as the starting point.
INSERT INTO agent_preferences (topics) VALUES (ARRAY['Ekonomi', 'Teknologi', 'Kebijakan']);

CREATE TRIGGER agent_preferences_no_delete
  BEFORE DELETE ON agent_preferences
  FOR EACH ROW EXECUTE FUNCTION nalara_reject_mutation();
CREATE TRIGGER agent_preferences_no_truncate
  BEFORE TRUNCATE ON agent_preferences
  FOR EACH STATEMENT EXECUTE FUNCTION nalara_reject_mutation();

-- The API (founder routes and, from P3-02, the agent gateway) writes proposals and decides them.
GRANT SELECT, INSERT ON ai_action_proposals TO nalara_app;
GRANT UPDATE (status, failure, result_id, decided_at) ON ai_action_proposals TO nalara_app;
GRANT SELECT, INSERT ON approvals TO nalara_app;
GRANT SELECT ON agent_preferences TO nalara_app;
GRANT UPDATE (topics, notes, version, updated_at) ON agent_preferences TO nalara_app;
