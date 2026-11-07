-- 0021: a short number per story (P5-04). The Telegram package shows "Usulan #12", and the founder
-- edits it from the chat with plain commands ("judul 12: ...", "lihat 12"). The number is only a
-- handle for people: every action still checks the story's state and current revision.
ALTER TABLE story_queue ADD COLUMN number bigint GENERATED ALWAYS AS IDENTITY;
ALTER TABLE story_queue ADD CONSTRAINT story_queue_number_key UNIQUE (number);

-- An edit from the chat sends the story again (P5-04): the API clears sent_at so the worker, which
-- only sends stories never sent, picks the new package up.
GRANT UPDATE (sent_at) ON story_queue TO nalara_app;

-- Each sent revision gets its own buttons: one token per decision per revision (was per story).
ALTER TABLE story_tokens DROP CONSTRAINT story_tokens_one_per_decision;
ALTER TABLE story_tokens
  ADD CONSTRAINT story_tokens_one_per_decision UNIQUE (story_id, decision, revision_id);
