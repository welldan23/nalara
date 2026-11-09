-- 0024: autopilot (P5-10, founder: "semua diotomasi, gua tinggal duduk manis"). With the switch on,
-- a story the Pemeriksa check PASSED (P5-09) is published by the API itself, 15 minutes after its
-- package reached Telegram, unless the founder taps ❌ in between. Off by default: the founder
-- turns it on from the chat (/autopilot on), which is audited.
--
-- story_queue.autopilot records that the package told the founder it would publish itself: only
-- those stories are ever published automatically (a story announced as manual stays manual).
ALTER TABLE system_settings ADD COLUMN autopilot boolean NOT NULL DEFAULT false;
GRANT UPDATE (autopilot) ON system_settings TO nalara_app;

ALTER TABLE story_queue
  ADD COLUMN autopilot boolean NOT NULL DEFAULT false,
  ADD COLUMN published_via text CHECK (published_via IN ('founder', 'autopilot'));
GRANT UPDATE (autopilot, published_via) ON story_queue TO nalara_app;
