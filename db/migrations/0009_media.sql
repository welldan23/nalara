-- 0009: media library (P1-09, ADR-020, PRD v4 §6.2, §7). Images are stored in PostgreSQL itself
-- (bytea, at most 5 MiB each) so the encrypted pg_dump backup and the restore drill cover them
-- with no extra volume, script or key, and the API keeps its read-only filesystem.
--
-- The bytes are immutable: the application role may update only the descriptive columns. Rows are
-- never deleted. An image without a licence and credit line cannot be published (gate) and is not
-- served publicly.

CREATE TABLE media_assets (
  id           uuid PRIMARY KEY DEFAULT uuidv7(),
  mime         text NOT NULL CHECK (mime IN ('image/png', 'image/jpeg', 'image/webp')),
  width        integer NOT NULL CHECK (width BETWEEN 1 AND 6000),
  height       integer NOT NULL CHECK (height BETWEEN 1 AND 6000),
  byte_size    integer NOT NULL CHECK (byte_size BETWEEN 1 AND 5242880),
  data         bytea NOT NULL,
  sha256       bytea NOT NULL CHECK (octet_length(sha256) = 32),
  alt_text     text NOT NULL CHECK (char_length(alt_text) BETWEEN 5 AND 300),
  caption      text CHECK (caption IS NULL OR char_length(caption) <= 300),
  -- Where the right to use the image comes from. AI images are labelled for readers.
  usage_basis  text NOT NULL CHECK (usage_basis IN (
                 'own_work', 'licensed', 'official_release', 'public_domain', 'ai_generated')),
  -- Licence name or permission (e.g. "CC BY 4.0", "Izin tertulis dari ..."). NULL = unknown.
  license      text CHECK (license IS NULL OR char_length(license) BETWEEN 2 AND 200),
  -- Credit line shown with the image (e.g. "Foto: NALARA"). NULL = not written yet.
  attribution  text CHECK (attribution IS NULL OR char_length(attribution) BETWEEN 2 AND 300),
  version      integer NOT NULL DEFAULT 1 CHECK (version >= 1),
  created_by   uuid NOT NULL REFERENCES users (id),
  created_at   timestamptz NOT NULL DEFAULT now(),
  updated_at   timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT media_assets_size_matches CHECK (byte_size = octet_length(data))
);

CREATE INDEX media_assets_created_idx ON media_assets (created_at DESC, id DESC);

-- Published articles look up their images by id inside the approved revision's body.
CREATE INDEX article_revisions_body_gin ON article_revisions USING gin (body jsonb_path_ops);

CREATE TRIGGER media_assets_no_delete
  BEFORE DELETE ON media_assets
  FOR EACH ROW EXECUTE FUNCTION nalara_reject_mutation();

CREATE TRIGGER media_assets_no_truncate
  BEFORE TRUNCATE ON media_assets
  FOR EACH STATEMENT EXECUTE FUNCTION nalara_reject_mutation();

GRANT SELECT, INSERT ON media_assets TO nalara_app;
GRANT UPDATE (alt_text, caption, usage_basis, license, attribution, version, updated_at)
  ON media_assets TO nalara_app;
