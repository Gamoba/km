-- Persist the result of validateFeed alongside each cached feed XML so the
-- dashboard can render Klar / Advarsler / Fejl badges without re-running
-- validation on every page load. NULL means "not yet validated" (legacy
-- rows from before this migration).

ALTER TABLE feed_cache ADD COLUMN IF NOT EXISTS validation_status text;
ALTER TABLE feed_cache ADD COLUMN IF NOT EXISTS validation_errors jsonb;
