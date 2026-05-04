'use client'

import { createContext, useContext, useEffect, useMemo, useState, useTransition } from 'react'
import { saveMappings, type MappingEntry } from './actions'

// Lets all FieldSelect / ShopifyFieldsModal usages pick up the active feed
// mode without prop-drilling through 8+ render sites.
const FeedModeContext = createContext<'product' | 'variant'>('product')

// ── Types ──────────────────────────────────────────────────────────────────

type MappingType =
  | ''
  | 'FIELD'
  | 'STATIC'
  | 'COMBINE'
  | 'PREFIX_SUFFIX'
  | 'FIND_REPLACE'
  | 'TRUNCATE'
  | 'STRIP_HTML'
  | 'AI'

type Config = Record<string, unknown>
type FieldState = { type: MappingType; config: Config }

type Condition = { field: string; operator: string; value: string; logic: 'AND' | 'OR' | null }
type ElseBranch =
  | { type: 'empty' | 'static' | 'field'; value: string }
  | { type: 'combine'; blocks: { type: 'field' | 'text'; value: string }[] }
type OnlyIf = { conditions: Condition[]; else: ElseBranch }

type AISuggestion = {
  google_field: string
  shopify_field: string | null
  mapping_type: 'field' | 'static'
  static_value?: string
  confidence: 'high' | 'medium' | 'low'
  reason: string
}

// ── Static data ────────────────────────────────────────────────────────────

// Required Google Shopping fields — always visible, top of the page, never collapsed.
const REQUIRED_FIELDS = [
  'id', 'title', 'description', 'link', 'image_link', 'availability', 'price', 'brand',
] as const

// Collapsible sections — collapsed by default, auto-opened when at least one
// field inside has a saved mapping.
const COLLAPSIBLE_SECTIONS: { title: string; fields: string[] }[] = [
  {
    title: 'Identifiers',
    fields: ['condition', 'gtin', 'mpn', 'identifier_exists', 'item_group_id'],
  },
  {
    title: 'Price',
    fields: ['sale_price', 'sale_price_effective_date', 'cost_of_goods_sold', 'auto_pricing_min_price'],
  },
  {
    title: 'Product category',
    fields: ['google_product_category', 'product_type'],
  },
  {
    title: 'Variants',
    fields: ['color', 'size', 'gender', 'age_group', 'material', 'pattern', 'size_type', 'size_system'],
  },
  {
    title: 'Campaigns',
    fields: ['custom_label_0', 'custom_label_1', 'custom_label_2', 'custom_label_3', 'custom_label_4', 'promotion_id'],
  },
  {
    title: 'Shipping',
    fields: ['shipping', 'shipping_label', 'shipping_weight', 'max_handling_time', 'min_handling_time'],
  },
  {
    title: 'Additional images & media',
    fields: ['additional_image_link', 'lifestyle_image_link', 'short_title'],
  },
]

// Advanced fields — only shown in the UI when the user explicitly adds them
// via the "+ Tilføj felt" modal. Grouped here purely for the modal's layout.
const ADVANCED_CATEGORIES: { title: string; fields: string[] }[] = [
  {
    title: 'Price & availability',
    fields: [
      'availability_date', 'expiration_date',
      'unit_pricing_measure', 'unit_pricing_base_measure',
      'installment', 'subscription_cost',
      'loyalty_program', 'maximum_retail_price',
    ],
  },
  {
    title: 'Product details',
    fields: [
      'adult', 'multipack', 'is_bundle',
      'product_detail', 'product_highlight',
      'product_length', 'product_width', 'product_height', 'product_weight',
    ],
  },
  {
    title: 'Certification & energy',
    fields: [
      'certification',
      'energy_efficiency_class', 'min_energy_efficiency_class', 'max_energy_efficiency_class',
    ],
  },
  {
    title: 'Media',
    fields: ['video_link', 'virtual_model_link', 'mobile_link'],
  },
  {
    title: 'Campaigns & ads',
    fields: [
      'ads_redirect',
      'excluded_destination', 'included_destination',
      'shopping_ads_excluded_country',
      'pause',
    ],
  },
  {
    title: 'Shipping (advanced)',
    fields: [
      'carrier_shipping', 'handling_cutoff_time', 'minimum_order_value',
      'shipping_length', 'shipping_width', 'shipping_height',
      'ships_from_country',
      'shipping_transit_business_days', 'shipping_handling_business_days',
      'free_shipping_threshold', 'return_policy_label',
    ],
  },
]

const COLLAPSIBLE_FIELDS = COLLAPSIBLE_SECTIONS.flatMap((s) => s.fields)
const ADVANCED_FIELDS = ADVANCED_CATEGORIES.flatMap((c) => c.fields)

// Every field the mapping UI knows about — used for state initialisation,
// AI-suggestion validation and the save serialisation.
const ALL_FIELDS = [...REQUIRED_FIELDS, ...COLLAPSIBLE_FIELDS, ...ADVANCED_FIELDS]

const STANDARD_FIELDS = [
  'id',
  'item_group_id',
  'title',
  'body_html',
  'vendor',
  'handle',
  'url',
  'tags',
  'status',
  'product_type',
  'published_at',
  'created_at',
  'updated_at',
  'collections',
  'variants[0].id',
  'variants[0].title',
  'variants[0].price',
  'variants[0].currency',
  'variants[0].compare_at_price',
  'variants[0].sku',
  'variants[0].barcode',
  'variants[0].weight',
  'variants[0].inventory_quantity',
  'variants[0].option1',
  'variants[0].option2',
  'variants[0].option3',
  'images[0].src',
  'images[1].src',
  'images[2].src',
  'images[3].src',
  'images[4].src',
]

const MAPPING_TYPES: { value: MappingType; label: string }[] = [
  { value: '', label: '— Not mapped —' },
  { value: 'FIELD', label: 'Field' },
  { value: 'STATIC', label: 'Static' },
  { value: 'COMBINE', label: 'Combine' },
  { value: 'PREFIX_SUFFIX', label: 'Prefix / Suffix' },
  { value: 'FIND_REPLACE', label: 'Find & Replace' },
  { value: 'TRUNCATE', label: 'Truncate' },
  { value: 'STRIP_HTML', label: 'Strip HTML' },
  { value: 'AI', label: 'AI' },
]

const OPERATORS = [
  { value: 'equals', label: '= equals' },
  { value: 'not_equals', label: '≠ does not equal' },
  { value: 'contains', label: 'contains' },
  { value: 'not_contains', label: 'does not contain' },
  { value: 'starts_with', label: 'starts with' },
  { value: 'ends_with', label: 'ends with' },
  { value: 'greater_than', label: '> greater than' },
  { value: 'less_than', label: '< less than' },
  { value: 'is_empty', label: 'is empty' },
  { value: 'is_not_empty', label: 'is not empty' },
]

const NO_VALUE_OPERATORS = ['is_empty', 'is_not_empty']

// Operators that have a "_field" variant in the resolver — i.e. the RHS can
// be either a literal value or another product-field reference. Used to
// decide whether the Værdi / Felt toggle is shown.
const MODE_AWARE_OPERATORS = new Set([
  'equals',
  'not_equals',
  'greater_than',
  'less_than',
])

// Strips the "_field" suffix so the dropdown can render and select a single
// option for both `less_than` and `less_than_field`.
function baseOperator(op: string): string {
  return op.endsWith('_field') ? op.slice(0, -'_field'.length) : op
}
function isFieldOperator(op: string): boolean {
  return op.endsWith('_field')
}
// Build the effective stored operator from a base + mode. Non-mode-aware
// operators ignore the field mode and stay as their base form.
function withOperatorMode(base: string, mode: 'value' | 'field'): string {
  if (mode === 'field' && MODE_AWARE_OPERATORS.has(base)) return `${base}_field`
  return base
}

// ── Shared styles ──────────────────────────────────────────────────────────

const sel = 'ff-select'
const inp = 'ff-input'
const inpSm = 'ff-input'
const btnSm =
  'px-2 py-1 rounded text-[11px] font-medium transition-colors border border-[var(--color-border-secondary)] bg-white text-[var(--color-text-secondary)] hover:bg-[var(--color-background-secondary)]'
const miniSel = 'ff-select shrink-0'

// ── Live preview: client-side resolver ────────────────────────────────────

type PreviewProduct = {
  id: number
  title: string
  vendor: string
  handle: string
  body_html: string
  product_type: string
  tags: string
  status: string
  created_at: string
  updated_at: string
  published_at: string | null
  variants: Record<string, unknown>[]
  images: Record<string, unknown>[]
  metafields: { namespace: string; key: string; value: string; type: string }[]
  collections: string[]
}

// `marketUrl` may be a subdomain (https://shop.fr) or a subfolder (https://shop.com/fr) —
// in both cases we strip a trailing slash and append /products/<handle>.
function buildClientProductUrl(handle: string | null | undefined, marketUrl: string | null): string {
  if (!handle) return ''
  if (marketUrl) {
    return `${marketUrl.replace(/\/+$/, '')}/products/${handle}`
  }
  const domain = process.env.NEXT_PUBLIC_SHOP_DOMAIN ?? ''
  return domain ? `https://${domain}/products/${handle}` : ''
}

function resolveClientField(
  field: string,
  product: PreviewProduct,
  marketUrl: string | null,
  feedMode: 'product' | 'variant' = 'product'
): string {
  if (!field) return ''

  if (field === 'url') {
    return buildClientProductUrl(product.handle, marketUrl)
  }

  // The bare "id" source field mirrors what the feed generator auto-injects
  // for <g:id>: shopify_id alone in product mode, shopify_id + "_" +
  // variant_id in variant mode (using the first variant for preview).
  if (field === 'id') {
    if (feedMode === 'variant') {
      const firstVariantId = product.variants[0]?.id
      return firstVariantId !== undefined && firstVariantId !== null
        ? `${product.id}_${firstVariantId}`
        : String(product.id)
    }
    return String(product.id)
  }

  // item_group_id is the renamed source-field name; shopify_id stays as a
  // back-compat alias for mappings saved before the rename. Both always
  // resolve to the product-level Shopify ID, regardless of feed mode.
  if (field === 'item_group_id' || field === 'shopify_id') {
    return String(product.id)
  }

  if (field.startsWith('metafield:')) {
    const rest = field.slice('metafield:'.length)
    const dot = rest.indexOf('.')
    if (dot === -1) return ''
    const ns = rest.slice(0, dot)
    const key = rest.slice(dot + 1)
    return product.metafields.find((m) => m.namespace === ns && m.key === key)?.value ?? ''
  }

  const variantMatch = field.match(/^variants\[(\d+)\]\.(.+)$/)
  if (variantMatch) {
    return String(product.variants[+variantMatch[1]]?.[variantMatch[2]] ?? '')
  }

  const imageMatch = field.match(/^images\[(\d+)\]\.(.+)$/)
  if (imageMatch) {
    return String(product.images[+imageMatch[1]]?.[imageMatch[2]] ?? '')
  }

  const val = (product as Record<string, unknown>)[field]
  if (val === null || val === undefined) return ''
  if (Array.isArray(val)) return val.join(', ')
  if (typeof val === 'object') return JSON.stringify(val)
  return String(val)
}

function stripPreviewHtml(html: string): string {
  return html.replace(/<[^>]*>/g, '').replace(/\s+/g, ' ').trim()
}

function applyClientMapping(
  type: MappingType,
  config: Config,
  product: PreviewProduct,
  marketUrl: string | null,
  feedMode: 'product' | 'variant'
): string {
  switch (type) {
    case 'FIELD':
      return resolveClientField(String(config.field ?? ''), product, marketUrl, feedMode)
    case 'STATIC':
      return String(config.value ?? '')
    case 'COMBINE': {
      const blocks = (config.blocks as { type: 'field' | 'text'; value: string }[]) ?? []
      return blocks
        .map((b) => (b.type === 'field' ? resolveClientField(b.value, product, marketUrl, feedMode) : b.value))
        .join('')
    }
    case 'PREFIX_SUFFIX': {
      const val = resolveClientField(String(config.field ?? ''), product, marketUrl, feedMode)
      if (!val) return ''
      return `${config.prefix ?? ''}${val}${config.suffix ?? ''}`
    }
    case 'FIND_REPLACE': {
      let val = resolveClientField(String(config.field ?? ''), product, marketUrl, feedMode)
      for (const pair of (config.pairs as { find: string; replace: string }[]) ?? []) {
        if (pair.find) val = val.split(pair.find).join(pair.replace)
      }
      return val
    }
    case 'TRUNCATE': {
      const val = resolveClientField(String(config.field ?? ''), product, marketUrl, feedMode)
      return val.slice(0, Number(config.maxChars ?? 500))
    }
    case 'STRIP_HTML':
      return stripPreviewHtml(resolveClientField(String(config.field ?? ''), product, marketUrl, feedMode))
    case 'AI':
      return '__AI__'
    default:
      return ''
  }
}

function evalPreviewCond(
  cond: Condition,
  product: PreviewProduct,
  marketUrl: string | null,
  feedMode: 'product' | 'variant'
): boolean {
  const v = resolveClientField(cond.field, product, marketUrl, feedMode)
  switch (cond.operator) {
    case 'equals':       return v === cond.value
    case 'not_equals':   return v !== cond.value
    case 'contains':     return v.includes(cond.value)
    case 'not_contains': return !v.includes(cond.value)
    case 'starts_with':  return v.startsWith(cond.value)
    case 'ends_with':    return v.endsWith(cond.value)
    case 'greater_than': return parseFloat(v) > parseFloat(cond.value)
    case 'less_than':    return parseFloat(v) < parseFloat(cond.value)
    case 'is_empty':     return !v
    case 'is_not_empty': return !!v
    // *_field variants resolve the RHS as a field reference. Mirrors evalCond
    // in feedGenerator so the preview matches the generated output exactly.
    case 'less_than_field':    return parseFloat(v) < parseFloat(resolveClientField(cond.value, product, marketUrl, feedMode))
    case 'greater_than_field': return parseFloat(v) > parseFloat(resolveClientField(cond.value, product, marketUrl, feedMode))
    case 'equals_field':       return v === resolveClientField(cond.value, product, marketUrl, feedMode)
    case 'not_equals_field':   return v !== resolveClientField(cond.value, product, marketUrl, feedMode)
    default:             return true
  }
}

