-- Shop settings per user: market, locale, currency
CREATE TABLE IF NOT EXISTS shop_settings (
  id            uuid        DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id       uuid        REFERENCES auth.users(id) ON DELETE CASCADE NOT NULL,
  selected_market_id text,
  selected_locale    text   NOT NULL DEFAULT 'en',
  selected_country   text   NOT NULL DEFAULT 'US',
  currency           text   NOT NULL DEFAULT 'USD',
  shop_url           text,
  updated_at    timestamptz DEFAULT now(),
  UNIQUE(user_id)
);

ALTER TABLE shop_settings ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can manage own shop settings"
  ON shop_settings FOR ALL
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

-- body_html was missing from the initial products migration
ALTER TABLE products ADD COLUMN IF NOT EXISTS body_html text;
