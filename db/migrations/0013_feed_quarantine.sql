-- 0013: feed quarantine (P2-05). A feed that keeps failing (or points somewhere it must not) is
-- quarantined by the worker: it is no longer fetched until the founder releases it, and no other
-- feed is affected. Releasing sends it back to "unchecked", so it must pass a check again first.

ALTER TABLE sources
  ADD COLUMN feed_quarantined_at timestamptz,
  ADD CONSTRAINT sources_quarantine_consistent
    CHECK ((feed_status = 'quarantined') = (feed_quarantined_at IS NOT NULL));

GRANT UPDATE (feed_quarantined_at) ON sources TO nalara_worker;
