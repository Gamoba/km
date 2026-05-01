-- Seed default mappings on existing feeds that have NO mappings yet. New
-- feeds created via the wizard get these defaults at creation time; this
-- migration back-fills feeds created before that change.
--
-- The shape mirrors lib/defaultMappings.ts — keep both in sync.
-- Idempotent via the WHERE NOT EXISTS guard: feeds that already have any
-- mapping (even one) are left alone, and re-running this migration is a
-- no-op.

INSERT INTO feed_mappings (feed_id, user_id, google_field, mapping_type, config)
SELECT
  f.id,
  f.user_id,
  m.google_field,
  m.mapping_type,
  m.config
FROM feeds f
CROSS JOIN (
  VALUES
    ('id',           'FIELD',   $${"field":"id"}$$::jsonb),
    ('title',        'FIELD',   $${"field":"title"}$$::jsonb),
    ('description',  'FIELD',   $${"field":"body_html"}$$::jsonb),
    ('link',         'FIELD',   $${"field":"url"}$$::jsonb),
    ('image_link',   'FIELD',   $${"field":"images[0].src"}$$::jsonb),
    (
      'availability',
      'STATIC',
      $${"value":"in_stock","onlyIf":{"conditions":[{"field":"variants[0].inventory_quantity","operator":"greater_than","value":"0","logic":null}],"else":{"type":"static","value":"out_of_stock"}}}$$::jsonb
    ),
    (
      'price',
      'COMBINE',
      $${"blocks":[{"type":"field","value":"variants[0].price"},{"type":"text","value":" "},{"type":"field","value":"variants[0].currency"}]}$$::jsonb
    ),
    ('brand',        'FIELD',   $${"field":"vendor"}$$::jsonb)
) AS m(google_field, mapping_type, config)
WHERE NOT EXISTS (
  SELECT 1 FROM feed_mappings fm WHERE fm.feed_id = f.id
);
