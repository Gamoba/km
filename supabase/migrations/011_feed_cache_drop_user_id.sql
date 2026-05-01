-- feed_cache.user_id is redundant after migration 009 moved the unique
-- constraint to (feed_id) and ownership verification moved to feeds.user_id
-- via getOwnedFeed. Worse, it's still NOT NULL — but the upsert in
-- app/api/feed/generate/[feedId] only writes feed_id, so inserts for any
-- feed without a pre-existing cache row fail with a NOT NULL violation.
-- That's why only the original default feed (whose row was backfilled in 009)
-- ever updates correctly; second/third feeds silently never persist.

ALTER TABLE feed_cache DROP COLUMN IF EXISTS user_id;
-- idx_feed_cache_user_id is dropped automatically with the column.
