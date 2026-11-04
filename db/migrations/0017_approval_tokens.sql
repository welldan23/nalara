-- 0017: Telegram approval tokens (P3-04, PRD v4 §8 "approval palsu"). The worker sends the
-- founder a message per new proposal with two buttons; each button carries a random token whose
-- SHA-256 is stored here. A token is single use, expires, is bound to one proposal and decision,
-- and is consumed atomically by the API's webhook (which also voids its sibling).

CREATE TABLE approval_tokens (
  id           uuid PRIMARY KEY DEFAULT uuidv7(),
  proposal_id  uuid NOT NULL REFERENCES ai_action_proposals (id) ON DELETE RESTRICT,
  decision     text NOT NULL CHECK (decision IN ('approve', 'reject')),
  token_hash   bytea NOT NULL UNIQUE CHECK (octet_length(token_hash) = 32),
  created_at   timestamptz NOT NULL DEFAULT now(),
  expires_at   timestamptz NOT NULL,
  consumed_at  timestamptz,
  CONSTRAINT approval_tokens_expiry CHECK (
    expires_at > created_at AND expires_at <= created_at + interval '7 days'),
  CONSTRAINT approval_tokens_one_per_decision UNIQUE (proposal_id, decision)
);

-- Consumed once; nothing else ever changes, nothing is deleted.
CREATE FUNCTION nalara_approval_token_once() RETURNS trigger
  LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP <> 'UPDATE' OR OLD.consumed_at IS NOT NULL OR NEW.consumed_at IS NULL
     OR NEW.id <> OLD.id OR NEW.proposal_id <> OLD.proposal_id OR NEW.decision <> OLD.decision
     OR NEW.token_hash <> OLD.token_hash OR NEW.created_at <> OLD.created_at
     OR NEW.expires_at <> OLD.expires_at THEN
    RAISE EXCEPTION 'approval_tokens are consumed once'
      USING ERRCODE = 'insufficient_privilege';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER approval_tokens_once
  BEFORE UPDATE OR DELETE ON approval_tokens
  FOR EACH ROW EXECUTE FUNCTION nalara_approval_token_once();
CREATE TRIGGER approval_tokens_no_truncate
  BEFORE TRUNCATE ON approval_tokens
  FOR EACH STATEMENT EXECUTE FUNCTION nalara_reject_mutation();

-- The API consumes tokens.
GRANT SELECT ON approval_tokens TO nalara_app;
GRANT UPDATE (consumed_at) ON approval_tokens TO nalara_app;
-- The worker finds proposals that still need a message and stores the tokens it sends. It reads
-- only what the message shows (never the payload) and cannot consume a token.
GRANT SELECT (id, kind, agent_role, reason, status, expires_at, created_at)
  ON ai_action_proposals TO nalara_worker;
GRANT SELECT (proposal_id), INSERT ON approval_tokens TO nalara_worker;
