-- 0004: editorial core (P1-01). Topics, articles and immutable revisions (ADR-011, ADR-012,
-- ADR-016, ADR-019, D-17). Runs as nalara_migrator inside one transaction.
-- An article row holds identity and state; every piece of content lives in a revision.

CREATE TABLE categories (
  id          uuid PRIMARY KEY DEFAULT uuidv7(),
  slug        text NOT NULL,
  name        text NOT NULL CHECK (char_length(name) BETWEEN 1 AND 60),
  description text CHECK (description IS NULL OR char_length(description) <= 300),
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT categories_slug_format CHECK (slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$' AND char_length(slug) <= 60),
  CONSTRAINT categories_slug_unique UNIQUE (slug)
);

-- Initial topics (D-17). New topics come through a later migration or the OS.
INSERT INTO categories (slug, name, description) VALUES
  ('ekonomi', 'Ekonomi', 'Harga, kerja, pajak, keuangan, dan kebijakan ekonomi yang menyentuh sehari-hari.'),
  ('teknologi', 'Teknologi', 'Teknologi, internet, dan kecerdasan buatan: cara kerja dan dampaknya.'),
  ('kebijakan', 'Kebijakan', 'Aturan dan keputusan pemerintah: isinya apa, siapa yang terdampak, dan kenapa.');

CREATE TABLE articles (
  id                      uuid PRIMARY KEY DEFAULT uuidv7(),
  slug                    text NOT NULL,
  status                  text NOT NULL DEFAULT 'draft'
                            CHECK (status IN ('draft', 'in_review', 'approved', 'published', 'archived')),
  -- Version of the latest revision; clients send it back as expected_version (optimistic locking).
  current_version         integer NOT NULL DEFAULT 0 CHECK (current_version >= 0),
  current_revision_id     uuid,
  -- Approval is bound to one revision and the SHA-256 of its canonical content (ADR-012).
  approved_revision_id    uuid,
  approved_content_sha256 bytea CHECK (approved_content_sha256 IS NULL OR octet_length(approved_content_sha256) = 32),
  approved_by             uuid REFERENCES users (id),
  approved_at             timestamptz,
  published_at            timestamptz,
  -- Set once on the first publish; afterwards the slug is locked (ADR-016).
  first_published_at      timestamptz,
  created_by              uuid NOT NULL REFERENCES users (id),
  created_at              timestamptz NOT NULL DEFAULT now(),
  updated_at              timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT articles_slug_format CHECK (slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$' AND char_length(slug) BETWEEN 3 AND 120),
  CONSTRAINT articles_slug_unique UNIQUE (slug),
  -- An approval is all-or-nothing.
  CONSTRAINT articles_approval_complete CHECK (
    (approved_revision_id IS NULL) = (approved_content_sha256 IS NULL)
    AND (approved_revision_id IS NULL) = (approved_by IS NULL)
    AND (approved_revision_id IS NULL) = (approved_at IS NULL)
  ),
  CONSTRAINT articles_approved_states_need_approval CHECK (
    status NOT IN ('approved', 'published') OR approved_revision_id IS NOT NULL
  ),
  CONSTRAINT articles_published_has_dates CHECK (
    status <> 'published' OR (published_at IS NOT NULL AND first_published_at IS NOT NULL)
  ),
  CONSTRAINT articles_has_revision CHECK ((current_version = 0) = (current_revision_id IS NULL))
);

CREATE TABLE article_revisions (
  id             uuid PRIMARY KEY DEFAULT uuidv7(),
  article_id     uuid NOT NULL REFERENCES articles (id) ON DELETE RESTRICT,
  version        integer NOT NULL CHECK (version >= 1),
  title          text NOT NULL CHECK (char_length(title) BETWEEN 1 AND 200),
  dek            text NOT NULL DEFAULT '' CHECK (char_length(dek) <= 400),
  article_type   text NOT NULL CHECK (article_type IN ('explainer', 'analysis', 'opinion')),
  category_id    uuid NOT NULL REFERENCES categories (id),
  -- Validated content blocks (ADR-011). Never HTML.
  body           jsonb NOT NULL CHECK (jsonb_typeof(body) = 'array'),
  -- What the founder typed, so the editor can show it again.
  body_source    text NOT NULL CHECK (char_length(body_source) <= 100000),
  method_note    text CHECK (method_note IS NULL OR char_length(method_note) <= 2000),
  change_note    text NOT NULL CHECK (char_length(change_note) BETWEEN 1 AND 300),
  content_sha256 bytea NOT NULL CHECK (octet_length(content_sha256) = 32),
  created_by     uuid NOT NULL REFERENCES users (id),
  created_at     timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT article_revisions_version_unique UNIQUE (article_id, version),
  -- Target for the composite foreign keys below: a pointer can only name this article's revision.
  CONSTRAINT article_revisions_article_id_unique UNIQUE (article_id, id)
);

CREATE INDEX article_revisions_category_idx ON article_revisions (category_id);
CREATE INDEX articles_status_published_idx ON articles (status, published_at DESC);

ALTER TABLE articles
  ADD CONSTRAINT articles_current_revision_fk
    FOREIGN KEY (id, current_revision_id) REFERENCES article_revisions (article_id, id),
  ADD CONSTRAINT articles_approved_revision_fk
    FOREIGN KEY (id, approved_revision_id) REFERENCES article_revisions (article_id, id);

-- Revisions are immutable for everyone, the migrator included (pattern from VORSA x SENTINEL).
-- Grants already keep the app role out; the trigger also stops mistakes by privileged roles.
CREATE FUNCTION nalara_reject_mutation() RETURNS trigger
  LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION '% is immutable: create a new revision instead', TG_TABLE_NAME
    USING ERRCODE = 'insufficient_privilege';
END;
$$;

CREATE TRIGGER article_revisions_no_update_delete
  BEFORE UPDATE OR DELETE ON article_revisions
  FOR EACH ROW EXECUTE FUNCTION nalara_reject_mutation();

CREATE TRIGGER article_revisions_no_truncate
  BEFORE TRUNCATE ON article_revisions
  FOR EACH STATEMENT EXECUTE FUNCTION nalara_reject_mutation();

GRANT SELECT ON categories TO nalara_app;
GRANT SELECT, INSERT, UPDATE ON articles TO nalara_app;
GRANT SELECT, INSERT ON article_revisions TO nalara_app;
