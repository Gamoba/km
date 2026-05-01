-- Rename source-field references from "shopify_id" → "item_group_id" in
-- existing feed_mappings.config JSONB. The application's resolvers accept
-- both forms (back-compat alias), but the mapping dropdown only offers
-- "item_group_id" — so without this migration, rows saved before the rename
-- render with an empty dropdown until the user re-selects.
--
-- Affected JSONB shapes:
--   FIELD / PREFIX_SUFFIX / FIND_REPLACE / TRUNCATE / STRIP_HTML:
--     {"field": "shopify_id"} → {"field": "item_group_id"}
--   COMBINE block:
--     {"type": "field", "value": "shopify_id"} → {"type": "field", "value": "item_group_id"}
--   onlyIf condition:
--     {"field": "shopify_id", ...} → {"field": "item_group_id", ...}
--   onlyIf else (when type=field):
--     {"type": "field", "value": "shopify_id"} → {"type": "field", "value": "item_group_id"}
--
-- Implementation: text-level replace of the quoted token "shopify_id" inside
-- config::text, cast back to jsonb. The token is always quoted in JSON, so
-- substrings of unrelated identifiers (e.g. "my_shopify_id") aren't touched.
--
-- Idempotent via WHERE filter — re-running is a no-op.
--
-- Caveat: a STATIC mapping with the literal value "shopify_id"
-- (e.g. {"value": "shopify_id"}) would also be migrated. Realistically
-- unlikely — STATIC values are typically things like "in_stock" or brand names.

UPDATE feed_mappings
SET config = REPLACE(config::text, '"shopify_id"', '"item_group_id"')::jsonb
WHERE config::text LIKE '%"shopify_id"%';
