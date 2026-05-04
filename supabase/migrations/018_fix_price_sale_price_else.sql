-- Earlier seeds left some price / sale_price rows with the wrong onlyIf
-- operator AND/OR the wrong ELSE branch. This migration normalises both at
-- once on rows that match the "is on sale" comparison pattern (condition[0]
-- compares variants[0].price against variants[0].compare_at_price).
--
--   price.onlyIf.conditions[0].operator → less_than_field
--   price.onlyIf.else                   → combine [price " " currency]
--
--   sale_price.onlyIf.conditions[0].operator → less_than_field
--   sale_price.onlyIf.else                   → { type: "empty", value: "" }
--
-- jsonb_set is composed twice per row (operator + else) so the rest of the
-- config (blocks, conditions schema, etc.) is preserved exactly. The WHERE
-- clauses match only rows that have the correct *condition shape*; rows with
-- a totally different onlyIf are left alone so user customisations stick.
--
-- Idempotent: once everything is correct, the OR'd "needs-fixing" predicates
-- are all false and zero rows match.

-- ── price ──────────────────────────────────────────────────────────────────
UPDATE feed_mappings
SET config = jsonb_set(
  jsonb_set(config, '{onlyIf,conditions,0,operator}', '"less_than_field"'::jsonb),
  '{onlyIf,else}',
  $${
    "type":"combine",
    "blocks":[
      {"type":"field","value":"variants[0].price"},
      {"type":"text","value":" "},
      {"type":"field","value":"variants[0].currency"}
    ]
  }$$::jsonb
)
WHERE google_field = 'price'
  AND config->'onlyIf'->'conditions'->0->>'field' = 'variants[0].price'
  AND config->'onlyIf'->'conditions'->0->>'value' = 'variants[0].compare_at_price'
  AND (
    config->'onlyIf'->'conditions'->0->>'operator' IS DISTINCT FROM 'less_than_field'
    OR config->'onlyIf'->'else'->>'type' IS DISTINCT FROM 'combine'
  );

-- ── sale_price ─────────────────────────────────────────────────────────────
UPDATE feed_mappings
SET config = jsonb_set(
  jsonb_set(config, '{onlyIf,conditions,0,operator}', '"less_than_field"'::jsonb),
  '{onlyIf,else}',
  '{"type":"empty","value":""}'::jsonb
)
WHERE google_field = 'sale_price'
  AND config->'onlyIf'->'conditions'->0->>'field' = 'variants[0].price'
  AND config->'onlyIf'->'conditions'->0->>'value' = 'variants[0].compare_at_price'
  AND (
    config->'onlyIf'->'conditions'->0->>'operator' IS DISTINCT FROM 'less_than_field'
    OR config->'onlyIf'->'else'->>'type' IS DISTINCT FROM 'empty'
  );
