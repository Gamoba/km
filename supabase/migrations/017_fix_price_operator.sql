-- Fix any feed_mappings row where the price / sale_price onlyIf condition
-- uses the wrong operator. The correct operator for "is the product on sale"
-- is less_than_field — i.e. variants[0].price < variants[0].compare_at_price.
-- Earlier versions of defaultMappings.ts or migration 016 may have seeded
-- equals_field or another operator; this migration normalises them.
--
-- Only the operator at onlyIf.conditions[0].operator is touched. The rest
-- of the config (blocks, else branch, etc.) is preserved via jsonb_set.
--
-- The WHERE clause restricts the update to rows that match the price-vs-
-- compare_at_price comparison pattern AND have the wrong operator. Rows
-- with already-correct operator or with custom (non-default) onlyIf shapes
-- are left alone.
--
-- Idempotent via the operator filter: re-running matches no rows.

UPDATE feed_mappings
SET config = jsonb_set(config, '{onlyIf,conditions,0,operator}', '"less_than_field"'::jsonb)
WHERE google_field IN ('price', 'sale_price')
  AND config->'onlyIf'->'conditions'->0->>'field' = 'variants[0].price'
  AND config->'onlyIf'->'conditions'->0->>'value' = 'variants[0].compare_at_price'
  AND config->'onlyIf'->'conditions'->0->>'operator' IS DISTINCT FROM 'less_than_field';
