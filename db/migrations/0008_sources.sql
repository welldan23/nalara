-- 0008: Source Registry, manual (P1-05, PRD v4 §6.2, KP1-01). The founder's list of official
-- sources with status, licence and attribution. No automatic fetching (that is Phase 2, and only
-- for verified sources). Rows are never deleted: a source is disabled instead, and every change is
-- in the audit log.

CREATE TABLE sources (
  id             uuid PRIMARY KEY DEFAULT uuidv7(),
  name           text NOT NULL CHECK (char_length(name) BETWEEN 2 AND 160),
  organization   text NOT NULL CHECK (char_length(organization) BETWEEN 2 AND 160),
  type           text NOT NULL CHECK (type IN (
                   'statistics', 'central_bank', 'ministry', 'regulator', 'legislation',
                   'company', 'academic', 'international', 'media', 'other')),
  -- https only; the API also refuses credentials, whitespace and link shorteners.
  official_url   text NOT NULL CHECK (official_url LIKE 'https://%' AND char_length(official_url) <= 2048),
  license_status text NOT NULL DEFAULT 'unknown' CHECK (license_status IN (
                   'unknown', 'open', 'attribution_required', 'permission_required', 'restricted')),
  license_note   text CHECK (license_note IS NULL OR char_length(license_note) <= 500),
  attribution    text CHECK (attribution IS NULL OR char_length(attribution) <= 300),
  status         text NOT NULL DEFAULT 'candidate' CHECK (status IN (
                   'candidate', 'verified', 'paused', 'disabled')),
  notes          text CHECK (notes IS NULL OR char_length(notes) <= 1000),
  version        integer NOT NULL DEFAULT 1 CHECK (version >= 1),
  created_by     uuid NOT NULL REFERENCES users (id),
  created_at     timestamptz NOT NULL DEFAULT now(),
  updated_at     timestamptz NOT NULL DEFAULT now(),
  -- A source is verified only once its licence is known (PRD v4 §11 R-04: never redistribute
  -- without knowing the terms).
  CONSTRAINT sources_verified_needs_license
    CHECK (status <> 'verified' OR license_status <> 'unknown'),
  -- Licences that oblige credit need the credit line written down.
  CONSTRAINT sources_attribution_when_required
    CHECK (license_status <> 'attribution_required' OR attribution IS NOT NULL)
);

-- One entry per official URL (case-insensitive host, exact path).
CREATE UNIQUE INDEX sources_official_url_unique ON sources (lower(official_url));
CREATE INDEX sources_status_idx ON sources (status, name);

-- No deletes: history lives on, a source is disabled instead.
CREATE TRIGGER sources_no_delete
  BEFORE DELETE ON sources
  FOR EACH ROW EXECUTE FUNCTION nalara_reject_mutation();

CREATE TRIGGER sources_no_truncate
  BEFORE TRUNCATE ON sources
  FOR EACH STATEMENT EXECUTE FUNCTION nalara_reject_mutation();

GRANT SELECT, INSERT, UPDATE ON sources TO nalara_app;
