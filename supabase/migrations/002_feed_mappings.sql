DROP TABLE IF EXISTS feed_mappings;

CREATE TABLE feed_mappings (
  id           uuid        DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id      uuid        NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  google_field text        NOT NULL,
  mapping_type text        NOT NULL,
  config       jsonb       NOT NULL DEFAULT '{}',
  created_at   timestamptz DEFAULT now(),
  updated_at   timestamptz DEFAULT now(),
  UNIQUE (user_id, google_field)
);

ALTER TABLE feed_mappings DISABLE ROW LEVEL SECURITY;

CREATE INDEX IF NOT EXISTS idx_feed_mappings_user_id
  ON feed_mappings(user_id);
