CREATE TABLE IF NOT EXISTS feed_settings (
  id         uuid        DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id    uuid        NOT NULL UNIQUE REFERENCES auth.users(id) ON DELETE CASCADE,
  feed_mode  text        NOT NULL DEFAULT 'product' CHECK (feed_mode IN ('product', 'variant')),
  created_at timestamptz DEFAULT now()
);

ALTER TABLE feed_settings DISABLE ROW LEVEL SECURITY;

CREATE INDEX IF NOT EXISTS idx_feed_settings_user_id ON feed_settings(user_id);
