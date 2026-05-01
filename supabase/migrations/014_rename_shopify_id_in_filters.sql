-- Same rename as migration 013, applied to feed_filters.rules JSONB.
--
-- Affected JSONB shape:
--   feed_filters.rules: [{ "field": "shopify_id", "operator": "...", "value": "..." }, ...]
--   → [{ "field": "item_group_id", ... }]
--
-- Implementation mirrors 013: text-level replace of the quoted "shopify_id"
-- token, cast back to jsonb. The token is always quoted in JSON so we won't
-- match substrings of unrelated identifiers (e.g. "my_shopify_id"). Idempotent
-- via WHERE filter.
--
-- Caveat: a filter rule whose `value` is the literal string "shopify_id"
-- (e.g. filtering for products whose tag equals "shopify_id") would also be
-- migrated. Realistically extremely unlikely for product-feed filtering.

UPDATE feed_filters
SET rules = REPLACE(rules::text, '"shopify_id"', '"item_group_id"')::jsonb
WHERE rules::text LIKE '%"shopify_id"%';
