-- products
CREATE TABLE IF NOT EXISTS products (
  id           uuid        DEFAULT gen_random_uuid() PRIMARY KEY,
  shopify_id   text        UNIQUE NOT NULL,
  title        text,
  vendor       text,
  product_type text,
  status       text,
  handle       text,
  published_at timestamptz,
  tags         text,
  images       jsonb       DEFAULT '[]',
  variants     jsonb       DEFAULT '[]',
  collections  jsonb       DEFAULT '[]',
  synced_at    timestamptz,
  created_at   timestamptz DEFAULT now(),
  updated_at   timestamptz DEFAULT now()
);

-- product_metafields
CREATE TABLE IF NOT EXISTS product_metafields (
  id         uuid        DEFAULT gen_random_uuid() PRIMARY KEY,
  product_id uuid        NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  namespace  text        NOT NULL,
  key        text        NOT NULL,
  value      text,
  type       text,
  created_at timestamptz DEFAULT now()
);

-- RLS deaktiveret
ALTER TABLE products          DISABLE ROW LEVEL SECURITY;
ALTER TABLE product_metafields DISABLE ROW LEVEL SECURITY;

-- Indexes
CREATE INDEX IF NOT EXISTS idx_products_shopify_id
  ON products(shopify_id);

CREATE INDEX IF NOT EXISTS idx_product_metafields_product_id
  ON product_metafields(product_id);

CREATE INDEX IF NOT EXISTS idx_product_metafields_namespace_key
  ON product_metafields(namespace, key);
