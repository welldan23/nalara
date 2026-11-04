-- 0016: agent tool gateway (P3-02, ADR-020). Agents reach NALARA only through /api/v1/agent/*,
-- authenticated by a random token whose SHA-256 is stored here. AI is off until the founder
-- switches it on (kill switch), and daily quotas cap what an agent can do even when it is on.

-- Agents act in the audit log as their own actor type; they are not users, so no actor_id (the
-- credential is named in the event's metadata instead).
ALTER TABLE audit_events DROP CONSTRAINT audit_events_actor_type_check;
ALTER TABLE audit_events ADD CONSTRAINT audit_events_actor_type_check
  CHECK (actor_type IN ('founder', 'system', 'agent'));
ALTER TABLE audit_events ADD CONSTRAINT audit_events_agent_has_no_actor
  CHECK (actor_type <> 'agent' OR actor_id IS NULL);

CREATE TABLE agent_credentials (
  id            uuid PRIMARY KEY DEFAULT uuidv7(),
  label         text NOT NULL CHECK (label ~ '^[a-z0-9][a-z0-9-]{1,39}$'),
  -- SHA-256 of a 256-bit random token; the token itself is shown once and never stored.
  token_hash    bytea NOT NULL UNIQUE CHECK (octet_length(token_hash) = 32),
  created_at    timestamptz NOT NULL DEFAULT now(),
  last_used_at  timestamptz,
  revoked_at    timestamptz
);

CREATE UNIQUE INDEX agent_credentials_active_label ON agent_credentials (label)
  WHERE revoked_at IS NULL;

-- Revoked credentials stay as history; a revocation cannot be undone.
CREATE FUNCTION nalara_agent_credential_rules() RETURNS trigger
  LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP <> 'UPDATE' OR NEW.id <> OLD.id OR NEW.label <> OLD.label
     OR NEW.token_hash <> OLD.token_hash OR NEW.created_at <> OLD.created_at
     OR (OLD.revoked_at IS NOT NULL AND NEW.revoked_at IS DISTINCT FROM OLD.revoked_at) THEN
    RAISE EXCEPTION 'agent_credentials: only last use and revocation change'
      USING ERRCODE = 'insufficient_privilege';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER agent_credentials_rules
  BEFORE UPDATE OR DELETE ON agent_credentials
  FOR EACH ROW EXECUTE FUNCTION nalara_agent_credential_rules();
CREATE TRIGGER agent_credentials_no_truncate
  BEFORE TRUNCATE ON agent_credentials
  FOR EACH STATEMENT EXECUTE FUNCTION nalara_reject_mutation();

-- The kill switch and quotas: a single versioned row, AI off by default.
CREATE TABLE system_settings (
  id                    smallint PRIMARY KEY DEFAULT 1 CHECK (id = 1),
  ai_enabled            boolean NOT NULL DEFAULT false,
  daily_draft_quota     integer NOT NULL DEFAULT 3 CHECK (daily_draft_quota BETWEEN 0 AND 50),
  daily_proposal_quota  integer NOT NULL DEFAULT 30 CHECK (daily_proposal_quota BETWEEN 0 AND 500),
  daily_token_quota     integer NOT NULL DEFAULT 200000
                          CHECK (daily_token_quota BETWEEN 0 AND 10000000),
  version               integer NOT NULL DEFAULT 1 CHECK (version >= 1),
  updated_at            timestamptz NOT NULL DEFAULT now()
);

INSERT INTO system_settings DEFAULT VALUES;

CREATE TRIGGER system_settings_no_delete
  BEFORE DELETE ON system_settings
  FOR EACH ROW EXECUTE FUNCTION nalara_reject_mutation();
CREATE TRIGGER system_settings_no_truncate
  BEFORE TRUNCATE ON system_settings
  FOR EACH STATEMENT EXECUTE FUNCTION nalara_reject_mutation();

-- Token use reported by the runner per model call (for the founder's cost overview and the
-- daily token quota). Immutable.
CREATE TABLE agent_usage (
  id             uuid PRIMARY KEY DEFAULT uuidv7(),
  credential_id  uuid NOT NULL REFERENCES agent_credentials (id) ON DELETE RESTRICT,
  agent_role     text NOT NULL CHECK (agent_role IN (
                   'radar', 'penulis', 'pemeriksa', 'periset', 'pemantau')),
  model          text NOT NULL CHECK (model ~ '^[A-Za-z0-9._:/-]{1,100}$'),
  input_tokens   integer NOT NULL CHECK (input_tokens BETWEEN 0 AND 2000000),
  output_tokens  integer NOT NULL CHECK (output_tokens BETWEEN 0 AND 2000000),
  created_at     timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX agent_usage_created_idx ON agent_usage (created_at DESC);

CREATE TRIGGER agent_usage_no_update_delete
  BEFORE UPDATE OR DELETE ON agent_usage
  FOR EACH ROW EXECUTE FUNCTION nalara_reject_mutation();
CREATE TRIGGER agent_usage_no_truncate
  BEFORE TRUNCATE ON agent_usage
  FOR EACH STATEMENT EXECUTE FUNCTION nalara_reject_mutation();

-- Quota counts look back one day by action and actor type.
CREATE INDEX audit_events_agent_idx ON audit_events (action, created_at DESC)
  WHERE actor_type = 'agent';

GRANT SELECT, INSERT ON agent_credentials TO nalara_app;
GRANT UPDATE (last_used_at, revoked_at) ON agent_credentials TO nalara_app;
GRANT SELECT ON system_settings TO nalara_app;
GRANT UPDATE (ai_enabled, daily_draft_quota, daily_proposal_quota, daily_token_quota, version,
              updated_at)
  ON system_settings TO nalara_app;
GRANT SELECT, INSERT ON agent_usage TO nalara_app;
