-- Review flow for AI title optimization: a product whose AI title fails code
-- validation (or whose response can't be parsed) must KEEP its proposed title
-- for manual review instead of being dropped.
--
-- Changes to product_title_optimizations (from migration 020):
--   1. proposed_title (new, nullable)  — the model's title regardless of
--      validation. Null only when there was no parseable response.
--   2. optimized_title → NULLABLE       — the accepted-for-feed title. Null when
--      status = 'needs_review' (nothing accepted yet).
--   3. status gains 'needs_review'      — alongside 'ai_generated' / 'human_edited'.
--   4. validation_issues (new, jsonb)   — why it failed, for the review UI.
--   5. invariant CHECK                  — needs_review ⇒ no optimized_title;
--      ai_generated/human_edited ⇒ has one.
--
-- Idempotent: IF [NOT] EXISTS / DROP IF EXISTS guards so migrate.ts can replay.

BEGIN;

-- 1 + 4. New columns.
ALTER TABLE product_title_optimizations
  ADD COLUMN IF NOT EXISTS proposed_title    text,
  ADD COLUMN IF NOT EXISTS validation_issues jsonb;

-- 2. optimized_title becomes nullable.
ALTER TABLE product_title_optimizations
  ALTER COLUMN optimized_title DROP NOT NULL;

-- 3. Extend the status CHECK to include 'needs_review'. The inline CHECK from
--    020 is auto-named <table>_status_check; drop and recreate it.
ALTER TABLE product_title_optimizations
  DROP CONSTRAINT IF EXISTS product_title_optimizations_status_check;
ALTER TABLE product_title_optimizations
  ADD CONSTRAINT product_title_optimizations_status_check
  CHECK (status IN ('ai_generated', 'human_edited', 'needs_review'));

-- 5. Invariant: a needs_review row has no accepted title; an
--    ai_generated/human_edited row has one.
ALTER TABLE product_title_optimizations
  DROP CONSTRAINT IF EXISTS pto_status_optimized_title_chk;
ALTER TABLE product_title_optimizations
  ADD CONSTRAINT pto_status_optimized_title_chk
  CHECK (
    (status = 'needs_review' AND optimized_title IS NULL)
    OR (status IN ('ai_generated', 'human_edited') AND optimized_title IS NOT NULL)
  );

COMMIT;
