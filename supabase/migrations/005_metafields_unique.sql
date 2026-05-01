-- Remove any existing duplicates before adding the constraint,
-- keeping the row with the latest created_at per (product_id, namespace, key).
DELETE FROM product_metafields
WHERE id NOT IN (
  SELECT DISTINCT ON (product_id, namespace, key) id
  FROM product_metafields
  ORDER BY product_id, namespace, key, created_at DESC
);

ALTER TABLE product_metafields
ADD CONSTRAINT uq_product_metafields_product_namespace_key
UNIQUE (product_id, namespace, key);