function computePreviewValue(
  state: FieldState,
  product: PreviewProduct,
  marketUrl: string | null,
  feedMode: 'product' | 'variant'
): string {
  if (!state.type) return ''
  let value = applyClientMapping(state.type, state.config, product, marketUrl, feedMode)

  const onlyIf = state.config.onlyIf as OnlyIf | undefined
  if (onlyIf?.conditions?.length) {
    const { conditions } = onlyIf
    let result = evalPreviewCond(conditions[0], product, marketUrl, feedMode)
    for (let i = 1; i < conditions.length; i++) {
      const val = evalPreviewCond(conditions[i], product, marketUrl, feedMode)
      result = conditions[i].logic === 'OR' ? result || val : result && val
    }
    if (!result) {
      const eb = onlyIf.else
      if (eb.type === 'static') value = eb.value
      else if (eb.type === 'field')
        value = resolveClientField(eb.value, product, marketUrl, feedMode)
      else if (eb.type === 'combine') {
        value = (eb.blocks ?? [])
          .map((b) =>
            b.type === 'field'
              ? resolveClientField(b.value, product, marketUrl, feedMode)
              : b.value
          )
          .join('')
      } else {
        value = ''
      }
    }
  }

  return value
}

// ── FieldSelect ────────────────────────────────────────────────────────────

// Source-field labels for the dropdown. A handful of variant fields read
// differently in product vs variant mode (e.g. "Pris" vs "Variant pris"),
// so this is a function rather than a static record.
function getFieldLabels(feedMode: 'product' | 'variant'): Record<string, string> {
  const isVariant = feedMode === 'variant'
  return {
    url: 'url (full product URL)',
    item_group_id: 'Product ID (item_group_id)',
    'variants[0].id': 'Variant ID',
    'variants[0].price': isVariant ? 'Variant price' : 'Price',
    'variants[0].currency': 'Currency',
    'variants[0].sku': isVariant ? 'Variant SKU' : 'SKU',
    'variants[0].barcode': isVariant ? 'Variant Barcode/GTIN' : 'Barcode/GTIN',
    'variants[0].inventory_quantity': isVariant ? 'Variant inventory' : 'Inventory',
  }
}

function FieldSelect({
  value,
  onChange,
  allFields,
}: {
  value: string
  onChange: (v: string) => void
  allFields: string[]
}) {
  const feedMode = useContext(FeedModeContext)
  const labels = useMemo(() => getFieldLabels(feedMode), [feedMode])
  const standard = allFields.filter((f) => !f.startsWith('metafield:'))
  const meta = allFields.filter((f) => f.startsWith('metafield:'))
  return (
    <select value={value} onChange={(e) => onChange(e.target.value)} className={sel}>
      <option value="">— Select field —</option>
      <optgroup label="Shopify fields">
        {standard.map((f) => (
          <option key={f} value={f}>{labels[f] ?? f}</option>
        ))}
      </optgroup>
      {meta.length > 0 && (
        <optgroup label="Metafields">
          {meta.map((f) => (
            <option key={f} value={f}>{f.replace('metafield:', '')}</option>
          ))}
        </optgroup>
      )}
    </select>
  )
}

// ── CombineChipsEditor (chip-based COMBINE UI) ─────────────────────────────

type CombineBlock = { type: 'field' | 'text'; value: string }

function CombineChipsEditor({
  blocks,
  allFields,
  onChange,
}: {
  blocks: CombineBlock[]
  allFields: string[]
  onChange: (next: CombineBlock[]) => void
}) {
  const feedMode = useContext(FeedModeContext)
  const labels = useMemo(() => getFieldLabels(feedMode), [feedMode])
  const [picker, setPicker] = useState<'none' | 'field' | 'text'>('none')
  const [draggedIdx, setDraggedIdx] = useState<number | null>(null)
  // Drop indicator state — which chip and which side of it the dragged item
  // would land on. The visual is a thin vertical accent line at that edge.
  const [dropZone, setDropZone] = useState<{ idx: number; side: 'left' | 'right' } | null>(null)

  function addField(value: string) {
    onChange([...blocks, { type: 'field', value }])
    setPicker('none')
  }
  function addText(value: string) {
    if (!value) return
    onChange([...blocks, { type: 'text', value }])
    setPicker('none')
  }
  function removeBlock(i: number) {
    onChange(blocks.filter((_, j) => j !== i))
  }

  // HTML5 DnD. dataTransfer.setData is required for Firefox to fire drop.
  function onDragStart(e: React.DragEvent, i: number) {
    setDraggedIdx(i)
    e.dataTransfer.effectAllowed = 'move'
    e.dataTransfer.setData('text/plain', String(i))
  }
  function onDragOver(e: React.DragEvent, i: number) {
    e.preventDefault()
    e.dataTransfer.dropEffect = 'move'
    if (draggedIdx === null || draggedIdx === i) {
      setDropZone(null)
      return
    }
    const rect = (e.currentTarget as HTMLElement).getBoundingClientRect()
    const side: 'left' | 'right' = e.clientX < rect.left + rect.width / 2 ? 'left' : 'right'
    setDropZone({ idx: i, side })
  }
  function onDrop(e: React.DragEvent, target: number) {
    e.preventDefault()
    const from = draggedIdx
    const zone = dropZone
    setDraggedIdx(null)
    setDropZone(null)
    if (from === null) return
    // Insert position based on which side of the target the cursor was on:
    //   left  → at target index (target shifts right)
    //   right → after target (target stays put)
    // Then adjust for the splice removing the source item before it inserts:
    // if the source was earlier than the insertion point, the index shifts
    // by one. No-ops collapse to a no-op.
    const side = zone?.side ?? 'right'
    const insertAt = side === 'left' ? target : target + 1
    const adjusted = from < insertAt ? insertAt - 1 : insertAt
    if (adjusted === from) return
    const next = [...blocks]
    const [moved] = next.splice(from, 1)
    next.splice(adjusted, 0, moved)
    onChange(next)
  }
  function onDragEnd() {
    setDraggedIdx(null)
    setDropZone(null)
  }

  function chipLabel(b: CombineBlock): string {
    if (b.type === 'text') return b.value
    if (!b.value) return ''
    if (b.value.startsWith('metafield:')) return b.value.replace('metafield:', '')
    return labels[b.value] ?? b.value
  }

  return (
    <div className="space-y-2">
      <div
        className="flex flex-wrap gap-2 items-center"
        style={{
          minHeight: '42px',
          padding: '8px 10px',
          background: '#ffffff',
          border: '1px solid var(--color-border-secondary)',
          borderRadius: '6px',
        }}
      >
        {blocks.length === 0 && (
          <span
            style={{
              fontSize: '11px',
              color: 'var(--color-text-tertiary)',
              fontStyle: 'italic',
            }}
          >
            Add fields and text as chips below
          </span>
        )}
        {blocks.map((block, i) => (
          <CombineChip
            key={i}
            block={block}
            label={chipLabel(block)}
            isDragging={draggedIdx === i}
            dropSide={dropZone?.idx === i ? dropZone.side : null}
            onRemove={() => removeBlock(i)}
            onDragStart={(e) => onDragStart(e, i)}
            onDragOver={(e) => onDragOver(e, i)}
            onDrop={(e) => onDrop(e, i)}
            onDragEnd={onDragEnd}
          />
        ))}
      </div>

      <div className="flex gap-2 items-center">
        <button
          type="button"
          onClick={() => setPicker(picker === 'field' ? 'none' : 'field')}
          className={`${btnSm} bg-indigo-50 text-indigo-600 hover:bg-indigo-100`}
          aria-expanded={picker === 'field'}
        >
          + Field
        </button>
        <button
          type="button"
          onClick={() => setPicker(picker === 'text' ? 'none' : 'text')}
          className={`${btnSm} bg-gray-100 text-gray-600 hover:bg-gray-200`}
          aria-expanded={picker === 'text'}
        >
          + Text
        </button>
      </div>

      {picker === 'field' && (
        <FieldPickerPanel
          allFields={allFields}
          labels={labels}
          onSelect={addField}
          onClose={() => setPicker('none')}
        />
      )}
      {picker === 'text' && (
        <TextInputPanel onSubmit={addText} onClose={() => setPicker('none')} />
      )}
    </div>
  )
}

function CombineChip({
  block,
  label,
  isDragging,
  dropSide,
  onRemove,
  onDragStart,
  onDragOver,
  onDrop,
  onDragEnd,
}: {
  block: CombineBlock
  label: string
  isDragging: boolean
  dropSide: 'left' | 'right' | null
  onRemove: () => void
  onDragStart: (e: React.DragEvent) => void
  onDragOver: (e: React.DragEvent) => void
  onDrop: (e: React.DragEvent) => void
  onDragEnd: () => void
}) {
  const isField = block.type === 'field'
  const empty = !block.value
  return (
    <span
      draggable
      onDragStart={onDragStart}
      onDragOver={onDragOver}
      onDrop={onDrop}
      onDragEnd={onDragEnd}
      className="inline-flex items-center gap-1.5"
      style={{
        position: 'relative',
        padding: '4px 4px 4px 8px',
        fontSize: '11px',
        background: isField
          ? 'var(--color-badge-accent-bg)'
          : 'var(--color-background-secondary)',
        color: isField
          ? 'var(--color-badge-accent-text)'
          : 'var(--color-text-secondary)',
        borderRadius: '4px',
        opacity: isDragging ? 0.4 : 1,
        cursor: 'grab',
        transition: 'opacity 0.12s ease',
        userSelect: 'none',
      }}
    >
      {dropSide && <DropIndicator side={dropSide} />}
      <span
        className="ff-mono"
        style={{
          fontSize: '9px',
          fontWeight: 600,
          opacity: 0.6,
          letterSpacing: '0.04em',
        }}
      >
        {isField ? '{}' : 'txt'}
      </span>
      <span style={{ fontWeight: 500, whiteSpace: 'pre' }}>
        {empty ? <em style={{ opacity: 0.6, fontStyle: 'italic' }}>empty</em> : label}
      </span>
      <button
        type="button"
        onMouseDown={(e) => e.stopPropagation()}
        onClick={(e) => {
          e.stopPropagation()
          onRemove()
        }}
        aria-label="Remove block"
        style={{
          width: '16px',
          height: '16px',
          display: 'inline-flex',
          alignItems: 'center',
          justifyContent: 'center',
          background: 'transparent',
          border: 'none',
          color: 'inherit',
          opacity: 0.65,
          cursor: 'pointer',
          fontSize: '13px',
          lineHeight: 1,
          padding: 0,
        }}
      >
        ×
      </button>
    </span>
  )
}

// Thin vertical accent line shown at the left or right edge of a chip while
// dragging another chip over it. Sits in the 8 px gap between chips, so it
// reads as "insertion between these two chips" rather than "drop on this one".
function DropIndicator({ side }: { side: 'left' | 'right' }) {
  return (
    <span
      aria-hidden="true"
      style={{
        position: 'absolute',
        top: 0,
        bottom: 0,
        [side]: '-5px',
        width: '2px',
        background: 'var(--color-accent)',
        borderRadius: '1px',
        pointerEvents: 'none',
      }}
    />
  )
}

function FieldPickerPanel({
  allFields,
  labels,
  onSelect,
  onClose,
}: {
  allFields: string[]
  labels: Record<string, string>
  onSelect: (field: string) => void
  onClose: () => void
}) {
  const [search, setSearch] = useState('')
  const standard = useMemo(
    () => allFields.filter((f) => !f.startsWith('metafield:')),
    [allFields]
  )
  const meta = useMemo(
    () => allFields.filter((f) => f.startsWith('metafield:')),
    [allFields]
  )

  const q = search.toLowerCase()
  const filteredStandard = q
    ? standard.filter(
        (f) =>
          f.toLowerCase().includes(q) ||
          (labels[f] ?? '').toLowerCase().includes(q)
      )
    : standard
  const filteredMeta = q ? meta.filter((f) => f.toLowerCase().includes(q)) : meta

  return (
    <div
      style={{
        background: '#ffffff',
        border: '1px solid var(--color-border-secondary)',
        borderRadius: '6px',
        maxHeight: '280px',
        display: 'flex',
        flexDirection: 'column',
        overflow: 'hidden',
      }}
    >
      <div className="p-2" style={{ borderBottom: '1px solid var(--color-border-tertiary)' }}>
        <input
          type="search"
          autoFocus
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search field…"
          className={inp}
          onKeyDown={(e) => {
            if (e.key === 'Escape') onClose()
          }}
        />
      </div>
      <div style={{ overflowY: 'auto', flex: 1 }}>
        {filteredStandard.length > 0 && (
          <>
            <div
              className="ff-label"
              style={{ padding: '6px 10px', background: 'var(--color-background-tertiary)' }}
            >
              Shopify fields
            </div>
            {filteredStandard.map((f) => (
              <PickerOption
                key={f}
                onClick={() => onSelect(f)}
                primary={labels[f] ?? f}
                secondary={labels[f] && labels[f] !== f ? f : undefined}
              />
            ))}
          </>
        )}
        {filteredMeta.length > 0 && (
          <>
            <div
              className="ff-label"
              style={{ padding: '6px 10px', background: 'var(--color-background-tertiary)' }}
            >
              Metafields
            </div>
            {filteredMeta.map((f) => (
              <PickerOption
                key={f}
                onClick={() => onSelect(f)}
                primary={f.replace('metafield:', '')}
                mono
              />
            ))}
          </>
        )}
        {filteredStandard.length === 0 && filteredMeta.length === 0 && (
          <p
            className="text-center"
            style={{ padding: '12px', fontSize: '11px', color: 'var(--color-text-tertiary)' }}
          >
            No fields match
          </p>
        )}
      </div>
    </div>
  )
}

