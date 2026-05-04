// Sensible-default mapping set for a freshly-created feed. Same defaults
// apply to product mode and variant mode today; the parameter is kept so we
// can diverge later without changing the call sites.
//
// The feed wizard uses this to seed mappings on creation. Migration 015 uses
// the same shape (in raw JSONB) to back-fill existing feeds that have no
// mappings yet — keep both in sync if you change defaults here.

export type DefaultMappingEntry = {
  google_field: string
  mapping_type: 'FIELD' | 'STATIC' | 'COMBINE'
  config: Record<string, unknown>
}

export function getDefaultMappings(
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  _feedMode: 'product' | 'variant' = 'product'
): DefaultMappingEntry[] {
  return [
    {
      google_field: 'id',
      mapping_type: 'FIELD',
      config: { field: 'id' },
    },
    {
      google_field: 'title',
      mapping_type: 'FIELD',
      config: { field: 'title' },
    },
    {
      google_field: 'description',
      mapping_type: 'FIELD',
      config: { field: 'body_html' },
    },
    {
      google_field: 'link',
      mapping_type: 'FIELD',
      config: { field: 'url' },
    },
    {
      google_field: 'image_link',
      mapping_type: 'FIELD',
      config: { field: 'images[0].src' },
    },
    {
      // STATIC "in_stock" with a conditional fallback to "out_of_stock" when
      // the first variant has zero inventory.
      google_field: 'availability',
      mapping_type: 'STATIC',
      config: {
        value: 'in_stock',
        onlyIf: {
          conditions: [
            {
              field: 'variants[0].inventory_quantity',
              operator: 'greater_than',
              value: '0',
              logic: null,
            },
          ],
          else: { type: 'static', value: 'out_of_stock' },
        },
      },
    },
    {
      // price emits the *original* price (compare_at_price) when the product
      // is on sale, otherwise the regular price. "On sale" = price <
      // compare_at_price evaluated via the new less_than_field operator.
      // Google requires a space between number and ISO currency code, hence
      // the literal text blocks in the middle.
      google_field: 'price',
      mapping_type: 'COMBINE',
      config: {
        blocks: [
          { type: 'field', value: 'variants[0].compare_at_price' },
          { type: 'text', value: ' ' },
          { type: 'field', value: 'variants[0].currency' },
        ],
        onlyIf: {
          conditions: [
            {
              field: 'variants[0].price',
              operator: 'less_than_field',
              value: 'variants[0].compare_at_price',
              logic: null,
            },
          ],
          else: {
            type: 'combine',
            blocks: [
              { type: 'field', value: 'variants[0].price' },
              { type: 'text', value: ' ' },
              { type: 'field', value: 'variants[0].currency' },
            ],
          },
        },
      },
    },
    {
      // sale_price emits the discounted price only when the product is on
      // sale; otherwise empty (Google ignores empty sale_price).
      google_field: 'sale_price',
      mapping_type: 'COMBINE',
      config: {
        blocks: [
          { type: 'field', value: 'variants[0].price' },
          { type: 'text', value: ' ' },
          { type: 'field', value: 'variants[0].currency' },
        ],
        onlyIf: {
          conditions: [
            {
              field: 'variants[0].price',
              operator: 'less_than_field',
              value: 'variants[0].compare_at_price',
              logic: null,
            },
          ],
          else: { type: 'empty', value: '' },
        },
      },
    },
    {
      google_field: 'brand',
      mapping_type: 'FIELD',
      config: { field: 'vendor' },
    },
  ]
}
