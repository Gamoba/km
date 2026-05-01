-- shop_settings moves from per-user to per-feed.
-- Markets/locales/currency/market_url were previously a single row per user;
-- now each feed has its own copy so a user can target multiple markets from
-- one Shopify install via separate feeds.

-- 1. Add feed_id (nullable for backfill)
ALTER TABLE shop_settings
  ADD COLUMN IF NOT EXISTS feed_id uuid REFERENCES feeds(id) ON DELETE CASCADE;

-- 2. Safety net: if a user has shop_settings but no feed yet (e.g. only ever
--    visited /settings, never created a mapping/filter), create a default
--    feed for them so the backfill below has something to point at.
INSERT INTO feeds (user_id, name, description)
SELECT DISTINCT ss.user_id, 'Default feed', 'Auto-oprettet ved migration af shop_settings'
FROM shop_settings ss
WHERE NOT EXISTS (SELECT 1 FROM feeds f WHERE f.user_id = ss.user_id);

-- 3. Backfill: each shop_settings row points at its user's oldest feed
UPDATE shop_settings ss
SET feed_id = (
  SELECT id FROM feeds
  WHERE user_id = ss.user_id
  ORDER BY created_at ASC
  LIMIT 1
)
WHERE feed_id IS NULL;

-- 4. Lock NOT NULL
ALTER TABLE shop_settings ALTER COLUMN feed_id SET NOT NULL;

-- 5. Swap UNIQUE constraint from user_id to feed_id
ALTER TABLE shop_settings DROP CONSTRAINT IF EXISTS shop_settings_user_id_key;
ALTER TABLE shop_settings ADD CONSTRAINT shop_settings_feed_id_key UNIQUE (feed_id);

-- 6. Index for feed_id lookups
CREATE INDEX IF NOT EXISTS idx_shop_settings_feed_id ON shop_settings(feed_id);