function PickerOption({
  onClick,
  primary,
  secondary,
  mono,
}: {
  onClick: () => void
  primary: string
  secondary?: string
  mono?: boolean
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      style={{
        display: 'block',
        width: '100%',
        textAlign: 'left',
        padding: '6px 10px',
        fontSize: '11px',
        background: 'transparent',
        border: 'none',
        cursor: 'pointer',
        color: mono ? 'var(--color-accent)' : 'var(--color-text-primary)',
      }}
      className={mono ? 'ff-mono' : undefined}
      onMouseEnter={(e) => {
        e.currentTarget.style.background = 'var(--color-background-secondary)'
      }}
      onMouseLeave={(e) => {
        e.currentTarget.style.background = 'transparent'
      }}
    >
      <span style={{ fontWeight: 500 }}>{primary}</span>
      {secondary && (
        <span
          className="ff-mono"
          style={{
            marginLeft: '8px',
            fontSize: '10px',
            color: 'var(--color-text-tertiary)',
          }}
        >
          {secondary}
        </span>
      )}
    </button>
  )
}

function TextInputPanel({
  onSubmit,
  onClose,
}: {
  onSubmit: (text: string) => void
  onClose: () => void
}) {
  const [value, setValue] = useState('')

  return (
    <div className="flex gap-2 items-center">
      <input
        type="text"
        autoFocus
        value={value}
        onChange={(e) => setValue(e.target.value)}
        placeholder='e.g. " - " or " | Buy online"'
        className={inp}
        style={{ flex: 1, minWidth: 0 }}
        onKeyDown={(e) => {
          if (e.key === 'Enter') {
            e.preventDefault()
            onSubmit(value)
          } else if (e.key === 'Escape') {
            onClose()
          }
        }}
      />
      <button
        type="button"
        onClick={() => onSubmit(value)}
        disabled={!value}
        className="ff-btn-primary"
      >
        Add
      </button>
      <button type="button" onClick={onClose} className="ff-btn-secondary">
        Cancel
      </button>
    </div>
  )
}

// ── ConfigEditor ───────────────────────────────────────────────────────────

function ConfigEditor({
  type,
  config,
  onChange,
  allFields,
}: {
  type: MappingType
  config: Config
  onChange: (c: Config) => void
  allFields: string[]
}) {
  const set = (key: string, val: unknown) => onChange({ ...config, [key]: val })

  switch (type) {
    case 'FIELD':
      return (
        <FieldSelect
          value={String(config.field ?? '')}
          onChange={(v) => onChange({ ...config, field: v })}
          allFields={allFields}
        />
      )

    case 'STATIC':
      return (
        <input
          type="text"
          value={String(config.value ?? '')}
          onChange={(e) => onChange({ ...config, value: e.target.value })}
          placeholder="Enter static value..."
          className={inp}
        />
      )

    case 'COMBINE': {
      const blocks = (config.blocks as CombineBlock[]) ?? []
      return (
        <CombineChipsEditor
          blocks={blocks}
          allFields={allFields}
          onChange={(next) => onChange({ ...config, blocks: next })}
        />
      )
    }

    case 'PREFIX_SUFFIX':
      return (
        <div className="grid grid-cols-3 gap-2">
          <input
            type="text"
            value={String(config.prefix ?? '')}
            onChange={(e) => set('prefix', e.target.value)}
            placeholder="Prefix"
            className={inp}
          />
          <FieldSelect
            value={String(config.field ?? '')}
            onChange={(v) => set('field', v)}
            allFields={allFields}
          />
          <input
            type="text"
            value={String(config.suffix ?? '')}
            onChange={(e) => set('suffix', e.target.value)}
            placeholder="Suffix"
            className={inp}
          />
        </div>
      )

    case 'FIND_REPLACE': {
      const pairs = (config.pairs as { find: string; replace: string }[]) ?? [
        { find: '', replace: '' },
      ]
      return (
        <div className="space-y-2">
          <FieldSelect
            value={String(config.field ?? '')}
            onChange={(v) => set('field', v)}
            allFields={allFields}
          />
          {pairs.map((pair, i) => (
            <div key={i} className="flex gap-2 items-center">
              <input
                type="text"
                value={pair.find}
                onChange={(e) => {
                  const next = [...pairs]
                  next[i] = { ...pair, find: e.target.value }
                  set('pairs', next)
                }}
                placeholder="Find..."
                className={inpSm}
              />
              <span className="text-gray-400 text-sm shrink-0">→</span>
              <input
                type="text"
                value={pair.replace}
                onChange={(e) => {
                  const next = [...pairs]
                  next[i] = { ...pair, replace: e.target.value }
                  set('pairs', next)
                }}
                placeholder="Replace with..."
                className={inpSm}
              />
              {pairs.length > 1 && (
                <button
                  type="button"
                  onClick={() => set('pairs', pairs.filter((_, j) => j !== i))}
                  className={`${btnSm} bg-gray-100 text-gray-500 hover:bg-gray-200 shrink-0`}
                >
                  ×
                </button>
              )}
            </div>
          ))}
          <button
            type="button"
            onClick={() => set('pairs', [...pairs, { find: '', replace: '' }])}
            className={`${btnSm} bg-indigo-50 text-indigo-600 hover:bg-indigo-100`}
          >
            + Add pair
          </button>
        </div>
      )
    }

    case 'TRUNCATE':
      return (
        <div className="flex gap-2 items-center">
          <FieldSelect
            value={String(config.field ?? '')}
            onChange={(v) => set('field', v)}
            allFields={allFields}
          />
          <input
            type="number"
            value={Number(config.maxChars ?? 500)}
            onChange={(e) => set('maxChars', Number(e.target.value))}
            min={1}
            className="w-24 px-3 py-2 rounded-lg border border-gray-200 text-sm text-center focus:outline-none focus:ring-2 focus:ring-indigo-500/20 shrink-0"
          />
          <span className="text-sm text-gray-500 shrink-0">chars</span>
        </div>
      )

    case 'STRIP_HTML':
      return (
        <FieldSelect
          value={String(config.field ?? '')}
          onChange={(v) => onChange({ ...config, field: v })}
          allFields={allFields}
        />
      )

    case 'AI':
      return (
        <textarea
          value={String(config.prompt ?? '')}
          onChange={(e) => onChange({ ...config, prompt: e.target.value })}
          rows={2}
          placeholder="Describe what Claude should generate based on the product data..."
          className="w-full px-3 py-2 rounded-lg border border-gray-200 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-300 resize-none"
        />
      )

    default:
      return null
  }
}

// ── ConditionModeToggle ────────────────────────────────────────────────────

// Inline pill-toggle inside the value column of an OnlyIf condition row.
// "Værdi" stores the bare operator (literal compare); "Felt" appends "_field"
// so the resolver treats the RHS as a product-field path.
function ConditionModeToggle({
  mode,
  onChange,
}: {
  mode: 'value' | 'field'
  onChange: (m: 'value' | 'field') => void
}) {
  return (
    <div
      className="inline-flex shrink-0 self-stretch overflow-hidden"
      style={{
        border: '1px solid var(--color-border-secondary)',
        borderRadius: '4px',
      }}
      role="group"
      aria-label="Compare against value or field"
    >
      {(['value', 'field'] as const).map((m, idx) => {
        const active = mode === m
        return (
          <button
            key={m}
            type="button"
            onClick={() => mode !== m && onChange(m)}
            style={{
              padding: '0 10px',
              fontSize: '11px',
              fontWeight: 500,
              borderLeft: idx > 0 ? '1px solid var(--color-border-secondary)' : 'none',
              background: active ? '#6c5ce7' : '#ffffff',
              color: active ? '#ffffff' : 'var(--color-text-secondary)',
              cursor: active ? 'default' : 'pointer',
              transition: 'background 0.12s ease, color 0.12s ease',
            }}
          >
            {m === 'value' ? 'Value' : 'Field'}
          </button>
        )
      })}
    </div>
  )
}

// ── OnlyIfEditor ───────────────────────────────────────────────────────────

function OnlyIfEditor({
  value,
  onChange,
  onRemove,
  allFields,
}: {
  value: OnlyIf
  onChange: (v: OnlyIf) => void
  onRemove: () => void
  allFields: string[]
}) {
  const { conditions, else: elseBranch } = value
  const setConditions = (next: Condition[]) => onChange({ ...value, conditions: next })
  const setElse = (next: ElseBranch) => onChange({ ...value, else: next })
  const lbl = 'text-xs text-gray-400 font-mono w-16 shrink-0 pt-2'

  return (
    <div className="space-y-2 py-2">

      {conditions.map((cond, i) => {
        const noVal = NO_VALUE_OPERATORS.includes(cond.operator)
        const base = baseOperator(cond.operator)
        const mode: 'value' | 'field' = isFieldOperator(cond.operator) ? 'field' : 'value'
        const showModeToggle = !noVal && MODE_AWARE_OPERATORS.has(base)

        function setBase(nextBase: string) {
          const next = [...conditions]
          next[i] = {
            ...next[i],
            operator: withOperatorMode(nextBase, mode),
            value: '',
          }
          setConditions(next)
        }
        function setMode(nextMode: 'value' | 'field') {
          const next = [...conditions]
          next[i] = {
            ...next[i],
            operator: withOperatorMode(base, nextMode),
            value: '',
          }
          setConditions(next)
        }
        return (
          <div key={i} className="flex gap-2 items-start">
            {i === 0 ? (
              <span className={lbl}>ONLY IF</span>
            ) : (
              <select
                value={cond.logic ?? 'AND'}
                onChange={(e) => {
                  const next = [...conditions]
                  next[i] = { ...next[i], logic: e.target.value as 'AND' | 'OR' }
                  setConditions(next)
                }}
                className={miniSel}
                style={{ flex: '0 0 64px' }}
              >
                <option value="AND">AND</option>
                <option value="OR">OR</option>
              </select>
            )}
            <div style={{ flex: '0 0 160px' }}>
              <FieldSelect
                value={cond.field}
                onChange={(v) => {
                  const next = [...conditions]
                  next[i] = { ...next[i], field: v }
                  setConditions(next)
                }}
                allFields={allFields}
              />
            </div>
            <select
              value={base}
              onChange={(e) => setBase(e.target.value)}
              className={miniSel}
              style={{ flex: '0 0 140px' }}
            >
              {OPERATORS.map((o) => (
                <option key={o.value} value={o.value}>{o.label}</option>
              ))}
            </select>
            {!noVal && (
              <div className="flex-1 min-w-0 flex gap-1.5 items-stretch">
                {showModeToggle && (
                  <ConditionModeToggle mode={mode} onChange={setMode} />
                )}
                <div className="flex-1 min-w-0">
                  {mode === 'field' ? (
                    <FieldSelect
                      value={cond.value}
                      onChange={(v) => {
                        const next = [...conditions]
                        next[i] = { ...next[i], value: v }
                        setConditions(next)
                      }}
                      allFields={allFields}
                    />
                  ) : (
                    <input
                      type="text"
                      value={cond.value}
                      onChange={(e) => {
                        const next = [...conditions]
                        next[i] = { ...next[i], value: e.target.value }
                        setConditions(next)
                      }}
                      placeholder="Value..."
                      className={inp}
                    />
                  )}
                </div>
              </div>
            )}
            {conditions.length > 1 && (
              <button
                type="button"
                onClick={() => setConditions(conditions.filter((_, j) => j !== i))}
                className={`${btnSm} bg-gray-100 text-gray-500 hover:bg-gray-200 mt-0.5`}
                style={{ flex: 'none' }}
              >
                ×
              </button>
            )}
          </div>
        )
      })}

      <div className="flex gap-2 pl-16">
        <button
          type="button"
          onClick={() => setConditions([...conditions, { field: '', operator: 'equals', value: '', logic: 'AND' }])}
          className={`${btnSm} bg-gray-100 text-gray-600 hover:bg-gray-200`}
        >
          + AND
        </button>
        <button
          type="button"
          onClick={() => setConditions([...conditions, { field: '', operator: 'equals', value: '', logic: 'OR' }])}
          className={`${btnSm} bg-gray-100 text-gray-600 hover:bg-gray-200`}
        >
          + OR
        </button>
      </div>

      <div className="flex gap-2 items-start border-t border-indigo-100 pt-2">
        <span className={lbl}>ELSE</span>
        <select
          value={elseBranch.type}
          onChange={(e) => {
            const next = e.target.value as ElseBranch['type']
            if (next === 'combine') {
              setElse({ type: 'combine', blocks: [] })
            } else {
              setElse({ type: next, value: '' })
            }
          }}
          className={miniSel}
          style={{ flex: '0 0 120px' }}
        >
          <option value="empty">Empty</option>
          <option value="static">Static</option>
          <option value="field">Field</option>
          <option value="combine">Combine</option>
        </select>
        <div className="flex-1 min-w-0">
          {elseBranch.type === 'static' && (
            <input
              type="text"
              value={elseBranch.value}
              onChange={(e) => setElse({ ...elseBranch, value: e.target.value })}
              placeholder='e.g. "out_of_stock"'
              className={inp}
            />
          )}
          {elseBranch.type === 'field' && (
            <FieldSelect
              value={elseBranch.value}
              onChange={(v) => setElse({ ...elseBranch, value: v })}
              allFields={allFields}
            />
          )}
          {elseBranch.type === 'empty' && (
            <span className="text-sm text-gray-400 italic pt-1.5">The field is left empty</span>
          )}
          {elseBranch.type === 'combine' && (
            <CombineChipsEditor
              blocks={elseBranch.blocks ?? []}
              allFields={allFields}
              onChange={(next) => setElse({ type: 'combine', blocks: next })}
            />
          )}
        </div>
      </div>

      <div className="flex justify-end pt-1">
        <button
          type="button"
          onClick={onRemove}
          className="text-xs text-gray-400 hover:text-red-500 transition-colors"
        >
          Remove condition
        </button>
      </div>

    </div>
  )
}

