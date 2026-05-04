-- Upgrade existing feeds from the old simple price COMBINE default to the
-- new sale-aware price + sale_price pair. Two phases:
--
-- Phase 1: Replace any feed_mappings row whose price config matches the OLD
--          default *exactly* (COMBINE [price " " currency], no onlyIf) with
--          the new compare_at_price-aware config. Feeds where the user
--          customised price are NOT touched.
--
-- Phase 2: Insert a sale_price mapping ONLY for feeds whose price was just
--          updated to the new default in phase 1, and that don't already
--          have a sale_price row. This keeps the migration conservative —
--          feeds with manual customisations get nothing added.
--
-- Both phases are idempotent via the WHERE filters: re-running this migration
-- after success matches no rows.
--
-- Operator note: "less_than_field" is a new operator added in this revision
-- that resolves the condition's value as a field reference rather than a
-- literal. evalCond / evalPreviewCond both understand it.

-- ── Phase 1 ────────────────────────────────────────────────────────────────
UPDATE feed_mappings
SET config = $${
  "blocks":[
    {"type":"field","value":"variants[0].compare_at_price"},
    {"type":"text","value":" "},
    {"type":"field","value":"variants[0].currency"}
  ],
  "onlyIf":{
    "conditions":[
      {"field":"variants[0].price","operator":"less_than_field","value":"variants[0].compare_at_price","logic":null}
    ],
    "else":{
      "type":"combine",
      "blocks":[
        {"type":"field","value":"variants[0].price"},
        {"type":"text","value":" "},
        {"type":"field","value":"variants[0].currency"}
      ]
    }
  }
}$$::jsonb
WHERE google_field = 'price'
  AND mapping_type = 'COMBINE'
  AND config = $${"blocks":[{"type":"field","value":"variants[0].price"},{"type":"text","value":" "},{"type":"field","value":"variants[0].currency"}]}$$::jsonb;

-- ── Phase 2 ────────────────────────────────────────────────────────────────
INSERT INTO feed_mappings (feed_id, user_id, google_field, mapping_type, config)
SELECT
  p.feed_id,
  p.user_id,
  'sale_price',
  'COMBINE',
  $${
    "blocks":[
      {"type":"field","value":"variants[0].price"},
      {"type":"text","value":" "},
      {"type":"field","value":"variants[0].currency"}
    ],
    "onlyIf":{
      "conditions":[
        {"field":"variants[0].price","operator":"less_than_field","value":"variants[0].compare_at_price","logic":null}
      ],
      "else":{"type":"static","value":""}
    }
  }$$::jsonb
FROM feed_mappings p
WHERE p.google_field = 'price'
  AND p.mapping_type = 'COMBINE'
  AND p.config = $${
    "blocks":[
      {"type":"field","value":"variants[0].compare_at_price"},
      {"type":"text","value":" "},
      {"type":"field","value":"variants[0].currency"}
    ],
    "onlyIf":{
      "conditions":[
        {"field":"variants[0].price","operator":"less_than_field","value":"variants[0].compare_at_price","logic":null}
      ],
      "else":{
        "type":"combine",
        "blocks":[
          {"type":"field","value":"variants[0].price"},
          {"type":"text","value":" "},
          {"type":"field","value":"variants[0].currency"}
        ]
      }
    }
  }$$::jsonb
  AND NOT EXISTS (
    SELECT 1 FROM feed_mappings sp
    WHERE sp.feed_id = p.feed_id AND sp.google_field = 'sale_price'
  );
