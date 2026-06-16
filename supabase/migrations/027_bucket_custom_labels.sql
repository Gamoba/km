-- Per-bucket Google Shopping custom label, for split-testing title strategies in
-- Google Ads. A bucket may carry ONE custom label (custom_label_0 … custom_label_4)
-- with a value (e.g. "title-test-A"). At feed generation every product in that
-- bucket emits <g:custom_label_N>value</g:custom_label_N>, so the bucket's real
-- Google performance (clicks / impressions / sales) can be compared — closing the
-- loop from curation to measurement.
--
-- One product belongs to exactly one bucket (bucket_products is UNIQUE per feed),
-- so there is never a conflict over which value applies to a product.
--
-- Additive + idempotent: IF NOT EXISTS / DROP IF EXISTS so migrate.ts can replay.
-- Both columns are nullable; a bucket without a custom label leaves them NULL.

BEGIN;

ALTER TABLE optimization_buckets
  ADD COLUMN IF NOT EXISTS custom_label_index smallint,
  ADD COLUMN IF NOT EXISTS custom_label_value text;

-- The index, when set, must be 0..4 (Google supports custom_label_0 … _4).
ALTER TABLE optimization_buckets
  DROP CONSTRAINT IF EXISTS optimization_buckets_custom_label_index_chk;
ALTER TABLE optimization_buckets
  ADD CONSTRAINT optimization_buckets_custom_label_index_chk
  CHECK (custom_label_index IS NULL OR custom_label_index BETWEEN 0 AND 4);

-- Index and value are set together, or both empty — no half-configured label
-- (so feed generation can treat "value present" as the single source of truth).
ALTER TABLE optimization_buckets
  DROP CONSTRAINT IF EXISTS optimization_buckets_custom_label_pair_chk;
ALTER TABLE optimization_buckets
  ADD CONSTRAINT optimization_buckets_custom_label_pair_chk
  CHECK (
    (custom_label_index IS NULL AND (custom_label_value IS NULL OR custom_label_value = ''))
    OR (custom_label_index IS NOT NULL AND custom_label_value IS NOT NULL AND custom_label_value <> '')
  );

COMMIT;
