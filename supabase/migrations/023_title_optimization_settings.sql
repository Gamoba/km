-- Per-feed settings the optimization run needs (the user-authored few-shot
-- examples and char limit, plus optional model/temperature overrides), and a
-- tweak so purely manual edits can exist without a run method.
--
--   1. title_optimization_settings — one row per feed. char_limit defaults to
--      150 (Google MC max); few_shot_examples is the user's hand-written
--      "perfect" titles. model/temperature are optional overrides.
--   2. product_title_optimizations.method → NULLABLE. A human_edited row created
--      by a manual edit (no AI run) has no method; 'auto'/'rule_based' only
--      apply to AI runs.
--
-- Idempotent. Settings are per feed (consistent with title_rules and the rest).

BEGIN;

CREATE TABLE IF NOT EXISTS title_optimization_settings (
  id                uuid        DEFAULT gen_random_uuid() PRIMARY KEY,
  feed_id           uuid        NOT NULL REFERENCES feeds(id) ON DELETE CASCADE,
  char_limit        integer     NOT NULL DEFAULT 150,
  few_shot_examples text        NOT NULL DEFAULT '',
  model             text,
  temperature       numeric,
  updated_at        timestamptz DEFAULT now(),
  UNIQUE (feed_id)
);

ALTER TABLE title_optimization_settings DISABLE ROW LEVEL SECURITY;

CREATE INDEX IF NOT EXISTS idx_title_optimization_settings_feed_id
  ON title_optimization_settings(feed_id);

-- Manual edits have no run method.
ALTER TABLE product_title_optimizations ALTER COLUMN method DROP NOT NULL;

COMMIT;
