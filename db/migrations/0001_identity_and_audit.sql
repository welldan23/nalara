-- 0001: founder identity, sessions and append-only audit (ADR-003, ADR-009).
-- Runs as nalara_migrator inside one transaction (see apps/api/src/db/migrate.ts).
-- Never edit this file after it has been applied anywhere: add a new migration instead.

CREATE TABLE users (
  id            uuid PRIMARY KEY DEFAULT uuidv7(),
  email         text NOT NULL,
  password_hash text NOT NULL,
  role          text NOT NULL CHECK (role IN ('founder')),
  mfa_enabled   boolean NOT NULL DEFAULT false,
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT users_email_lowercase CHECK (email = lower(email)),
  CONSTRAINT users_email_unique UNIQUE (email)
);

-- At most one founder; no self-signup exists (ADR-009).
CREATE UNIQUE INDEX users_single_founder ON users (role) WHERE role = 'founder';

CREATE TABLE sessions (
  id           uuid PRIMARY KEY DEFAULT uuidv7(),
  user_id      uuid NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  -- SHA-256 of the opaque session token; the token itself is never stored (ADR-004).
  token_hash   bytea NOT NULL CHECK (octet_length(token_hash) = 32),
  expires_at   timestamptz NOT NULL,
  revoked_at   timestamptz,
  created_at   timestamptz NOT NULL DEFAULT now(),
  last_seen_at timestamptz,
  CONSTRAINT sessions_token_hash_unique UNIQUE (token_hash),
  CONSTRAINT sessions_expiry_after_creation CHECK (expires_at > created_at)
);

CREATE INDEX sessions_user_expires_idx ON sessions (user_id, expires_at);

CREATE TABLE audit_events (
  id            uuid PRIMARY KEY DEFAULT uuidv7(),
  actor_type    text NOT NULL CHECK (actor_type IN ('founder', 'system')),
  actor_id      uuid REFERENCES users (id) ON DELETE SET NULL,
  action        text NOT NULL CHECK (action ~ '^[a-z][a-z0-9_.]{2,63}$'),
  resource_type text,
  resource_id   text,
  result        text NOT NULL CHECK (result IN ('success', 'failure', 'denied')),
  request_id    text,
  metadata      jsonb NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(metadata) = 'object'),
  created_at    timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT audit_events_system_has_no_actor CHECK (actor_type <> 'system' OR actor_id IS NULL)
);

CREATE INDEX audit_events_created_idx ON audit_events (created_at DESC);
CREATE INDEX audit_events_resource_idx ON audit_events (resource_type, resource_id);

-- Least privilege for the application role (ADR-003, S-04).
-- nalara_app may read and write identity/session rows but can only append to the audit log.
GRANT SELECT, INSERT, UPDATE ON users TO nalara_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON sessions TO nalara_app;
GRANT SELECT, INSERT ON audit_events TO nalara_app;
