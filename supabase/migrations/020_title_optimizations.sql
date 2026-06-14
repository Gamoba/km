-- AI title optimization for Google Shopping.
--
-- Two new tables, both scoped per feed (titles are per-market, like everything
-- else — see migrations 009/010). The "is this product optimized" marker lives
-- HERE, in Supabase, NOT as a Shopify tag — the app is strictly read-only
-- against Shopify (AGENTS.md).
--
--   product_title_optimizations  state per product: original + optimized title,
--                                method, status, and a hash of the input data
--                                used (for "only-changed" re-runs).
--   title_rules                  Method B rules per product_type: attribute
--                                priority / required / excluded lists.
--
-- RLS is left DISABLED to match the other feed-scoped tables (feed_mappings,
-- feed_filters, products, product_metafields). Isolation is enforced in app
-- code via getOwnedFeed(); all data access goes through the service-role key
-- (adminDb()), which bypasses RLS anyway.
--
-- Idempotent: guarded with IF [NOT] EXISTS so migrate.ts can replay safely.

BEGIN;

-- ── 1. product_title_optimizations ─────────────────────────────────────────
-- product_ref is the per-feed product key (products.shopify_id). A row's
-- ABSENCE means "not optimized". original_title is ALWAYS stored: re-runs
-- regenerate from original_title + the raw Shopify data, never from
-- optimized_title, to avoid quality drift ("telephone game").

CREATE TABLE IF NOT EXISTS product_title_optimizations (
  id              uuid        DEFAULT gen_random_uuid() PRIMARY KEY,
  feed_id         uuid        NOT NULL REFERENCES feeds(id) ON DELETE CASCADE,
  product_ref     text        NOT NULL,
  status          text        NOT NULL
    CHECK (status IN ('ai_generated', 'human_edited')),
  original_title  text        NOT NULL,
  optimized_title text        NOT NULL,
  method          text        NOT NULL
    CHECK (method IN ('auto', 'rule_based')),
  source_hash     text,
  created_at      timestamptz DEFAULT now(),
  updated_at      timestamptz DEFAULT now(),
  UNIQUE (feed_id, product_ref)
);

ALTER TABLE product_title_optimizations DISABLE ROW LEVEL SECURITY;

CREATE INDEX IF NOT EXISTS idx_pto_feed_id
  ON product_title_optimizations(feed_id);

-- ── 2. title_rules (Method B) ──────────────────────────────────────────────
-- One row per (feed, product_type). Attribute lists are stored as jsonb arrays
-- of source-field tokens (the same tokens resolveField understands, e.g.
-- "vendor", "metafield:custom.vintage"). Empty arrays are valid.

CREATE TABLE IF NOT EXISTS title_rules (
  id                   uuid        DEFAULT gen_random_uuid() PRIMARY KEY,
  feed_id              uuid        NOT NULL REFERENCES feeds(id) ON DELETE CASCADE,
  product_type         text        NOT NULL,
  priority_attributes  jsonb       NOT NULL DEFAULT '[]',
  required_attributes  jsonb       NOT NULL DEFAULT '[]',
  excluded_attributes  jsonb       NOT NULL DEFAULT '[]',
  created_at           timestamptz DEFAULT now(),
  updated_at           timestamptz DEFAULT now(),
  UNIQUE (feed_id, product_type)
);

ALTER TABLE title_rules DISABLE ROW LEVEL SECURITY;

CREATE INDEX IF NOT EXISTS idx_title_rules_feed_id
  ON title_rules(feed_id);

COMMIT;
