-- 0005: citations live inside each revision (P1-04, ADR-019). They are part of the content hash,
-- so changing, adding or re-verifying a source after approval invalidates that approval
-- (PRD v4 §7: "revisi berubah setelah approval → diblok"). Adding a column with a constant
-- default does not rewrite rows and does not fire the immutability trigger.
ALTER TABLE article_revisions
  ADD COLUMN citations jsonb NOT NULL DEFAULT '[]'::jsonb
    CONSTRAINT article_revisions_citations_array CHECK (jsonb_typeof(citations) = 'array'),
  ADD CONSTRAINT article_revisions_citations_limit CHECK (jsonb_array_length(citations) <= 30);
