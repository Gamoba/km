CREATE TABLE IF NOT EXISTS feed_filters (
  id          uuid        DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id     uuid        NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  filter_type text        NOT NULL CHECK (filter_type IN ('include', 'exclude')),
  operator    text        NOT NULL DEFAULT 'AND' CHECK (operator IN ('AND', 'OR')),
  rules       jsonb       NOT NULL DEFAULT '[]',
  created_at  timestamptz DEFAULT now(),
  UNIQUE (user_id, filter_type)
);
ALTER TABLE feed_filters DISABLE ROW LEVEL SECURITY;
CREATE INDEX IF NOT EXISTS idx_feed_filters_user_id ON feed_filters(user_id);
