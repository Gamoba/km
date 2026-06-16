-- Manual product additions to a bucket's scope.
--
-- A bucket's membership is now the UNION of (products matching its filter) and
-- (products added manually). Both live in bucket_products; a `source` marker on
-- each row says which path put it there. That lets a filter re-confirm rewrite
-- only the 'filter' rows and leave 'manual' rows untouched — so manual additions
-- survive a filter change. Membership readers (run, Results, feed generation,
-- member counts) are unchanged: they still read every row for the bucket, which
-- is the union automatically.
--
-- Existing rows were all filter-derived, so they default to 'filter'. The
-- UNIQUE (feed_id, product_ref) from migration 024 still enforces
-- one-product-one-bucket across BOTH sources — a manual add of a product owned by
-- another bucket is an upsert-move, exactly like the filter path.
--
-- Additive + idempotent: IF NOT EXISTS / DROP IF EXISTS so migrate.ts can replay.

BEGIN;

ALTER TABLE bucket_products
  ADD COLUMN IF NOT EXISTS source text NOT NULL DEFAULT 'filter';

ALTER TABLE bucket_products
  DROP CONSTRAINT IF EXISTS bucket_products_source_chk;
ALTER TABLE bucket_products
  ADD CONSTRAINT bucket_products_source_chk
  CHECK (source IN ('filter', 'manual'));

COMMIT;
