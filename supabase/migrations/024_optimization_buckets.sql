-- Bucket layer for AI title optimization.
--
-- A bucket is a named (filter + method + rules) unit within a feed. The user
-- assigns products into buckets explicitly (membership is a frozen list, NOT the
-- filter recomputed on the fly), with one product belonging to exactly one
-- bucket per feed. This layers over the existing per-feed optimization tables
-- the way projects layered over feeds.
--
--   optimization_buckets  one row per (feed, bucket).
--   bucket_products       explicit membership; UNIQUE(feed_id, product_ref)
--                         enforces "one product = one bucket per feed".
--
-- Rescopes the existing optimization tables from per-feed to per-bucket:
--   title_optimization_filters  + bucket_id, UNIQUE → (bucket_id, filter_type)
--   title_rules                 + bucket_id, UNIQUE → (bucket_id, product_type)
--   product_title_optimizations + bucket_id (nullable; records producing bucket)
--
-- NO data backfill: all four optimization tables are verified empty (only the
-- no-persist Preview has been used). If they held data, a Default bucket per
-- feed would be created here and the rows stamped — not needed now. Adding
-- NOT NULL bucket_id to the (empty) filter/rules tables is therefore safe.
--
-- Idempotent: IF [NOT] EXISTS / DROP IF EXISTS / pg_constraint guards.

BEGIN;

-- ── 1. optimization_buckets ────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS optimization_buckets (
  id         uuid        DEFAULT gen_random_uuid() PRIMARY KEY,
  feed_id    uuid        NOT NULL REFERENCES feeds(id) ON DELETE CASCADE,
  name       text        NOT NULL,
  method     text        NOT NULL CHECK (method IN ('auto', 'rule_based')),
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

ALTER TABLE optimization_buckets DISABLE ROW LEVEL SECURITY;

CREATE INDEX IF NOT EXISTS idx_optimization_buckets_feed_id
  ON optimization_buckets(feed_id);

-- ── 2. bucket_products (explicit membership) ───────────────────────────────
-- feed_id is denormalized so the UNIQUE can enforce one-bucket-per-product at
-- the feed level. A move into a new bucket is an upsert on (feed_id, product_ref).

CREATE TABLE IF NOT EXISTS bucket_products (
  id          uuid        DEFAULT gen_random_uuid() PRIMARY KEY,
  bucket_id   uuid        NOT NULL REFERENCES optimization_buckets(id) ON DELETE CASCADE,
  feed_id     uuid        NOT NULL REFERENCES feeds(id) ON DELETE CASCADE,
  product_ref text        NOT NULL,
  created_at  timestamptz DEFAULT now(),
  UNIQUE (feed_id, product_ref)
);

ALTER TABLE bucket_products DISABLE ROW LEVEL SECURITY;

CREATE INDEX IF NOT EXISTS idx_bucket_products_bucket_id ON bucket_products(bucket_id);

-- ── 3. Rescope title_optimization_filters → per bucket ─────────────────────

ALTER TABLE title_optimization_filters
  ADD COLUMN IF NOT EXISTS bucket_id uuid NOT NULL
    REFERENCES optimization_buckets(id) ON DELETE CASCADE;

ALTER TABLE title_optimization_filters
  DROP CONSTRAINT IF EXISTS title_optimization_filters_feed_id_filter_type_key;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'title_optimization_filters_bucket_id_filter_type_key'
  ) THEN
    ALTER TABLE title_optimization_filters
      ADD CONSTRAINT title_optimization_filters_bucket_id_filter_type_key
      UNIQUE (bucket_id, filter_type);
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_title_optimization_filters_bucket_id
  ON title_optimization_filters(bucket_id);

-- ── 4. Rescope title_rules → per bucket ────────────────────────────────────

ALTER TABLE title_rules
  ADD COLUMN IF NOT EXISTS bucket_id uuid NOT NULL
    REFERENCES optimization_buckets(id) ON DELETE CASCADE;

ALTER TABLE title_rules
  DROP CONSTRAINT IF EXISTS title_rules_feed_id_product_type_key;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'title_rules_bucket_id_product_type_key'
  ) THEN
    ALTER TABLE title_rules
      ADD CONSTRAINT title_rules_bucket_id_product_type_key
      UNIQUE (bucket_id, product_type);
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_title_rules_bucket_id ON title_rules(bucket_id);

-- ── 5. product_title_optimizations.bucket_id (records producing bucket) ─────
-- Nullable: manual edits without a bucket still exist. SET NULL on bucket
-- delete so a produced title survives in the feed after its bucket is removed.

ALTER TABLE product_title_optimizations
  ADD COLUMN IF NOT EXISTS bucket_id uuid
    REFERENCES optimization_buckets(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_pto_bucket_id
  ON product_title_optimizations(bucket_id);

COMMIT;
