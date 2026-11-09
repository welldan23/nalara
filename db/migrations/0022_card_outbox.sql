-- 0022: Kartu IG to Telegram (P5-04b, founder's "Opsi A"). When an article is published, the API
-- renders its Instagram cards and stores them here with the caption. The worker (the only process
-- with internet egress) sends them to the founder's Telegram chat as an album, then the caption as
-- its own message, ready to copy. The founder posts to Instagram by hand.
--
-- The worker never reads article content: it only reads what the API prepared in this row. Once
-- sent, the images are cleared (they can be rendered again from the OS at any time).

CREATE TABLE card_outbox (
  id             uuid PRIMARY KEY DEFAULT uuidv7(),
  article_id     uuid NOT NULL REFERENCES articles (id) ON DELETE RESTRICT,
  revision_id    uuid NOT NULL REFERENCES article_revisions (id) ON DELETE RESTRICT,
  title          text NOT NULL CHECK (char_length(title) BETWEEN 1 AND 300),
  caption        text NOT NULL CHECK (char_length(caption) BETWEEN 1 AND 4000),
  -- PNG images, in order. At most 10 (a Telegram album).
  slides         bytea[] NOT NULL CHECK (cardinality(slides) <= 10),
  created_at     timestamptz NOT NULL DEFAULT now(),
  album_sent_at  timestamptz,
  sent_at        timestamptz,
  attempts       integer NOT NULL DEFAULT 0 CHECK (attempts BETWEEN 0 AND 100),
  last_error     text CHECK (last_error IS NULL OR char_length(last_error) <= 100),
  -- One post per published revision: publishing the same bytes again queues nothing new.
  CONSTRAINT card_outbox_one_per_revision UNIQUE (article_id, revision_id)
);

CREATE INDEX card_outbox_unsent_idx ON card_outbox (created_at) WHERE sent_at IS NULL;

GRANT SELECT, INSERT ON card_outbox TO nalara_app;
GRANT SELECT (id, title, caption, slides, created_at, album_sent_at, sent_at, attempts)
  ON card_outbox TO nalara_worker;
GRANT UPDATE (slides, album_sent_at, sent_at, attempts, last_error) ON card_outbox TO nalara_worker;