// ── FieldRow ───────────────────────────────────────────────────────────────

function FieldRow({
  field,
  state,
  allFields,
  onTypeChange,
  onConfigChange,
  previewValue,
  onRemove,
  onPreview,
}: {
  field: string
  state: FieldState
  allFields: string[]
  onTypeChange: (t: MappingType) => void
  onConfigChange: (c: Config) => void
  previewValue: string | null
  // When set, renders a small × button next to the field name. Used by the
  // Custom-felter section to delete a user-defined field.
  onRemove?: () => void
  // When set, renders a hover-only "Preview" button that opens the field
  // preview sidebar for this row.
  onPreview?: () => void
}) {
  // Strip the "custom:" prefix when displaying user-defined fields. The
  // underlying mapping key keeps the prefix so feedGenerator can detect it.
  const displayField = field.startsWith('custom:') ? field.slice('custom:'.length) : field
  const onlyIf = state.config.onlyIf as OnlyIf | undefined
  const [showOnlyIf, setShowOnlyIf] = useState(!!onlyIf?.conditions?.length)
  const hasConditions = onlyIf?.conditions?.some((c) => c.field) ?? false

  function openOnlyIf() {
    if (!onlyIf) {
      onConfigChange({
        ...state.config,
        onlyIf: {
          conditions: [{ field: '', operator: 'equals', value: '', logic: null }],
          else: { type: 'empty', value: '' },
        } satisfies OnlyIf,
      })
    }
    setShowOnlyIf(true)
  }

  function removeOnlyIf() {
    const { onlyIf: _removed, ...rest } = state.config as Record<string, unknown>
    onConfigChange(rest)
    setShowOnlyIf(false)
  }

  return (
    <div className="px-3.5 py-2.5 group">
      <div className="flex items-start gap-3">
        <div className="w-52 pt-1.5 shrink-0">
          <div className="flex items-center justify-between gap-1.5">
            <code
              className="ff-mono truncate"
              style={{ fontSize: '11px', color: 'var(--color-text-primary)' }}
            >
              {displayField}
            </code>
            <div className="flex items-center gap-1 shrink-0">
              {onPreview && (
                <button
                  type="button"
                  onClick={onPreview}
                  title="Preview the field across all products"
                  className="opacity-0 group-hover:opacity-100 focus:opacity-100"
                  style={{
                    padding: '2px 6px',
                    fontSize: '10px',
                    fontWeight: 500,
                    border: '1px solid var(--color-border-secondary)',
                    borderRadius: '4px',
                    background: '#ffffff',
                    color: 'var(--color-accent)',
                    cursor: 'pointer',
                    transition: 'opacity 0.12s ease',
                    lineHeight: 1.2,
                  }}
                >
                  Preview
                </button>
              )}
              {onRemove && (
                <button
                  type="button"
                  onClick={onRemove}
                  aria-label={`Delete field ${displayField}`}
                  title="Delete custom field"
                  style={{
                    width: '18px',
                    height: '18px',
                    display: 'inline-flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    padding: 0,
                    border: '1px solid var(--color-border-tertiary)',
                    borderRadius: '4px',
                    background: 'transparent',
                    color: 'var(--color-text-tertiary)',
                    cursor: 'pointer',
                    fontSize: '12px',
                    lineHeight: 1,
                    flexShrink: 0,
                  }}
                >
                  ×
                </button>
              )}
            </div>
          </div>
        </div>
        <div className="w-40 shrink-0">
          <select
            value={state.type}
            onChange={(e) => onTypeChange(e.target.value as MappingType)}
            className={sel}
          >
            {MAPPING_TYPES.map((t) => (
              <option key={t.value} value={t.value}>{t.label}</option>
            ))}
          </select>
        </div>
        <div className="flex-1 min-w-0">
          {state.type !== '' && (
            <ConfigEditor
              type={state.type}
              config={state.config}
              onChange={onConfigChange}
              allFields={allFields}
            />
          )}
        </div>
        {state.type !== '' && (
          <div className="flex items-start gap-1.5 shrink-0 mt-0.5">
            <button
              type="button"
              onClick={showOnlyIf ? removeOnlyIf : openOnlyIf}
              className={`px-2.5 py-2 rounded-lg text-xs font-medium transition-colors ${
                hasConditions
                  ? 'bg-indigo-100 text-indigo-700 hover:bg-indigo-200'
                  : 'bg-gray-100 text-gray-500 hover:bg-gray-200'
              }`}
            >
              {hasConditions ? 'Only if ✓' : '+ Only if'}
            </button>
            {showOnlyIf && (
              <button
                type="button"
                onClick={removeOnlyIf}
                title="Remove all conditions"
                aria-label="Remove all conditions"
                className="px-2 py-2 rounded-lg text-xs font-medium bg-gray-100 text-gray-500 hover:bg-red-100 hover:text-red-600 transition-colors"
              >
                ×
              </button>
            )}
          </div>
        )}
      </div>

      {/* Live preview value */}
      {previewValue !== null && state.type !== '' && (
        <div className="flex gap-4 mt-1.5">
          <div className="w-52 shrink-0" />
          <div className="w-40 shrink-0" />
          <div className="flex-1 min-w-0 flex items-center gap-1.5">
            {previewValue === '__AI__' ? (
              <span className="inline-flex items-center px-1.5 py-0.5 rounded text-xs bg-purple-100 text-purple-700 font-medium">
                AI – cannot be previewed
              </span>
            ) : previewValue === '' ? (
              <span className="text-xs text-red-500 font-medium">Missing</span>
            ) : (
              <>
                <span className="text-xs text-gray-300 shrink-0">→</span>
                <span className="text-xs text-indigo-600 break-all line-clamp-2">{previewValue}</span>
              </>
            )}
          </div>
        </div>
      )}

      {showOnlyIf && state.type !== '' && onlyIf && (
        <div className="mt-2 ml-52 pl-4 border-l-2 border-indigo-200">
          <OnlyIfEditor
            value={onlyIf}
            onChange={(next) => onConfigChange({ ...state.config, onlyIf: next })}
            onRemove={removeOnlyIf}
            allFields={allFields}
          />
        </div>
      )}
    </div>
  )
}

// ── Used-field collection ──────────────────────────────────────────────────

// Walks a single field's mapping state and returns every Shopify field it
// references — including nested references inside COMBINE blocks and onlyIf
// conditions/else-branches. Used by the "Shopify felter" panel to badge each
// field as mapped or unmapped.
function collectUsedFields(state: FieldState): string[] {
  const used: string[] = []
  const cfg = state.config

  switch (state.type) {
    case 'FIELD':
    case 'PREFIX_SUFFIX':
    case 'FIND_REPLACE':
    case 'TRUNCATE':
    case 'STRIP_HTML': {
      const f = String(cfg.field ?? '')
      if (f) used.push(f)
      break
    }
    case 'COMBINE': {
      const blocks = (cfg.blocks as { type: 'field' | 'text'; value: string }[]) ?? []
      for (const b of blocks) {
        if (b.type === 'field' && b.value) used.push(b.value)
      }
      break
    }
  }

  const onlyIf = cfg.onlyIf as OnlyIf | undefined
  if (onlyIf) {
    for (const c of onlyIf.conditions) {
      if (c.field) used.push(c.field)
    }
    if (onlyIf.else.type === 'field' && onlyIf.else.value) {
      used.push(onlyIf.else.value)
    }
  }

  return used
}

// ── ShopifyFieldsModal ─────────────────────────────────────────────────────

function MappedBadge({ mapped }: { mapped: boolean }) {
  return (
    <span
      className={`shrink-0 text-xs px-2 py-0.5 rounded font-medium ${
        mapped ? 'bg-green-100 text-green-700' : 'bg-gray-100 text-gray-500'
      }`}
    >
      {mapped ? 'Mapped' : 'Not mapped'}
    </span>
  )
}

function FieldExample({ value }: { value: string }) {
  if (!value) {
    return <span className="text-gray-300 italic">empty</span>
  }
  const trimmed = value.length > 120 ? value.slice(0, 120) + '…' : value
  return <span>{trimmed}</span>
}

function ShopifyFieldsModal({
  standardFields,
  metafields,
  product,
  loading,
  marketUrl,
  usedFields,
  onClose,
}: {
  standardFields: string[]
  metafields: { namespace: string; key: string }[]
  product: PreviewProduct | null
  loading: boolean
  marketUrl: string | null
  usedFields: Set<string>
  onClose: () => void
}) {
  const feedMode = useContext(FeedModeContext)
  const labels = useMemo(() => getFieldLabels(feedMode), [feedMode])
  const [search, setSearch] = useState('')

  function exampleFor(field: string): string {
    if (!product) return ''
    return resolveClientField(field, product, marketUrl, feedMode)
  }

  const q = search.toLowerCase()
  const filteredStandard = q ? standardFields.filter((f) => f.toLowerCase().includes(q)) : standardFields
  const filteredMeta = q
    ? metafields.filter((m) => `${m.namespace}.${m.key}`.toLowerCase().includes(q))
    : metafields

  const totalMapped =
    standardFields.filter((f) => usedFields.has(f)).length +
    metafields.filter((m) => usedFields.has(`metafield:${m.namespace}.${m.key}`)).length
  const totalFields = standardFields.length + metafields.length

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center pt-12 px-4" onClick={onClose}>
      <div className="absolute inset-0 bg-black/30" />
      <div
        className="relative bg-white rounded-xl shadow-xl border border-gray-200 w-full max-w-3xl flex flex-col max-h-[85vh] overflow-hidden"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="px-6 py-4 border-b border-gray-100 shrink-0">
          <h2 className="text-base font-semibold text-gray-900">Shopify fields</h2>
          <p className="text-sm text-gray-500 mt-0.5">
            {totalMapped} of {totalFields} fields are used in a mapping
            {product ? ` — example values from "${product.title}"` : ''}
          </p>
          <input
            type="search"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search field…"
            className="mt-3 w-full px-3 py-2 rounded-lg border border-gray-200 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-300"
          />
        </div>

        <div className="overflow-y-auto flex-1">
          {/* Standard fields */}
          <div className="px-6 py-2 bg-gray-50 border-b border-gray-100 sticky top-0 z-10">
            <h3 className="text-xs font-semibold text-gray-500 uppercase tracking-wider">
              Standard fields
            </h3>
          </div>
          {loading && !product ? (
            <div className="p-6 text-center text-sm text-gray-400">Loading example values…</div>
          ) : filteredStandard.length === 0 ? (
            <div className="p-6 text-center text-sm text-gray-400">No fields match the search</div>
          ) : (
            filteredStandard.map((f) => (
              <div
                key={f}
                className="flex items-start gap-3 px-6 py-2.5 border-b border-gray-50 last:border-b-0"
              >
                <div className="w-52 shrink-0 pt-0.5">
                  <code className="text-xs font-mono text-gray-700">{labels[f] ?? f}</code>
                </div>
                <div className="flex-1 min-w-0 text-xs text-gray-500 break-all pt-0.5">
                  <FieldExample value={exampleFor(f)} />
                </div>
                <MappedBadge mapped={usedFields.has(f)} />
              </div>
            ))
          )}

          {/* Metafields */}
          {metafields.length > 0 && (
            <>
              <div className="px-6 py-2 bg-gray-50 border-b border-gray-100 sticky top-0 z-10">
                <h3 className="text-xs font-semibold text-gray-500 uppercase tracking-wider">
                  Metafields ({metafields.length})
                </h3>
              </div>
              {filteredMeta.length === 0 ? (
                <div className="p-6 text-center text-sm text-gray-400">No metafields match the search</div>
              ) : (
                filteredMeta.map((m) => {
                  const fullKey = `metafield:${m.namespace}.${m.key}`
                  return (
                    <div
                      key={fullKey}
                      className="flex items-start gap-3 px-6 py-2.5 border-b border-gray-50 last:border-b-0"
                    >
                      <div className="w-52 shrink-0 pt-0.5">
                        <code className="text-xs font-mono text-gray-700">{m.namespace}.{m.key}</code>
                      </div>
                      <div className="flex-1 min-w-0 text-xs text-gray-500 break-all pt-0.5">
                        <FieldExample value={exampleFor(fullKey)} />
                      </div>
                      <MappedBadge mapped={usedFields.has(fullKey)} />
                    </div>
                  )
                })
              )}
            </>
          )}
        </div>

        <div className="px-6 py-3 border-t border-gray-100 flex justify-end shrink-0">
          <button
            onClick={onClose}
            className="px-4 py-2 rounded-lg border border-gray-200 text-sm text-gray-600 hover:bg-gray-50 transition-colors"
          >
            Luk
          </button>
        </div>
      </div>
    </div>
  )
}

// ── ProductPickerModal ─────────────────────────────────────────────────────

// Self-fetching picker: pulls products from /api/products with server-side
// search + 20-per-page pagination. Replaces the old "load everything client
// side and filter locally" approach so it scales to feeds with thousands of
// products.
const PICKER_PAGE_SIZE = 20

