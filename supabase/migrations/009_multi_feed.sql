-- Multi-feed support: one user can now own multiple feeds.
-- All per-user data (mappings, filters, settings, cache, products, metafields)
-- is scoped by feed_id. Existing rows are consolidated into one default feed
-- per user during backfill.
--
-- Idempotent: the migrate.ts runner replays every .sql file on each run,
-- so every step uses IF [NOT] EXISTS guards or pg_constraint lookups.

BEGIN;

-- ── 1. feeds table ─────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS feeds (
  id          uuid        DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id     uuid        NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  name        text        NOT NULL,
  description text,
  created_at  timestamptz DEFAULT now(),
  updated_at  timestamptz DEFAULT now()
);

ALTER TABLE feeds DISABLE ROW LEVEL SECURITY;

CREATE INDEX IF NOT EXISTS idx_feeds_user_id ON feeds(user_id);

-- ── 2. feed_id columns (nullable for backfill, then locked NOT NULL) ───────

ALTER TABLE feed_mappings      ADD COLUMN IF NOT EXISTS feed_id uuid REFERENCES feeds(id) ON DELETE CASCADE;
ALTER TABLE feed_filters       ADD COLUMN IF NOT EXISTS feed_id uuid REFERENCES feeds(id) ON DELETE CASCADE;
ALTER TABLE feed_settings      ADD COLUMN IF NOT EXISTS feed_id uuid REFERENCES feeds(id) ON DELETE CASCADE;
ALTER TABLE feed_cache         ADD COLUMN IF NOT EXISTS feed_id uuid REFERENCES feeds(id) ON DELETE CASCADE;
ALTER TABLE products           ADD COLUMN IF NOT EXISTS feed_id uuid REFERENCES feeds(id) ON DELETE CASCADE;
ALTER TABLE product_metafields ADD COLUMN IF NOT EXISTS feed_id uuid REFERENCES feeds(id) ON DELETE CASCADE;

-- ── 3. Default feed per existing user ──────────────────────────────────────
-- A "user with data" is anyone with a row in any per-user feed table. We pick
-- those up from the existing user_id columns (kept for ownership verification).

INSERT INTO feeds (user_id, name, description)
SELECT DISTINCT u.user_id, 'Default feed', 'Auto-oprettet ved migration til multi-feed'
FROM (
  SELECT user_id FROM feed_mappings
  UNION
  SELECT user_id FROM feed_filters
  UNION
  SELECT user_id FROM feed_settings
  UNION
  SELECT user_id FROM feed_cache
) AS u
WHERE NOT EXISTS (
  SELECT 1 FROM feeds f WHERE f.user_id = u.user_id
);

-- ── 4. Backfill feed_id on per-user tables ─────────────────────────────────

UPDATE feed_mappings m
SET    feed_id = (SELECT id FROM feeds WHERE user_id = m.user_id ORDER BY created_at ASC LIMIT 1)
WHERE  m.feed_id IS NULL;

UPDATE feed_filters m
SET    feed_id = (SELECT id FROM feeds WHERE user_id = m.user_id ORDER BY created_at ASC LIMIT 1)
WHERE  m.feed_id IS NULL;

UPDATE feed_settings m
SET    feed_id = (SELECT id FROM feeds WHERE user_id = m.user_id ORDER BY created_at ASC LIMIT 1)
WHERE  m.feed_id IS NULL;

UPDATE feed_cache m
SET    feed_id = (SELECT id FROM feeds WHERE user_id = m.user_id ORDER BY created_at ASC LIMIT 1)
WHERE  m.feed_id IS NULL;

-- products has no user_id — assign existing rows to the oldest feed (single
-- Shopify store assumption). New syncs will write per-feed going forward.
UPDATE products
SET    feed_id = (SELECT id FROM feeds ORDER BY created_at ASC LIMIT 1)
WHERE  feed_id IS NULL;

UPDATE product_metafields pm
SET    feed_id = (SELECT feed_id FROM products p WHERE p.id = pm.product_id)
WHERE  pm.feed_id IS NULL;

