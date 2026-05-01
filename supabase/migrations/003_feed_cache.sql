CREATE TABLE IF NOT EXISTS feed_cache (
  id            uuid        DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id       uuid        NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  xml_content   text        NOT NULL,
  generated_at  timestamptz DEFAULT now(),
  product_count int         NOT NULL DEFAULT 0,
  UNIQUE (user_id)
);

ALTER TABLE feed_cache DISABLE ROW LEVEL SECURITY;

CREATE INDEX IF NOT EXISTS idx_feed_cache_user_id ON feed_cache(user_id);