function ProductPickerModal({
  feedId,
  onSelect,
  onClose,
}: {
  feedId: string
  onSelect: (p: PreviewProduct) => void
  onClose: () => void
}) {
  const [search, setSearch] = useState('')
  const [debouncedSearch, setDebouncedSearch] = useState('')
  const [products, setProducts] = useState<PreviewProduct[]>([])
  const [total, setTotal] = useState(0)
  const [totalPages, setTotalPages] = useState(1)
  const [page, setPage] = useState(1)
  const [loading, setLoading] = useState(false)

  // 300 ms debounce on the typed query → committed search.
  useEffect(() => {
    const t = setTimeout(() => setDebouncedSearch(search.trim()), 300)
    return () => clearTimeout(t)
  }, [search])

  // New search resets paging so the user lands on results from page 1.
  useEffect(() => {
    setPage(1)
  }, [debouncedSearch])

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    const params = new URLSearchParams({
      feedId,
      page: String(page),
      pageSize: String(PICKER_PAGE_SIZE),
    })
    if (debouncedSearch) params.set('search', debouncedSearch)

    fetch(`/api/products?${params.toString()}`)
      .then(async (res) => {
        if (!res.ok) throw new Error(`HTTP ${res.status}`)
        return (await res.json()) as {
          products?: PreviewProduct[]
          total?: number
          totalPages?: number
        }
      })
      .then((data) => {
        if (cancelled) return
        setProducts(data.products ?? [])
        setTotal(data.total ?? 0)
        setTotalPages(Math.max(1, data.totalPages ?? 1))
      })
      .catch(() => {
        if (!cancelled) {
          setProducts([])
          setTotal(0)
          setTotalPages(1)
        }
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })

    return () => {
      cancelled = true
    }
  }, [feedId, debouncedSearch, page])

  return (
    <div
      className="fixed inset-0 z-50 flex items-start justify-center pt-20 px-4"
      onClick={onClose}
    >
      <div className="absolute inset-0 bg-black/20" />
      <div
        className="relative bg-white rounded-xl shadow-xl border border-gray-200 w-full max-w-md overflow-hidden flex flex-col"
        style={{ maxHeight: 'calc(100vh - 120px)' }}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="p-4 border-b border-gray-100 shrink-0">
          <p className="text-xs font-medium text-gray-500 mb-2">Choose preview product</p>
          <input
            type="search"
            placeholder="Search title, vendor, handle, tags…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            // eslint-disable-next-line jsx-a11y/no-autofocus
            autoFocus
            className="w-full px-3 py-2 rounded-lg border border-gray-300 text-sm focus:border-indigo-500 focus:outline-none focus:ring-2 focus:ring-indigo-500/20"
          />
        </div>
        <div
          className="overflow-y-auto"
          style={{ flex: 1, opacity: loading && products.length > 0 ? 0.6 : 1 }}
        >
          {loading && products.length === 0 ? (
            <div className="p-8 text-center text-sm text-gray-400">Loading products…</div>
          ) : products.length === 0 ? (
            <div className="p-8 text-center text-sm text-gray-400">
              {debouncedSearch ? 'No products match the search' : 'No products found'}
            </div>
          ) : (
            products.map((p) => (
              <button
                key={p.id}
                onClick={() => onSelect(p)}
                className="w-full text-left px-4 py-3 hover:bg-indigo-50 border-b border-gray-50 transition-colors flex items-center gap-3"
              >
                {(p.images[0]?.src as string | undefined) ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img
                    src={p.images[0].src as string}
                    alt=""
                    className="w-8 h-8 rounded object-cover shrink-0 border border-gray-100"
                  />
                ) : (
                  <div className="w-8 h-8 rounded bg-gray-100 shrink-0" />
                )}
                <div className="min-w-0">
                  <div className="text-sm font-medium text-gray-800 truncate">{p.title}</div>
                  <div className="text-xs text-gray-400 font-mono truncate mt-0.5">{p.handle}</div>
                </div>
              </button>
            ))
          )}
        </div>
        {total > 0 && (
          <div
            className="px-4 py-2.5 flex items-center justify-between gap-2 shrink-0"
            style={{ borderTop: '1px solid var(--color-border-tertiary)' }}
          >
            <button
              type="button"
              onClick={() => setPage((p) => Math.max(1, p - 1))}
              disabled={loading || page <= 1}
              className="ff-btn-secondary"
            >
              Previous
            </button>
            <span style={{ fontSize: '11px', color: 'var(--color-text-tertiary)' }}>
              Page {page} of {totalPages} · {total} products
            </span>
            <button
              type="button"
              onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
              disabled={loading || page >= totalPages}
              className="ff-btn-secondary"
            >
              Next
            </button>
          </div>
        )}
      </div>
    </div>
  )
}

// ── AI Suggestions Modal ───────────────────────────────────────────────────

function ConfidenceBadge({ confidence }: { confidence: AISuggestion['confidence'] }) {
  const styles = {
    high:   'bg-green-100 text-green-700',
    medium: 'bg-amber-100 text-amber-700',
    low:    'bg-gray-100 text-gray-500',
  }
  const labels = { high: 'High', medium: 'Medium', low: 'Low' }
  return (
    <span className={`text-xs px-1.5 py-0.5 rounded font-medium ${styles[confidence]}`}>
      {labels[confidence]}
    </span>
  )
}

function AISuggestionsModal({
  suggestions,
  currentMappings,
  onApply,
  onClose,
}: {
  suggestions: AISuggestion[]
  currentMappings: Record<string, FieldState>
  onApply: (selectedFields: string[]) => void
  onClose: () => void
}) {
  function isSameAsCurrent(s: AISuggestion): boolean {
    const state = currentMappings[s.google_field]
    if (!state?.type) return false
    if (s.mapping_type === 'static') {
      return state.type === 'STATIC' && String(state.config.value ?? '') === (s.static_value ?? '')
    }
    return state.type === 'FIELD' && String(state.config.field ?? '') === (s.shopify_field ?? '')
  }

  const validSuggestions = suggestions.filter((s) => ALL_FIELDS.includes(s.google_field))

  const [selected, setSelected] = useState<Set<string>>(() => {
    const init = new Set<string>()
    for (const s of validSuggestions) {
      if (s.confidence === 'high' && !isSameAsCurrent(s)) {
        init.add(s.google_field)
      }
    }
    return init
  })

  function toggle(field: string) {
    setSelected((prev) => {
      const next = new Set(prev)
      if (next.has(field)) next.delete(field)
      else next.add(field)
      return next
    })
  }

  const selectableCount = validSuggestions.filter((s) => !isSameAsCurrent(s)).length

  return (
    <div
      className="fixed inset-0 z-50 flex items-start justify-center pt-12 px-4"
      onClick={onClose}
    >
      <div className="absolute inset-0 bg-black/30" />
      <div
        className="relative bg-white rounded-xl shadow-xl border border-gray-200 w-full max-w-2xl flex flex-col max-h-[85vh] overflow-hidden"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="px-6 py-4 border-b border-gray-100 shrink-0">
          <h2 className="text-base font-semibold text-gray-900">AI mapping suggestions</h2>
          <p className="text-sm text-gray-500 mt-0.5">
            {validSuggestions.length} suggestions · {selectableCount} can be applied
          </p>
        </div>

        {/* List */}
        <div className="overflow-y-auto flex-1">
          {validSuggestions.length === 0 ? (
            <p className="p-8 text-center text-sm text-gray-400">
              AI found no confident mapping suggestions for your store.
            </p>
          ) : (
            validSuggestions.map((s) => {
              const same = isSameAsCurrent(s)
              const hasMapped = !!currentMappings[s.google_field]?.type
              const willOverwrite = hasMapped && !same

              return (
                <label
                  key={s.google_field}
                  className={`flex items-start gap-3 px-6 py-3.5 border-b border-gray-50 transition-colors ${
                    same ? 'cursor-not-allowed opacity-60' : 'cursor-pointer hover:bg-gray-50'
                  }`}
                >
                  <input
                    type="checkbox"
                    checked={!same && selected.has(s.google_field)}
                    disabled={same}
                    onChange={() => { if (!same) toggle(s.google_field) }}
                    className="mt-0.5 rounded border-gray-300 text-indigo-600 focus:ring-indigo-500 shrink-0"
                  />
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <code className="text-xs font-mono text-gray-700 bg-gray-100 px-1.5 py-0.5 rounded">
                        {s.google_field}
                      </code>
                      <span className="text-gray-300 text-sm">→</span>
                      {s.mapping_type === 'static' ? (
                        <code className="text-xs font-mono text-emerald-700 bg-emerald-50 px-1.5 py-0.5 rounded">
                          Static: &quot;{s.static_value ?? ''}&quot;
                        </code>
                      ) : (
                        <code className="text-xs font-mono text-indigo-700 bg-indigo-50 px-1.5 py-0.5 rounded">
                          {s.shopify_field ?? '—'}
                        </code>
                      )}
                      <ConfidenceBadge confidence={s.confidence} />
                      {same && (
                        <span className="text-xs bg-gray-100 text-gray-500 px-1.5 py-0.5 rounded">
                          Same as current
                        </span>
                      )}
                      {willOverwrite && (
                        <span className="text-xs bg-amber-50 text-amber-700 border border-amber-200 px-1.5 py-0.5 rounded">
                          Overwrites existing mapping
                        </span>
                      )}
                    </div>
                    <p className="text-xs text-gray-500 mt-1">{s.reason}</p>
                  </div>
                </label>
              )
            })
          )}
        </div>

        {/* Footer */}
        <div className="px-6 py-4 border-t border-gray-100 flex items-center justify-between shrink-0">
          <span className="text-sm text-gray-500">
            {selected.size} selected
          </span>
          <div className="flex gap-2">
            <button
              onClick={onClose}
              className="px-4 py-2 rounded-lg border border-gray-200 text-sm text-gray-600 hover:bg-gray-50 transition-colors"
            >
              Cancel
            </button>
            <button
              onClick={() => onApply([...selected])}
              disabled={selected.size === 0}
              className="px-4 py-2 rounded-lg bg-indigo-600 text-white text-sm font-medium hover:bg-indigo-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
            >
              Apply {selected.size > 0 ? `${selected.size} ` : ''}selected
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}

// ── SectionPanel ───────────────────────────────────────────────────────────

// Renders a single mapping section. Supports two modes:
//   - static (collapsible=false): always-open header (used for required +
//     tilføjede felter)
//   - collapsible: header is a button that toggles open/closed
function SectionPanel({
  title,
  fields,
  mappings,
  allFields,
  onTypeChange,
  onConfigChange,
  previewProduct,
  previewValues,
  onPreview,
  collapsible = false,
  open = true,
  onToggle,
}: {
  title: string
  fields: string[]
  mappings: Record<string, FieldState>
  allFields: string[]
  onTypeChange: (field: string, type: MappingType) => void
  onConfigChange: (field: string, config: Config) => void
  previewProduct: PreviewProduct | null
  previewValues: Record<string, string | null>
  onPreview: (field: string) => void
  collapsible?: boolean
  open?: boolean
  onToggle?: () => void
}) {
  const sectionMapped = fields.filter((f) => mappings[f]?.type !== '' && mappings[f]?.type).length

  const counter = (
    <span
      className="ff-mono"
      style={{
        fontSize: '10px',
        color: 'var(--color-text-tertiary)',
        textTransform: 'none',
        letterSpacing: 0,
      }}
    >
      {sectionMapped}/{fields.length} mapped
    </span>
  )

  const headerContent = (
    <>
      <div className="flex items-center gap-2 flex-1 min-w-0">
        {collapsible && (
          <svg
            width="10"
            height="10"
            viewBox="0 0 12 12"
            fill="none"
            style={{
              transform: open ? 'rotate(90deg)' : 'rotate(0deg)',
              transition: 'transform 0.12s ease',
              color: 'var(--color-text-tertiary)',
              flexShrink: 0,
            }}
          >
            <path d="M4 2l4 4-4 4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        )}
        <span>{title}</span>
      </div>
      {counter}
    </>
  )

  return (
    <div className="ff-panel">
      {collapsible ? (
        <button
          type="button"
          onClick={onToggle}
          className="ff-panel-header"
          style={{ width: '100%', cursor: 'pointer', textAlign: 'left' }}
        >
          {headerContent}
        </button>
      ) : (
        <div className="ff-panel-header">{headerContent}</div>
      )}
      {open && (
        <div
          style={{ borderColor: 'var(--color-border-tertiary)' }}
          className="divide-y divide-[var(--color-border-tertiary)]"
        >
          {fields.map((field) => (
            <FieldRow
              key={field}
              field={field}
              state={mappings[field] ?? { type: '', config: {} }}
              allFields={allFields}
              onTypeChange={(type) => onTypeChange(field, type)}
              onConfigChange={(config) => onConfigChange(field, config)}
              previewValue={previewProduct ? (previewValues[field] ?? null) : null}
              onPreview={() => onPreview(field)}
            />
          ))}
        </div>
      )}
    </div>
  )
}

// ── CustomFieldsSection ────────────────────────────────────────────────────

// Renders the "Custom felter" panel: list of user-defined fields (with the
// "custom:" prefix kept on the underlying mapping key) plus an inline
// add-form. Validation rules: alphanumeric + underscore only, no spaces.
function CustomFieldsSection({
  customFields,
  mappings,
  allFields,
  onTypeChange,
  onConfigChange,
  previewProduct,
  previewValues,
  onAdd,
  onRemove,
  onPreview,
}: {
  customFields: string[]
  mappings: Record<string, FieldState>
  allFields: string[]
  onTypeChange: (field: string, type: MappingType) => void
  onConfigChange: (field: string, config: Config) => void
  previewProduct: PreviewProduct | null
  previewValues: Record<string, string | null>
  onAdd: (rawName: string) => string | null
  onRemove: (field: string) => void
  onPreview: (field: string) => void
}) {
  const [showAdd, setShowAdd] = useState(false)
  const [name, setName] = useState('')
  const [error, setError] = useState<string | null>(null)

  const mappedCount = customFields.filter((f) => mappings[f]?.type !== '' && mappings[f]?.type).length

  function tryAdd() {
    const err = onAdd(name)
    if (err) {
      setError(err)
      return
    }
    setName('')
    setError(null)
    setShowAdd(false)
  }

  function cancelAdd() {
    setShowAdd(false)
    setName('')
    setError(null)
  }

  return (
    <div className="ff-panel">
      <div className="ff-panel-header">
        <span>Custom fields</span>
        <span
          className="ff-mono"
          style={{
            fontSize: '10px',
            color: 'var(--color-text-tertiary)',
            textTransform: 'none',
            letterSpacing: 0,
          }}
        >
          {mappedCount}/{customFields.length} mapped
        </span>
      </div>
      <div
        style={{ borderColor: 'var(--color-border-tertiary)' }}
        className="divide-y divide-[var(--color-border-tertiary)]"
      >
        {customFields.length === 0 && !showAdd && (
          <div
            className="px-3.5 py-3"
            style={{ fontSize: '11px', color: 'var(--color-text-tertiary)' }}
          >
            No custom fields yet. Add fields that don&apos;t exist in the Google Shopping standard —
            they are written to the feed without the <code className="ff-mono">g:</code> prefix.
          </div>
        )}

        {customFields.map((field) => (
          <FieldRow
            key={field}
            field={field}
            state={mappings[field] ?? { type: '', config: {} }}
            allFields={allFields}
            onTypeChange={(type) => onTypeChange(field, type)}
            onConfigChange={(config) => onConfigChange(field, config)}
            previewValue={previewProduct ? (previewValues[field] ?? null) : null}
            onRemove={() => onRemove(field)}
            onPreview={() => onPreview(field)}
          />
        ))}

        {showAdd ? (
          <div className="px-3.5 py-3 space-y-2">
            <div className="flex items-center gap-2 flex-wrap">
              <input
                type="text"
                autoFocus
                value={name}
                onChange={(e) => {
                  setName(e.target.value)
                  if (error) setError(null)
                }}
                placeholder="e.g. vintage_year"
                className={`${inp} ff-mono`}
                style={{ flex: '1 1 280px', minWidth: 0, maxWidth: '320px' }}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') {
                    e.preventDefault()
                    tryAdd()
                  } else if (e.key === 'Escape') {
                    e.preventDefault()
                    cancelAdd()
                  }
                }}
              />
              <button type="button" onClick={tryAdd} className="ff-btn-primary">
                Add
              </button>
              <button type="button" onClick={cancelAdd} className="ff-btn-secondary">
                Cancel
              </button>
            </div>
            {error && (
              <p style={{ fontSize: '11px', color: 'var(--color-badge-danger-text)' }}>{error}</p>
            )}
            <p style={{ fontSize: '11px', color: 'var(--color-text-tertiary)' }}>
              Letters, digits and underscore only. The field is written to XML as{' '}
              <code className="ff-mono">{`<${name.trim() || 'field_name'}>…</${name.trim() || 'field_name'}>`}</code>
            </p>
          </div>
        ) : (
          <div className="px-3.5 py-2.5">
            <button
              type="button"
              onClick={() => setShowAdd(true)}
              className="ff-btn-secondary"
            >
              ＋ Add custom field
            </button>
          </div>
        )}
      </div>
    </div>
  )
}

