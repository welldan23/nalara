-- 0002: password-step challenges and per-account lockout (ADR-004, ADR-005, P0-008).
-- A correct password yields only a short-lived, single-use challenge; a full session is minted
-- after the second factor (P0-009). Failure counters live in the database so they survive
-- restarts (S-05).

ALTER TABLE users
  ADD COLUMN failed_login_attempts integer NOT NULL DEFAULT 0 CHECK (failed_login_attempts >= 0),
  ADD COLUMN locked_until timestamptz;

CREATE TABLE login_challenges (
  id         uuid PRIMARY KEY DEFAULT uuidv7(),
  user_id    uuid NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  -- SHA-256 of the opaque challenge token; the token itself is never stored.
  token_hash bytea NOT NULL CHECK (octet_length(token_hash) = 32),
  -- 'enrolment': MFA not yet set up, may only call mfa/setup + mfa/verify.
  -- 'mfa': MFA set up, may only submit a TOTP or recovery code.
  scope      text NOT NULL CHECK (scope IN ('enrolment', 'mfa')),
  expires_at timestamptz NOT NULL,
  used_at    timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT login_challenges_token_hash_unique UNIQUE (token_hash),
  CONSTRAINT login_challenges_expiry_after_creation CHECK (expires_at > created_at)
);

CREATE INDEX login_challenges_user_idx ON login_challenges (user_id, created_at DESC);

GRANT SELECT, INSERT, UPDATE, DELETE ON login_challenges TO nalara_app;