-- ── 5. Lock feed_id NOT NULL once fully backfilled ─────────────────────────
-- Skipped per-table if any rows remain unfilled (e.g. fresh empty DB with no
-- users yet). Subsequent migrations / runs will lock once data exists.

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM feed_mappings WHERE feed_id IS NULL) THEN
    ALTER TABLE feed_mappings ALTER COLUMN feed_id SET NOT NULL;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM feed_filters WHERE feed_id IS NULL) THEN
    ALTER TABLE feed_filters ALTER COLUMN feed_id SET NOT NULL;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM feed_settings WHERE feed_id IS NULL) THEN
    ALTER TABLE feed_settings ALTER COLUMN feed_id SET NOT NULL;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM feed_cache WHERE feed_id IS NULL) THEN
    ALTER TABLE feed_cache ALTER COLUMN feed_id SET NOT NULL;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM products WHERE feed_id IS NULL) THEN
    ALTER TABLE products ALTER COLUMN feed_id SET NOT NULL;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM product_metafields WHERE feed_id IS NULL) THEN
    ALTER TABLE product_metafields ALTER COLUMN feed_id SET NOT NULL;
  END IF;
END $$;

-- ── 6. Swap unique constraints from user_id-scoped to feed_id-scoped ──────

-- feed_mappings: (user_id, google_field) → (feed_id, google_field)
ALTER TABLE feed_mappings DROP CONSTRAINT IF EXISTS feed_mappings_user_id_google_field_key;
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'feed_mappings_feed_id_google_field_key'
  ) THEN
    ALTER TABLE feed_mappings
      ADD CONSTRAINT feed_mappings_feed_id_google_field_key
      UNIQUE (feed_id, google_field);
  END IF;
END $$;

-- feed_filters: (user_id, filter_type) → (feed_id, filter_type)
ALTER TABLE feed_filters DROP CONSTRAINT IF EXISTS feed_filters_user_id_filter_type_key;
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'feed_filters_feed_id_filter_type_key'
  ) THEN
    ALTER TABLE feed_filters
      ADD CONSTRAINT feed_filters_feed_id_filter_type_key
      UNIQUE (feed_id, filter_type);
  END IF;
END $$;

-- feed_settings: user_id UNIQUE → feed_id UNIQUE
ALTER TABLE feed_settings DROP CONSTRAINT IF EXISTS feed_settings_user_id_key;
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'feed_settings_feed_id_key'
  ) THEN
    ALTER TABLE feed_settings
      ADD CONSTRAINT feed_settings_feed_id_key
      UNIQUE (feed_id);
  END IF;
END $$;

-- feed_cache: user_id UNIQUE → feed_id UNIQUE
ALTER TABLE feed_cache DROP CONSTRAINT IF EXISTS feed_cache_user_id_key;
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'feed_cache_feed_id_key'
  ) THEN
    ALTER TABLE feed_cache
      ADD CONSTRAINT feed_cache_feed_id_key
      UNIQUE (feed_id);
  END IF;
END $$;

-- products: shopify_id UNIQUE → (feed_id, shopify_id) UNIQUE
ALTER TABLE products DROP CONSTRAINT IF EXISTS products_shopify_id_key;
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'products_feed_id_shopify_id_key'
  ) THEN
    ALTER TABLE products
      ADD CONSTRAINT products_feed_id_shopify_id_key
      UNIQUE (feed_id, shopify_id);
  END IF;
END $$;

-- product_metafields: (product_id, namespace, key) → (feed_id, product_id, namespace, key)
ALTER TABLE product_metafields DROP CONSTRAINT IF EXISTS uq_product_metafields_product_namespace_key;
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'uq_product_metafields_feed_product_namespace_key'
  ) THEN
    ALTER TABLE product_metafields
      ADD CONSTRAINT uq_product_metafields_feed_product_namespace_key
      UNIQUE (feed_id, product_id, namespace, key);
  END IF;
END $$;

-- ── 7. Indexes on feed_id ─────────────────────────────────────────────────

CREATE INDEX IF NOT EXISTS idx_feed_mappings_feed_id      ON feed_mappings(feed_id);
CREATE INDEX IF NOT EXISTS idx_feed_filters_feed_id       ON feed_filters(feed_id);
CREATE INDEX IF NOT EXISTS idx_feed_settings_feed_id      ON feed_settings(feed_id);
CREATE INDEX IF NOT EXISTS idx_feed_cache_feed_id         ON feed_cache(feed_id);
CREATE INDEX IF NOT EXISTS idx_products_feed_id           ON products(feed_id);
CREATE INDEX IF NOT EXISTS idx_product_metafields_feed_id ON product_metafields(feed_id);

COMMIT;