// ── AddFieldModal ──────────────────────────────────────────────────────────

function AddFieldModal({
  addedFields,
  onAdd,
  onRemove,
  onClose,
}: {
  addedFields: string[]
  onAdd: (field: string) => void
  onRemove: (field: string) => void
  onClose: () => void
}) {
  const [search, setSearch] = useState('')
  const addedSet = new Set(addedFields)
  const q = search.trim().toLowerCase()

  return (
    <div
      className="fixed inset-0 z-50 flex items-start justify-center pt-12 px-4"
      onClick={onClose}
    >
      <div className="absolute inset-0" style={{ background: 'rgba(0,0,0,0.3)' }} />
      <div
        className="relative ff-panel w-full"
        style={{
          maxWidth: '640px',
          maxHeight: 'calc(100vh - 96px)',
          display: 'flex',
          flexDirection: 'column',
        }}
        onClick={(e) => e.stopPropagation()}
      >
        <div
          className="ff-panel-header"
          style={{ textTransform: 'none', letterSpacing: 0, fontSize: '12px' }}
        >
          <span style={{ fontSize: '13px', fontWeight: 500, color: 'var(--color-text-primary)' }}>
            Add field
          </span>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            style={{
              fontSize: '16px',
              lineHeight: 1,
              color: 'var(--color-text-tertiary)',
              background: 'transparent',
              border: 'none',
              cursor: 'pointer',
              padding: '2px 6px',
            }}
          >
            ×
          </button>
        </div>

        <div className="px-3.5 py-3" style={{ borderBottom: '1px solid var(--color-border-tertiary)' }}>
          <input
            type="search"
            autoFocus
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search field…"
            className={inp}
          />
        </div>

        <div style={{ overflowY: 'auto', flex: 1 }}>
          {ADVANCED_CATEGORIES.map((category) => {
            const matching = q
              ? category.fields.filter((f) => f.toLowerCase().includes(q))
              : category.fields
            if (matching.length === 0) return null
            return (
              <div key={category.title}>
                <div
                  className="ff-label"
                  style={{
                    padding: '8px 14px',
                    background: 'var(--color-background-tertiary)',
                    borderTop: '1px solid var(--color-border-tertiary)',
                    borderBottom: '1px solid var(--color-border-tertiary)',
                  }}
                >
                  {category.title}
                </div>
                {matching.map((field) => {
                  const isAdded = addedSet.has(field)
                  return (
                    <div
                      key={field}
                      className="flex items-center justify-between gap-3"
                      style={{
                        padding: '8px 14px',
                        borderBottom: '1px solid var(--color-border-tertiary)',
                      }}
                    >
                      <code
                        className="ff-mono"
                        style={{ fontSize: '11px', color: 'var(--color-text-primary)' }}
                      >
                        {field}
                      </code>
                      {isAdded ? (
                        <button
                          type="button"
                          onClick={() => onRemove(field)}
                          className="ff-btn-secondary"
                          style={{ color: 'var(--color-badge-danger-text)' }}
                        >
                          Remove
                        </button>
                      ) : (
                        <button
                          type="button"
                          onClick={() => onAdd(field)}
                          className="ff-btn-primary"
                        >
                          Add
                        </button>
                      )}
                    </div>
                  )
                })}
              </div>
            )
          })}
        </div>

        <div
          className="px-3.5 py-3 flex justify-end"
          style={{ borderTop: '1px solid var(--color-border-tertiary)' }}
        >
          <button type="button" onClick={onClose} className="ff-btn-secondary">
            Close
          </button>
        </div>
      </div>
    </div>
  )
}

// ── FieldPreviewSidebar ────────────────────────────────────────────────────

// All filtering, searching and pagination is delegated to /api/products. The
// sidebar holds 20 products at a time and steps with Forrige/Næste.

type FilterKey =
  | 'vendor'
  | 'product_type'
  | 'status'
  | 'in_stock'
  | 'tags'
  | 'sku'
  | 'title'
  | 'handle'
  | 'price_gt'
  | 'price_lt'

type FilterDef = {
  key: FilterKey
  label: string
  kind: 'text' | 'number' | 'select'
  placeholder?: string
  options?: { value: string; label: string }[]
  formatChip: (value: string) => string
}

const FILTER_DEFS: FilterDef[] = [
  {
    key: 'vendor',
    label: 'Vendor',
    kind: 'text',
    placeholder: 'e.g. Acme Inc.',
    formatChip: (v) => `Vendor: ${v}`,
  },
  {
    key: 'product_type',
    label: 'Product type',
    kind: 'text',
    placeholder: 'e.g. Wine',
    formatChip: (v) => `Product type: ${v}`,
  },
  {
    key: 'status',
    label: 'Status',
    kind: 'select',
    options: [
      { value: 'active', label: 'Active' },
      { value: 'inactive', label: 'Inactive' },
    ],
    formatChip: (v) => `Status: ${v === 'active' ? 'Active' : 'Inactive'}`,
  },
  {
    key: 'in_stock',
    label: 'Availability',
    kind: 'select',
    options: [
      { value: 'true', label: 'In stock' },
      { value: 'false', label: 'Out of stock' },
    ],
    formatChip: (v) =>
      `Availability: ${v === 'true' ? 'In stock' : 'Out of stock'}`,
  },
  {
    key: 'tags',
    label: 'Tags contain',
    kind: 'text',
    placeholder: 'e.g. vintage',
    formatChip: (v) => `Tags contain: ${v}`,
  },
  {
    key: 'price_gt',
    label: 'Price greater than',
    kind: 'number',
    placeholder: 'e.g. 100',
    formatChip: (v) => `Price > ${v}`,
  },
  {
    key: 'price_lt',
    label: 'Price less than',
    kind: 'number',
    placeholder: 'e.g. 500',
    formatChip: (v) => `Price < ${v}`,
  },
  {
    key: 'sku',
    label: 'SKU contains',
    kind: 'text',
    placeholder: 'e.g. ABC',
    formatChip: (v) => `SKU contains: ${v}`,
  },
  {
    key: 'title',
    label: 'Title contains',
    kind: 'text',
    placeholder: 'e.g. vintage',
    formatChip: (v) => `Title contains: ${v}`,
  },
  {
    key: 'handle',
    label: 'Handle contains',
    kind: 'text',
    placeholder: 'e.g. red-shirt',
    formatChip: (v) => `Handle contains: ${v}`,
  },
]

const SIDEBAR_PAGE_SIZE = 20

