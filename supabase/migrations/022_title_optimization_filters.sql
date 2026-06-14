-- Separate filter set scoping which products an AI title-optimization run hits.
--
-- Mirrors feed_filters exactly (same include/exclude shape, same rule JSON, same
-- evaluation via lib/feedFilters.applyFeedFilters) but is a DISTINCT set: a
-- product can be in the feed yet only a subset should be optimized. Keeping it
-- in its own table means optimization scope never perturbs feed inclusion.
--
-- Per feed (titles are per-market). RLS disabled to match the other feed-scoped
-- tables (feed_filters, feed_mappings, products); isolation is enforced in app
-- code via getOwnedFeed(), service-role access bypasses RLS anyway.
--
-- Idempotent: IF NOT EXISTS guards so migrate.ts can replay safely.

BEGIN;

CREATE TABLE IF NOT EXISTS title_optimization_filters (
  id          uuid        DEFAULT gen_random_uuid() PRIMARY KEY,
  feed_id     uuid        NOT NULL REFERENCES feeds(id) ON DELETE CASCADE,
  filter_type text        NOT NULL CHECK (filter_type IN ('include', 'exclude')),
  operator    text        NOT NULL DEFAULT 'AND' CHECK (operator IN ('AND', 'OR')),
  rules       jsonb       NOT NULL DEFAULT '[]',
  created_at  timestamptz DEFAULT now(),
  updated_at  timestamptz DEFAULT now(),
  UNIQUE (feed_id, filter_type)
);

ALTER TABLE title_optimization_filters DISABLE ROW LEVEL SECURITY;

CREATE INDEX IF NOT EXISTS idx_title_optimization_filters_feed_id
  ON title_optimization_filters(feed_id);

COMMIT;
