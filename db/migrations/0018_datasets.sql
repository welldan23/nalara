-- 0018: NALARA Data catalogue (P4-02, PRD v4 §6.3, ADR-021). A dataset belongs to a source in
-- the registry and carries its own licence and methodology. Each version keeps the raw file
-- (bytes + SHA-256), the declarative transform, and the resulting observations (+ SHA-256), and is
-- immutable: corrections are new versions with a revision note. Nothing is ever deleted.

CREATE TABLE datasets (
  id                uuid PRIMARY KEY DEFAULT uuidv7(),
  slug              text NOT NULL UNIQUE CHECK (slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$'
                      AND char_length(slug) BETWEEN 3 AND 80),
  title             text NOT NULL CHECK (char_length(title) BETWEEN 3 AND 200),
  description       text NOT NULL DEFAULT '' CHECK (char_length(description) <= 2000),
  source_id         uuid NOT NULL REFERENCES sources (id) ON DELETE RESTRICT,
  -- The publisher's page for this dataset (readers go there to check).
  source_page_url   text NOT NULL CHECK (source_page_url LIKE 'https://%'
                      AND char_length(source_page_url) <= 2048),
  unit              text NOT NULL CHECK (char_length(unit) BETWEEN 1 AND 60),
  frequency         text NOT NULL CHECK (frequency IN (
                      'annual', 'quarterly', 'monthly', 'daily', 'irregular')),
  methodology       text NOT NULL DEFAULT '' CHECK (char_length(methodology) <= 4000),
  license_status    text NOT NULL DEFAULT 'unknown' CHECK (license_status IN (
                      'unknown', 'open', 'attribution_required', 'permission_required',
                      'restricted')),
  license_note      text CHECK (license_note IS NULL OR char_length(license_note) <= 500),
  attribution       text CHECK (attribution IS NULL OR char_length(attribution) <= 300),
  status            text NOT NULL DEFAULT 'draft' CHECK (status IN (
                      'draft', 'published', 'retracted')),
  -- The version readers see; earlier versions stay readable as history.
  published_version integer CHECK (published_version IS NULL OR published_version >= 1),
  published_at      timestamptz,
  version           integer NOT NULL DEFAULT 1 CHECK (version >= 1),
  created_by        uuid NOT NULL REFERENCES users (id),
  created_at        timestamptz NOT NULL DEFAULT now(),
  updated_at        timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT datasets_published_has_version CHECK (
    status <> 'published' OR (published_version IS NOT NULL AND published_at IS NOT NULL)),
  CONSTRAINT datasets_attribution_when_required CHECK (
    license_status <> 'attribution_required' OR attribution IS NOT NULL),
  -- Never publish data whose terms are unknown or closed (PRD v4 R-04); "permission required"
  -- needs the permission written down.
  CONSTRAINT datasets_publishable_license CHECK (
    status <> 'published' OR (
      license_status IN ('open', 'attribution_required')
      OR (license_status = 'permission_required' AND license_note IS NOT NULL)))
);

CREATE INDEX datasets_status_idx ON datasets (status, title);

CREATE TABLE dataset_versions (
  id                   uuid PRIMARY KEY DEFAULT uuidv7(),
  dataset_id           uuid NOT NULL REFERENCES datasets (id) ON DELETE RESTRICT,
  version              integer NOT NULL CHECK (version >= 1),
  raw                  bytea NOT NULL CHECK (octet_length(raw) BETWEEN 1 AND 5242880),
  raw_sha256           bytea NOT NULL CHECK (octet_length(raw_sha256) = 32),
  raw_filename         text NOT NULL CHECK (raw_filename ~ '^[A-Za-z0-9._ ()-]{1,120}$'),
  -- Where exactly the file came from, and when the founder took it.
  file_url             text NOT NULL CHECK (file_url LIKE 'https://%' AND char_length(file_url) <= 2048),
  retrieved_on         date NOT NULL,
  spec                 jsonb NOT NULL CHECK (jsonb_typeof(spec) = 'object'),
  observations         jsonb NOT NULL CHECK (jsonb_typeof(observations) = 'array'),
  observations_sha256  bytea NOT NULL CHECK (octet_length(observations_sha256) = 32),
  observation_count    integer NOT NULL CHECK (observation_count BETWEEN 1 AND 20000),
  series               text[] NOT NULL DEFAULT '{}' CHECK (cardinality(series) <= 20),
  period_start         text NOT NULL CHECK (char_length(period_start) BETWEEN 4 AND 10),
  period_end           text NOT NULL CHECK (char_length(period_end) BETWEEN 4 AND 10),
  revision_note        text NOT NULL CHECK (char_length(revision_note) BETWEEN 3 AND 1000),
  created_by           uuid NOT NULL REFERENCES users (id),
  created_at           timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT dataset_versions_unique UNIQUE (dataset_id, version)
);

-- Versions are evidence: never changed, never deleted.
CREATE TRIGGER dataset_versions_no_update_delete
  BEFORE UPDATE OR DELETE ON dataset_versions
  FOR EACH ROW EXECUTE FUNCTION nalara_reject_mutation();
CREATE TRIGGER dataset_versions_no_truncate
  BEFORE TRUNCATE ON dataset_versions
  FOR EACH STATEMENT EXECUTE FUNCTION nalara_reject_mutation();
CREATE TRIGGER datasets_no_delete
  BEFORE DELETE ON datasets
  FOR EACH ROW EXECUTE FUNCTION nalara_reject_mutation();
CREATE TRIGGER datasets_no_truncate
  BEFORE TRUNCATE ON datasets
  FOR EACH STATEMENT EXECUTE FUNCTION nalara_reject_mutation();

GRANT SELECT, INSERT ON datasets TO nalara_app;
GRANT UPDATE (title, description, source_page_url, unit, frequency, methodology, license_status,
              license_note, attribution, status, published_version, published_at, version,
              updated_at)
  ON datasets TO nalara_app;
GRANT SELECT, INSERT ON dataset_versions TO nalara_app;