function FieldPreviewSidebar({
  field,
  state,
  feedId,
  feedMode,
  marketUrl,
  onClose,
}: {
  field: string
  state: FieldState
  feedId: string
  feedMode: 'product' | 'variant'
  marketUrl: string | null
  onClose: () => void
}) {
  const [search, setSearch] = useState('')
  const [debouncedSearch, setDebouncedSearch] = useState('')
  const [filters, setFilters] = useState<Partial<Record<FilterKey, string>>>({})
  const [products, setProducts] = useState<PreviewProduct[]>([])
  const [total, setTotal] = useState(0)
  const [totalPages, setTotalPages] = useState(1)
  const [page, setPage] = useState(1)
  const [loading, setLoading] = useState(false)

  // 'menu' = filter-type picker open; FilterKey = editing that filter's value.
  const [adding, setAdding] = useState<null | 'menu' | FilterKey>(null)

  // Debounce free-text search → committed query.
  useEffect(() => {
    const t = setTimeout(() => setDebouncedSearch(search.trim()), 300)
    return () => clearTimeout(t)
  }, [search])

  // Reset to page 1 whenever search or filters change so the user doesn't
  // land on an out-of-range page after narrowing.
  const filtersKey = useMemo(() => JSON.stringify(filters), [filters])
  useEffect(() => {
    setPage(1)
  }, [debouncedSearch, filtersKey])

  // Esc closes the panel (when no inline editor is open).
  useEffect(() => {
    function handleKey(e: KeyboardEvent) {
      if (e.key === 'Escape') {
        if (adding) setAdding(null)
        else onClose()
      }
    }
    document.addEventListener('keydown', handleKey)
    return () => document.removeEventListener('keydown', handleKey)
  }, [onClose, adding])

  // Fetch products — server-side search, filter and pagination.
  useEffect(() => {
    let cancelled = false
    setLoading(true)
    const params = new URLSearchParams({
      feedId,
      page: String(page),
      pageSize: String(SIDEBAR_PAGE_SIZE),
    })
    if (debouncedSearch) params.set('search', debouncedSearch)
    for (const [k, v] of Object.entries(filters)) {
      if (v) params.set(k, v)
    }

    fetch(`/api/products?${params.toString()}`)
      .then(async (res) => {
        if (!res.ok) throw new Error(`HTTP ${res.status}`)
        return (await res.json()) as {
          products?: PreviewProduct[]
          total?: number
          totalPages?: number
        }
      })
      .then((data) => {
        if (cancelled) return
        setProducts(data.products ?? [])
        setTotal(data.total ?? 0)
        setTotalPages(Math.max(1, data.totalPages ?? 1))
      })
      .catch(() => {
        if (!cancelled) {
          setProducts([])
          setTotal(0)
          setTotalPages(1)
        }
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })

    return () => {
      cancelled = true
    }
  }, [feedId, debouncedSearch, filters, page])

  function applyFilter(key: FilterKey, value: string) {
    if (!value) return
    setFilters((prev) => ({ ...prev, [key]: value }))
    setAdding(null)
  }
  function removeFilter(key: FilterKey) {
    setFilters((prev) => {
      const { [key]: _removed, ...rest } = prev
      return rest
    })
  }

  const hasMapping = state.type !== ''

  let mappingLabel = 'No mapping'
  if (state.type === 'FIELD') mappingLabel = `FIELD → ${(state.config.field as string) ?? ''}`
  else if (state.type === 'STATIC')
    mappingLabel = `STATIC → "${(state.config.value as string) ?? ''}"`
  else if (state.type) mappingLabel = state.type

  const displayField = field.startsWith('custom:') ? field.slice('custom:'.length) : field

  const activeFilterEntries = Object.entries(filters).filter(([, v]) => v) as [
    FilterKey,
    string,
  ][]
  const availableForAdding = FILTER_DEFS.filter((d) => !filters[d.key])

  return (
    <>
      <div
        className="fixed inset-0 z-40"
        style={{ background: 'rgba(0,0,0,0.3)' }}
        onClick={onClose}
      />
      <aside
        className="fixed top-0 right-0 z-50 h-screen flex flex-col"
        style={{
          width: '380px',
          background: '#ffffff',
          borderLeft: '1px solid var(--color-border-tertiary)',
          boxShadow: '-2px 0 12px rgba(0,0,0,0.06)',
        }}
      >
        {/* Header */}
        <div
          className="px-3.5 py-3 flex items-start justify-between gap-2"
          style={{ borderBottom: '1px solid var(--color-border-tertiary)' }}
        >
          <div className="min-w-0">
            <code
              className="ff-mono"
              style={{ fontSize: '13px', fontWeight: 600, color: 'var(--color-text-primary)' }}
            >
              {displayField}
            </code>
            <p
              className="mt-0.5"
              style={{ fontSize: '11px', color: 'var(--color-text-tertiary)' }}
            >
              {mappingLabel}
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close preview"
            style={{
              fontSize: '18px',
              lineHeight: 1,
              color: 'var(--color-text-tertiary)',
              background: 'transparent',
              border: 'none',
              cursor: 'pointer',
              padding: '2px 6px',
            }}
          >
            ×
          </button>
        </div>

        {/* Search + active filter chips + add-filter UI */}
        <div
          className="px-3.5 py-3 space-y-2"
          style={{ borderBottom: '1px solid var(--color-border-tertiary)' }}
        >
          <input
            type="search"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search title, vendor, handle, tags…"
            className={inp}
          />

          {activeFilterEntries.length > 0 && (
            <div className="flex flex-wrap gap-1.5">
              {activeFilterEntries.map(([key, value]) => {
                const def = FILTER_DEFS.find((d) => d.key === key)
                if (!def) return null
                return (
                  <span
                    key={key}
                    className="ff-badge ff-badge-accent"
                    style={{ display: 'inline-flex', alignItems: 'center', gap: '4px' }}
                  >
                    <span>{def.formatChip(value)}</span>
                    <button
                      type="button"
                      onClick={() => removeFilter(key)}
                      aria-label={`Remove filter ${def.label}`}
                      style={{
                        background: 'transparent',
                        border: 'none',
                        color: 'inherit',
                        cursor: 'pointer',
                        padding: 0,
                        fontSize: '12px',
                        lineHeight: 1,
                        opacity: 0.7,
                      }}
                    >
                      ×
                    </button>
                  </span>
                )
              })}
            </div>
          )}

          {adding === null && availableForAdding.length > 0 && (
            <button
              type="button"
              onClick={() => setAdding('menu')}
              className="ff-btn-secondary"
              style={{ fontSize: '11px' }}
            >
              ＋ Add filter
            </button>
          )}

          {adding === 'menu' && (
            <div
              className="ff-panel"
              style={{
                background: '#ffffff',
                border: '1px solid var(--color-border-secondary)',
                borderRadius: '6px',
                maxHeight: '220px',
                overflowY: 'auto',
              }}
            >
              {availableForAdding.map((def) => (
                <button
                  key={def.key}
                  type="button"
                  onClick={() => setAdding(def.key)}
                  style={{
                    display: 'block',
                    width: '100%',
                    textAlign: 'left',
                    padding: '6px 10px',
                    fontSize: '11px',
                    background: 'transparent',
                    border: 'none',
                    cursor: 'pointer',
                    color: 'var(--color-text-primary)',
                  }}
                  onMouseEnter={(e) => {
                    e.currentTarget.style.background = 'var(--color-background-secondary)'
                  }}
                  onMouseLeave={(e) => {
                    e.currentTarget.style.background = 'transparent'
                  }}
                >
                  {def.label}
                </button>
              ))}
            </div>
          )}

          {adding && adding !== 'menu' && (
            <FilterValueEditor
              def={FILTER_DEFS.find((d) => d.key === adding)!}
              onConfirm={(value) => applyFilter(adding, value)}
              onCancel={() => setAdding(null)}
            />
          )}
        </div>

        {/* Result count */}
        <div
          className="px-3.5 py-2"
          style={{
            background: 'var(--color-background-tertiary)',
            borderBottom: '1px solid var(--color-border-tertiary)',
            fontSize: '11px',
            color: 'var(--color-text-tertiary)',
          }}
        >
          {loading && products.length === 0
            ? 'Loading…'
            : `${total} products · page ${page} of ${totalPages}`}
        </div>

        {/* List */}
        <div style={{ overflowY: 'auto', flex: 1, opacity: loading ? 0.6 : 1 }}>
          {products.length === 0 && !loading ? (
            <p
              className="px-3.5 py-6 text-center"
              style={{ fontSize: '11px', color: 'var(--color-text-tertiary)' }}
            >
              No products match
            </p>
          ) : (
            products.map((p) => {
              const value = hasMapping
                ? computePreviewValue(state, p, marketUrl, feedMode)
                : ''
              return (
                <div
                  key={p.id}
                  className="px-3.5 py-2.5 flex items-start gap-3"
                  style={{ borderBottom: '1px solid var(--color-border-tertiary)' }}
                >
                  <div className="flex-1 min-w-0">
                    <p
                      className="truncate"
                      style={{ fontSize: '12px', color: 'var(--color-text-primary)' }}
                      title={p.title}
                    >
                      {p.title || '—'}
                    </p>
                    <p
                      className="ff-mono mt-0.5 truncate"
                      style={{ fontSize: '10px', color: 'var(--color-text-tertiary)' }}
                    >
                      {p.handle}
                    </p>
                  </div>
                  <div
                    className="ff-mono shrink-0 text-right"
                    style={{
                      fontSize: '11px',
                      maxWidth: '160px',
                      wordBreak: 'break-all',
                    }}
                  >
                    {value === '' ? (
                      <span
                        style={{
                          color: 'var(--color-text-tertiary)',
                          fontStyle: 'italic',
                        }}
                      >
                        —
                      </span>
                    ) : value === '__AI__' ? (
                      <span className="ff-badge ff-badge-accent">AI</span>
                    ) : (
                      <span style={{ color: 'var(--color-accent)' }}>{value}</span>
                    )}
                  </div>
                </div>
              )
            })
          )}
        </div>

        {/* Pagination */}
        <div
          className="px-3.5 py-2.5 flex items-center justify-between gap-2"
          style={{ borderTop: '1px solid var(--color-border-tertiary)' }}
        >
          <button
            type="button"
            onClick={() => setPage((p) => Math.max(1, p - 1))}
            disabled={loading || page <= 1}
            className="ff-btn-secondary"
          >
            Previous
          </button>
          <span style={{ fontSize: '11px', color: 'var(--color-text-tertiary)' }}>
            Page {page} of {totalPages}
          </span>
          <button
            type="button"
            onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
            disabled={loading || page >= totalPages}
            className="ff-btn-secondary"
          >
            Next
          </button>
        </div>
      </aside>
    </>
  )
}

function FilterValueEditor({
  def,
  onConfirm,
  onCancel,
}: {
  def: FilterDef
  onConfirm: (value: string) => void
  onCancel: () => void
}) {
  const [value, setValue] = useState('')

  function tryConfirm() {
    const v = value.trim()
    if (!v) return
    onConfirm(v)
  }

  return (
    <div
      className="flex flex-wrap items-center gap-2 p-2"
      style={{
        background: 'var(--color-background-tertiary)',
        border: '1px solid var(--color-border-tertiary)',
        borderRadius: '6px',
      }}
    >
      <span
        style={{
          fontSize: '11px',
          fontWeight: 500,
          color: 'var(--color-text-secondary)',
          flexShrink: 0,
        }}
      >
        {def.label}
      </span>
      {def.kind === 'select' ? (
        <select
          autoFocus
          value={value}
          onChange={(e) => setValue(e.target.value)}
          className={sel}
          style={{ flex: '1 1 120px', minWidth: 0 }}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.preventDefault()
              tryConfirm()
            }
          }}
        >
          <option value="">— Select —</option>
          {def.options?.map((o) => (
            <option key={o.value} value={o.value}>
              {o.label}
            </option>
          ))}
        </select>
      ) : (
        <input
          type={def.kind === 'number' ? 'number' : 'text'}
          autoFocus
          value={value}
          onChange={(e) => setValue(e.target.value)}
          placeholder={def.placeholder}
          className={inp}
          style={{ flex: '1 1 120px', minWidth: 0 }}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.preventDefault()
              tryConfirm()
            } else if (e.key === 'Escape') {
              e.preventDefault()
              onCancel()
            }
          }}
        />
      )}
      <button
        type="button"
        onClick={tryConfirm}
        disabled={!value.trim()}
        className="ff-btn-primary"
      >
        Add
      </button>
      <button type="button" onClick={onCancel} className="ff-btn-secondary">
        Cancel
      </button>
    </div>
  )
}

// ── Main component ─────────────────────────────────────────────────────────

type InitialMapping = {
  google_field: string
  mapping_type: string
  config: Config
}

export default function MappingClient({
  feedId,
  feedName,
  feedMode,
  initialMappings,
  metafields,
}: {
  feedId: string
  feedName: string
  feedMode: 'product' | 'variant'
  initialMappings: InitialMapping[]
  metafields: { namespace: string; key: string }[]
}) {
  const [mappings, setMappings] = useState<Record<string, FieldState>>(() => {
    const init: Record<string, FieldState> = {}
    for (const f of ALL_FIELDS) init[f] = { type: '', config: {} }
    for (const m of initialMappings) {
      const isCustom = m.google_field.startsWith('custom:')
      // Accept Google fields we know about plus any custom field. Unknown
      // Google-namespace fields are skipped (legacy data).
      if (!isCustom && !ALL_FIELDS.includes(m.google_field)) continue
      let cfg: Config = {}
      try {
        const raw = m.config
        cfg = (typeof raw === 'string' ? JSON.parse(raw) : raw ?? {}) as Config
      } catch {
        console.warn(`Kunne ikke parse config for ${m.google_field}:`, m.config)
      }
      init[m.google_field] = { type: m.mapping_type as MappingType, config: cfg }
    }
    return init
  })

  // Custom user-defined fields (stored with "custom:" prefix in the DB).
  // Auto-seeded from initialMappings so saved custom fields show up on next
  // load. removedCustomFields holds keys that the user has × deleted in this
  // session — they're sent with empty mapping_type on save so the DB row
  // disappears, then cleared on success.
  const [customFields, setCustomFields] = useState<string[]>(() => {
    const set = new Set<string>()
    for (const m of initialMappings) {
      if (m.google_field.startsWith('custom:') && m.mapping_type !== '') {
        set.add(m.google_field)
      }
    }
    return Array.from(set)
  })
  const [removedCustomFields, setRemovedCustomFields] = useState<string[]>([])

  function addCustomField(rawName: string): string | null {
    const trimmed = rawName.trim()
    if (!trimmed) return 'Field name cannot be empty'
    if (!/^[a-zA-Z0-9_]+$/.test(trimmed)) {
      return 'Only letters, digits and underscore allowed — no spaces or special characters'
    }
    const fullKey = `custom:${trimmed}`
    if (customFields.includes(fullKey)) return 'Field already exists'
    setCustomFields((prev) => [...prev, fullKey])
    setMappings((prev) => ({ ...prev, [fullKey]: { type: '', config: {} } }))
    setRemovedCustomFields((prev) => prev.filter((f) => f !== fullKey))
    return null
  }

  function removeCustomField(field: string) {
    setCustomFields((prev) => prev.filter((f) => f !== field))
    setRemovedCustomFields((prev) => (prev.includes(field) ? prev : [...prev, field]))
  }

  const [isPending, startTransition] = useTransition()
  const [status, setStatus] = useState<'idle' | 'saved' | 'error'>('idle')
  const [errorMsg, setErrorMsg] = useState('')

  // ── Section / "added fields" state ──────────────────────────────────────
  // Advanced fields the user has explicitly surfaced via the "+ Tilføj felt"
  // modal. Seeded from initialMappings so a saved-but-advanced mapping shows
  // up automatically on next load.
  const [addedFields, setAddedFields] = useState<string[]>(() => {
    const seen = new Set<string>()
    for (const m of initialMappings) {
      if (m.mapping_type !== '' && ADVANCED_FIELDS.includes(m.google_field)) {
        seen.add(m.google_field)
      }
    }
    return Array.from(seen)
  })

  // Collapsible-section open state. Auto-opens any section that contains a
  // field with a saved mapping; otherwise the section starts collapsed.
  const [openSections, setOpenSections] = useState<Set<string>>(() => {
    const mappedSet = new Set(
      initialMappings.filter((m) => m.mapping_type !== '').map((m) => m.google_field)
    )
    const open = new Set<string>()
    for (const section of COLLAPSIBLE_SECTIONS) {
      if (section.fields.some((f) => mappedSet.has(f))) open.add(section.title)
    }
    return open
  })

  const [showAddFieldModal, setShowAddFieldModal] = useState(false)

  // Field preview sidebar — set to a Google field name when the user clicks
  // the hover "Preview" button on a row; null when the sidebar is closed.
  const [previewSidebarField, setPreviewSidebarField] = useState<string | null>(null)

  function toggleSection(title: string) {
    setOpenSections((prev) => {
      const next = new Set(prev)
      if (next.has(title)) next.delete(title)
      else next.add(title)
      return next
    })
  }

  function addField(field: string) {
    setAddedFields((prev) => (prev.includes(field) ? prev : [...prev, field]))
  }

  function removeAddedField(field: string) {
    setAddedFields((prev) => prev.filter((f) => f !== field))
    // Also clear the saved mapping so the next save deletes it from the DB.
    setMappings((prev) => ({ ...prev, [field]: { type: '', config: {} } }))
  }

  // ── AI auto-mapping state ────────────────────────────────────────────────
  const [isFetchingAI, setIsFetchingAI] = useState(false)
  const [aiError, setAIError] = useState<string | null>(null)
  const [aiSuggestions, setAISuggestions] = useState<AISuggestion[] | null>(null)
  const [showAIModal, setShowAIModal] = useState(false)

  async function fetchAISuggestions() {
    setIsFetchingAI(true)
    setAIError(null)
    try {
      // Live mappings — includes the user's unsaved edits. Only the active
      // (non-empty mapping_type) entries are sent so the AI knows which
      // fields are off-limits.
      const existingMappings = Object.entries(mappings)
        .filter(([, state]) => state.type !== '')
        .map(([field, state]) => ({
          google_field: field,
          mapping_type: state.type,
          config: state.config,
        }))
      const mappedSet = new Set(existingMappings.map((m) => m.google_field))

      const res = await fetch(
        `/api/mapping/ai-suggest?feedId=${encodeURIComponent(feedId)}`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ existingMappings }),
        }
      )
      const data = (await res.json()) as { suggestions?: AISuggestion[]; error?: string }
      if (data.error) throw new Error(data.error)

      // Defense in depth: drop suggestions for fields already mapped, even if
      // the route filter missed something.
      const filtered = (data.suggestions ?? []).filter((s) => !mappedSet.has(s.google_field))
      setAISuggestions(filtered)
      setShowAIModal(true)
    } catch (err) {
      setAIError(err instanceof Error ? err.message : 'AI analysis failed')
    } finally {
      setIsFetchingAI(false)
    }
  }

  function applySuggestions(selectedFields: string[]) {
    setMappings((prev) => {
      const next = { ...prev }
      for (const googleField of selectedFields) {
        const s = aiSuggestions!.find((x) => x.google_field === googleField)
        if (!s || !ALL_FIELDS.includes(s.google_field)) continue
        if (s.mapping_type === 'static' && s.static_value !== undefined) {
          next[s.google_field] = { type: 'STATIC', config: { value: s.static_value } }
        } else if (s.mapping_type === 'field' && s.shopify_field) {
          next[s.google_field] = { type: 'FIELD', config: { field: s.shopify_field } }
        }
      }
      return next
    })
    setShowAIModal(false)
    setAISuggestions(null)
    if (status !== 'idle') setStatus('idle')
  }

  // ── Preview state ────────────────────────────────────────────────────────
  const [previewProduct, setPreviewProduct] = useState<PreviewProduct | null>(null)
  const [showPicker, setShowPicker] = useState(false)
  const [showFieldsModal, setShowFieldsModal] = useState(false)
  const [allProducts, setAllProducts] = useState<PreviewProduct[]>([])
  const [loadingProducts, setLoadingProducts] = useState(false)
  const [marketUrl, setMarketUrlState] = useState<string | null>(null)

  useEffect(() => {
    fetch(`/api/settings?feedId=${encodeURIComponent(feedId)}`)
      .then((r) => r.json())
      .then((data: { settings?: { market_url?: string | null } | null }) => {
        setMarketUrlState(data.settings?.market_url ?? null)
      })
      .catch(() => {})
  }, [feedId])

  async function ensureProducts() {
    if (allProducts.length > 0 || loadingProducts) return
    setLoadingProducts(true)
    try {
      const res = await fetch(`/api/products?feedId=${encodeURIComponent(feedId)}`)
      const data = await res.json() as { products: PreviewProduct[] }
      setAllProducts(data.products ?? [])
    } catch {
      // silently fail — user sees empty list
    } finally {
      setLoadingProducts(false)
    }
  }

  function openPicker() {
    setShowPicker(true)
    void ensureProducts()
  }

  function openFieldsModal() {
    setShowFieldsModal(true)
    void ensureProducts()
  }

  // Compute preview values for all fields whenever mappings or selected product change
  const previewValues = useMemo<Record<string, string | null>>(() => {
    if (!previewProduct) return {}
    const result: Record<string, string | null> = {}
    const fieldsToPreview = [...ALL_FIELDS, ...customFields]
    for (const field of fieldsToPreview) {
      const state = mappings[field]
      result[field] = state?.type
        ? computePreviewValue(state, previewProduct, marketUrl, feedMode)
        : null
    }
    return result
  }, [mappings, previewProduct, marketUrl, feedMode, customFields])

  // ── Field helpers ────────────────────────────────────────────────────────
  const allFields: string[] = [
    ...STANDARD_FIELDS,
    ...metafields.map((m) => `metafield:${m.namespace}.${m.key}`),
  ]

  // Visible fields = required + collapsible + user-added advanced fields +
  // custom user-defined fields. The topbar denominator reflects what the
  // user can see in the UI, not every field ALL_FIELDS could in theory contain.
  const visibleFields = [...REQUIRED_FIELDS, ...COLLAPSIBLE_FIELDS, ...addedFields, ...customFields]
  const mappedCount = visibleFields.filter((f) => mappings[f]?.type !== '' && mappings[f]?.type).length
  const totalVisibleFields = visibleFields.length

  // Set of all Shopify fields referenced by at least one active mapping —
  // recomputed when mappings change. Drives the "Mappet"/"Ikke mappet" badges
  // in the Shopify-felter panel.
  const usedFieldsSet = useMemo(() => {
    const s = new Set<string>()
    for (const state of Object.values(mappings)) {
      if (!state.type) continue
      for (const f of collectUsedFields(state)) s.add(f)
    }
    return s
  }, [mappings])

  const fieldsModalProduct = previewProduct ?? allProducts[0] ?? null

  function updateType(field: string, type: MappingType) {
    setMappings((prev) => {
      const existing = prev[field]
      const onlyIf = existing?.config?.onlyIf
      return { ...prev, [field]: { type, config: onlyIf ? { onlyIf } : {} } }
    })
    if (status !== 'idle') setStatus('idle')
  }

  function updateConfig(field: string, config: Config) {
    setMappings((prev) => ({ ...prev, [field]: { ...prev[field], config } }))
  }

  function handleSave() {
    startTransition(async () => {
      const entries: MappingEntry[] = [
        ...ALL_FIELDS.map((f) => ({
          google_field: f,
          mapping_type: mappings[f]?.type ?? '',
          config: mappings[f]?.config ?? {},
        })),
        ...customFields.map((f) => ({
          google_field: f,
          mapping_type: mappings[f]?.type ?? '',
          config: mappings[f]?.config ?? {},
        })),
        // × deleted custom fields — sent with empty mapping_type so saveMappings
        // deletes the existing DB row.
        ...removedCustomFields.map((f) => ({
          google_field: f,
          mapping_type: '',
          config: {},
        })),
      ]
      const result = await saveMappings(feedId, entries)
      if (result.error) {
        setErrorMsg(result.error)
        setStatus('error')
      } else {
        setStatus('saved')
        setRemovedCustomFields([])
        setTimeout(() => setStatus('idle'), 2500)
      }
    })
  }

  return (
    <FeedModeContext.Provider value={feedMode}>
    <div className="min-h-screen">
      <header className="ff-topbar">
        <div className="flex items-center gap-3">
          <h1 className="ff-topbar-title">{feedName} · Mapping</h1>
          <span style={{ fontSize: '11px', color: 'var(--color-text-tertiary)' }}>
            {mappedCount} of {totalVisibleFields} mapped
          </span>
        </div>
        <div className="flex items-center gap-2 flex-wrap justify-end">
          <button onClick={openFieldsModal} className="ff-btn-secondary">
            <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M3.75 6.75h16.5M3.75 12h16.5M3.75 17.25h16.5" />
            </svg>
            Shopify fields
          </button>

          {aiError && (
            <span className="max-w-40 truncate" style={{ fontSize: '11px', color: 'var(--color-badge-danger-text)' }}>{aiError}</span>
          )}
          <button onClick={fetchAISuggestions} disabled={isFetchingAI} className="ff-btn-secondary">
            {isFetchingAI ? (
              <>
                <svg className="w-3.5 h-3.5 animate-spin" fill="none" viewBox="0 0 24 24">
                  <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                  <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8H4z" />
                </svg>
                AI analyzing…
              </>
            ) : (
              <>
                <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M9.813 15.904L9 18.75l-.813-2.846a4.5 4.5 0 00-3.09-3.09L2.25 12l2.846-.813a4.5 4.5 0 003.09-3.09L9 5.25l.813 2.846a4.5 4.5 0 003.09 3.09L15.75 12l-2.846.813a4.5 4.5 0 00-3.09 3.09z" />
                </svg>
                Auto-map with AI
              </>
            )}
          </button>

          {previewProduct ? (
            <div
              className="flex items-center gap-2 px-2 py-1"
              style={{
                background: 'var(--color-badge-accent-bg)',
                borderRadius: '3px',
              }}
            >
              {(previewProduct.images[0]?.src as string | undefined) && (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  src={previewProduct.images[0].src as string}
                  alt=""
                  className="w-4 h-4 object-cover shrink-0"
                  style={{ borderRadius: '2px' }}
                />
              )}
              <span
                className="max-w-40 truncate"
                style={{ fontSize: '11px', fontWeight: 500, color: 'var(--color-badge-accent-text)' }}
              >
                {previewProduct.title}
              </span>
              <button
                onClick={() => setPreviewProduct(null)}
                style={{ color: 'var(--color-badge-accent-text)', fontSize: '14px', lineHeight: 1 }}
                aria-label="Remove preview product"
              >
                ×
              </button>
            </div>
          ) : (
            <button onClick={openPicker} className="ff-btn-secondary">
              <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z" />
                <circle cx="12" cy="12" r="3" />
              </svg>
              Preview product
            </button>
          )}

          {status === 'saved' && (
            <span style={{ fontSize: '11px', fontWeight: 500, color: 'var(--color-badge-success-text)' }}>
              Saved
            </span>
          )}
          {status === 'error' && (
            <span style={{ fontSize: '11px', color: 'var(--color-badge-danger-text)' }}>{errorMsg}</span>
          )}
          <button onClick={handleSave} disabled={isPending} className="ff-btn-primary">
            {isPending ? 'Saving…' : 'Save mapping'}
          </button>
        </div>
      </header>

      <main className="px-4 py-4 max-w-6xl space-y-3">
        {/* Required — always visible, never collapsed */}
        <SectionPanel
          title="Required"
          fields={[...REQUIRED_FIELDS]}
          mappings={mappings}
          allFields={allFields}
          onTypeChange={updateType}
          onConfigChange={updateConfig}
          previewProduct={previewProduct}
          previewValues={previewValues}
          onPreview={setPreviewSidebarField}
        />

        {/* Collapsible sections */}
        {COLLAPSIBLE_SECTIONS.map((section) => (
          <SectionPanel
            key={section.title}
            title={section.title}
            fields={section.fields}
            mappings={mappings}
            allFields={allFields}
            onTypeChange={updateType}
            onConfigChange={updateConfig}
            previewProduct={previewProduct}
            previewValues={previewValues}
            onPreview={setPreviewSidebarField}
            collapsible
            open={openSections.has(section.title)}
            onToggle={() => toggleSection(section.title)}
          />
        ))}

        {/* User-added advanced fields */}
        {addedFields.length > 0 && (
          <SectionPanel
            title="Added fields"
            fields={addedFields}
            mappings={mappings}
            allFields={allFields}
            onTypeChange={updateType}
            onConfigChange={updateConfig}
            previewProduct={previewProduct}
            previewValues={previewValues}
            onPreview={setPreviewSidebarField}
          />
        )}

        {/* + Tilføj felt */}
        <div className="flex justify-center pt-2">
          <button
            type="button"
            onClick={() => setShowAddFieldModal(true)}
            className="ff-btn-secondary"
          >
            ＋ Add field
          </button>
        </div>

        {/* Custom (non-Google) fields — always rendered, sits at the bottom */}
        <CustomFieldsSection
          customFields={customFields}
          mappings={mappings}
          allFields={allFields}
          onTypeChange={updateType}
          onConfigChange={updateConfig}
          previewProduct={previewProduct}
          previewValues={previewValues}
          onAdd={addCustomField}
          onRemove={removeCustomField}
          onPreview={setPreviewSidebarField}
        />
      </main>

      {showPicker && (
        <ProductPickerModal
          feedId={feedId}
          onSelect={(p) => {
            setPreviewProduct(p)
            setShowPicker(false)
          }}
          onClose={() => setShowPicker(false)}
        />
      )}

      {showAIModal && aiSuggestions && (
        <AISuggestionsModal
          suggestions={aiSuggestions}
          currentMappings={mappings}
          onApply={applySuggestions}
          onClose={() => setShowAIModal(false)}
        />
      )}

      {showFieldsModal && (
        <ShopifyFieldsModal
          standardFields={STANDARD_FIELDS}
          metafields={metafields}
          product={fieldsModalProduct}
          loading={loadingProducts}
          marketUrl={marketUrl}
          usedFields={usedFieldsSet}
          onClose={() => setShowFieldsModal(false)}
        />
      )}

      {showAddFieldModal && (
        <AddFieldModal
          addedFields={addedFields}
          onAdd={addField}
          onRemove={removeAddedField}
          onClose={() => setShowAddFieldModal(false)}
        />
      )}

      {previewSidebarField && (
        <FieldPreviewSidebar
          field={previewSidebarField}
          state={mappings[previewSidebarField] ?? { type: '', config: {} }}
          feedId={feedId}
          feedMode={feedMode}
          marketUrl={marketUrl}
          onClose={() => setPreviewSidebarField(null)}
        />
      )}
    </div>
    </FeedModeContext.Provider>
  )
}
