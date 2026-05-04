import { createClient } from '@supabase/supabase-js'
import Anthropic from '@anthropic-ai/sdk'
import type { SupabaseProduct } from '@/lib/sync'

// ── Types ──────────────────────────────────────────────────────────────────

type MappingType =
  | 'FIELD'
  | 'STATIC'
  | 'COMBINE'
  | 'PREFIX_SUFFIX'
  | 'FIND_REPLACE'
  | 'TRUNCATE'
  | 'STRIP_HTML'
  | 'AI'

type Config = Record<string, unknown>
type CombineBlock = { type: 'field' | 'text'; value: string }
type FindReplacePair = { find: string; replace: string }
type Condition = { field: string; operator: string; value: string; logic: 'AND' | 'OR' | null }
// ELSE branch supports four shapes. `empty` / `static` / `field` use `value`;
// `combine` reuses the same block list as a top-level COMBINE mapping.
type ElseBranch =
  | { type: 'empty' | 'static' | 'field'; value: string }
  | { type: 'combine'; blocks: CombineBlock[] }
type OnlyIf = { conditions: Condition[]; else: ElseBranch }

type FeedMapping = {
  google_field: string
  mapping_type: MappingType
  config: Config
}

type FeedFilterRule = { field: string; operator: string; value: string }

type FeedFilter = {
  filter_type: 'include' | 'exclude'
  operator: 'AND' | 'OR'
  rules: FeedFilterRule[]
}

type StoredVariant = {
  id: number
  title: string
  price: string | null
  sku: string | null
  compare_at_price: string | null
  option1: string | null
  option2: string | null
  option3: string | null
  barcode: string | null
  inventory_quantity: number | null
}

export type FeedResult = {
  xml: string
  productCount: number
}

// ── Helpers ────────────────────────────────────────────────────────────────

function adminClient() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  )
}

function xmlEscape(str: string): string {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;')
}

// Builds a product URL using the selected market's rootUrl when available.
// `marketUrl` may be a subdomain (https://shop.fr) or a subfolder (https://shop.com/fr) —
// in both cases we strip a trailing slash and append /products/<handle>.
function buildProductUrl(handle: string | null | undefined, marketUrl: string | null): string {
  if (!handle) return ''
  if (marketUrl) {
    return `${marketUrl.replace(/\/+$/, '')}/products/${handle}`
  }
  const domain = process.env.SHOP_DOMAIN ?? process.env.SHOPIFY_SHOP_URL ?? ''
  return domain ? `https://${domain}/products/${handle}` : ''
}

function resolveField(field: string, product: SupabaseProduct, marketUrl: string | null): string {
  if (!field) return ''

  if (field === 'url') {
    return buildProductUrl(product.handle, marketUrl)
  }

  // item_group_id is the source-field name shown in the dropdown for the
  // product's Shopify ID. shopify_id is kept as a back-compat alias for
  // mappings saved before the rename.
  if (field === 'item_group_id' || field === 'shopify_id') {
    return product.shopify_id ? String(product.shopify_id) : ''
  }

  if (field.startsWith('metafield:')) {
    const rest = field.slice('metafield:'.length)
    const dot = rest.indexOf('.')
    if (dot === -1) return ''
    const namespace = rest.slice(0, dot)
    const key = rest.slice(dot + 1)
    return product.metafields.find((m) => m.namespace === namespace && m.key === key)?.value ?? ''
  }

  const variantMatch = field.match(/^variants\[(\d+)\]\.(.+)$/)
  if (variantMatch) {
    const variants = product.variants as Record<string, unknown>[]
    return String(variants?.[+variantMatch[1]]?.[variantMatch[2]] ?? '')
  }

  const imageMatch = field.match(/^images\[(\d+)\]\.(.+)$/)
  if (imageMatch) {
    const images = product.images as Record<string, unknown>[]
    return String(images?.[+imageMatch[1]]?.[imageMatch[2]] ?? '')
  }

  const val = (product as Record<string, unknown>)[field]
  if (val === null || val === undefined) return ''
  if (typeof val === 'object') return JSON.stringify(val)
  return String(val)
}

function stripHtml(html: string): string {
  return html.replace(/<[^>]*>/g, '').replace(/\s+/g, ' ').trim()
}

function evalCond(cond: Condition, product: SupabaseProduct, marketUrl: string | null): boolean {
  const v = resolveField(cond.field, product, marketUrl)
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
    // *_field variants resolve the RHS as a field reference instead of a
    // literal — used by default mappings that compare two product fields
    // (e.g. price < compare_at_price for sale detection).
    case 'less_than_field':    return parseFloat(v) < parseFloat(resolveField(cond.value, product, marketUrl))
    case 'greater_than_field': return parseFloat(v) > parseFloat(resolveField(cond.value, product, marketUrl))
    case 'equals_field':       return v === resolveField(cond.value, product, marketUrl)
    case 'not_equals_field':   return v !== resolveField(cond.value, product, marketUrl)
    default:             return true
  }
}

function evaluateOnlyIf(onlyIf: OnlyIf, product: SupabaseProduct, marketUrl: string | null): boolean {
  const { conditions } = onlyIf
  if (!conditions.length) return true
  let result = evalCond(conditions[0], product, marketUrl)
  for (let i = 1; i < conditions.length; i++) {
    const val = evalCond(conditions[i], product, marketUrl)
    result = conditions[i].logic === 'OR' ? result || val : result && val
  }
  return result
}

async function applyMapping(
  type: MappingType,
  config: Config,
  product: SupabaseProduct,
  anthropic: Anthropic | null,
  marketUrl: string | null
): Promise<string> {
  switch (type) {
    case 'FIELD':
      return resolveField(String(config.field ?? ''), product, marketUrl)

    case 'STATIC':
      return String(config.value ?? '')

    case 'COMBINE': {
      const blocks = (config.blocks as CombineBlock[]) ?? []
      return blocks
        .map((b) => (b.type === 'field' ? resolveField(b.value, product, marketUrl) : b.value))
        .join('')
    }

    case 'PREFIX_SUFFIX': {
      const val = resolveField(String(config.field ?? ''), product, marketUrl)
      if (!val) return ''
      return `${config.prefix ?? ''}${val}${config.suffix ?? ''}`
    }

    case 'FIND_REPLACE': {
      let val = resolveField(String(config.field ?? ''), product, marketUrl)
      for (const pair of (config.pairs as FindReplacePair[]) ?? []) {
        if (pair.find) val = val.split(pair.find).join(pair.replace)
      }
      return val
    }

    case 'TRUNCATE': {
      const val = resolveField(String(config.field ?? ''), product, marketUrl)
      return val.slice(0, Number(config.maxChars ?? 500))
    }

    case 'STRIP_HTML':
      return stripHtml(resolveField(String(config.field ?? ''), product, marketUrl))

    case 'AI': {
      if (!anthropic) return ''
      const prompt = String(config.prompt ?? '')
      if (!prompt) return ''
      const productData = {
        id: product.shopify_id,
        title: product.title,
        vendor: product.vendor,
        product_type: product.product_type,
        tags: product.tags,
        status: product.status,
        variants: product.variants,
        metafields: product.metafields.map((m) => ({
          key: `${m.namespace}.${m.key}`,
          value: m.value,
        })),
      }
      const msg = await anthropic.messages.create({
        model: 'claude-haiku-4-5-20251001',
        max_tokens: 500,
        messages: [
          {
            role: 'user',
            content: `${prompt}\n\nProduktdata:\n${JSON.stringify(productData, null, 2)}`,
          },
        ],
      })
      const block = msg.content[0]
      return block.type === 'text' ? block.text.trim() : ''
    }

    default:
      return ''
  }
}

// Applies a mapping rule and its onlyIf condition, returning the resolved value.
async function resolvedValue(
  mapping: FeedMapping,
  product: SupabaseProduct,
  anthropic: Anthropic | null,
  marketUrl: string | null
): Promise<string> {
  let value = await applyMapping(mapping.mapping_type, mapping.config, product, anthropic, marketUrl)

  const onlyIf = mapping.config.onlyIf as OnlyIf | undefined
  if (onlyIf?.conditions?.length) {
    const conditionMet = evaluateOnlyIf(onlyIf, product, marketUrl)
    if (!conditionMet) {
      const eb = onlyIf.else
      if (eb.type === 'static') value = eb.value
      else if (eb.type === 'field') value = resolveField(eb.value, product, marketUrl)
      else if (eb.type === 'combine') {
        value = (eb.blocks ?? [])
          .map((b) => (b.type === 'field' ? resolveField(b.value, product, marketUrl) : b.value))
          .join('')
      } else {
        value = ''
      }
    }
  }

  return value
}

function evalFilterRule(rule: FeedFilterRule, product: SupabaseProduct, marketUrl: string | null): boolean {
  if (rule.field === 'collections') {
    const cols = (product.collections as string[] | null | undefined) ?? []
    switch (rule.operator) {
      case 'contains':
      case 'equals': return cols.includes(rule.value)
      case 'does_not_contain':
      case 'not_equals': return !cols.includes(rule.value)
      case 'is_empty': return cols.length === 0
      case 'is_not_empty': return cols.length > 0
      default: return true
    }
  }
  const v = resolveField(rule.field, product, marketUrl)
  switch (rule.operator) {
    case 'contains': return v.includes(rule.value)
    case 'does_not_contain': return !v.includes(rule.value)
    case 'equals': return v === rule.value
    case 'not_equals': return v !== rule.value
    case 'starts_with': return v.startsWith(rule.value)
    case 'ends_with': return v.endsWith(rule.value)
    case 'is_empty': return !v
    case 'is_not_empty': return !!v
    case 'greater_than': return parseFloat(v) > parseFloat(rule.value)
    case 'less_than': return parseFloat(v) < parseFloat(rule.value)
    default: return true
  }
}

const NO_VALUE_OPS = new Set(['is_empty', 'is_not_empty'])

function matchesFilter(product: SupabaseProduct, filter: FeedFilter, marketUrl: string | null): boolean {
  const { operator } = filter
  const activeRules = filter.rules.filter((r) => NO_VALUE_OPS.has(r.operator) || r.value !== '')
  if (!activeRules.length) return true
  let result = evalFilterRule(activeRules[0], product, marketUrl)
  for (let i = 1; i < activeRules.length; i++) {
    const val = evalFilterRule(activeRules[i], product, marketUrl)
    result = operator === 'OR' ? result || val : result && val
  }
  return result
}

function applyFeedFilters(
  products: SupabaseProduct[],
  filters: FeedFilter[],
  marketUrl: string | null
): SupabaseProduct[] {
  const includeFilter = filters.find((f) => f.filter_type === 'include')
  const excludeFilter = filters.find((f) => f.filter_type === 'exclude')
  let result = products
  if (includeFilter && includeFilter.rules.length > 0) {
    result = result.filter((p) => matchesFilter(p, includeFilter, marketUrl))
  }
  if (excludeFilter && excludeFilter.rules.some((r) => NO_VALUE_OPS.has(r.operator) || r.value !== '')) {
    result = result.filter((p) => !matchesFilter(p, excludeFilter, marketUrl))
  }
  return result
}

function xmlLine(field: string, value: string): string {
  // User-defined custom fields (saved as "custom:foo") are written without
  // the g: namespace — they're not part of the Google Shopping spec, so the
  // tag is just the bare name. Validation client-side restricts the suffix
  // to [A-Za-z0-9_], which is XML-safe.
  if (field.startsWith('custom:')) {
    const tag = field.slice('custom:'.length)
    return `      <g:${tag}>${xmlEscape(value)}</g:${tag}>`
  }
  return `      <g:${field}>${xmlEscape(value)}</g:${field}>`
}

// Returns a copy of the product with the given variant placed at variants[0].
function withVariantFirst(product: SupabaseProduct, variant: StoredVariant): SupabaseProduct {
  const rest = (product.variants as StoredVariant[]).filter((v) => v.id !== variant.id)
  return { ...product, variants: [variant, ...rest] as unknown[] }
}

// ── Filter counts (used by dashboard) ──────────────────────────────────────

export async function countFilteredProducts(
  feedId: string
): Promise<{ total: number; included: number }> {
  const db = adminClient()

  const [
    { data: shopSettingsData },
    rawProducts,
    { data: filtersData },
  ] = await Promise.all([
    db.from('shop_settings').select('market_url').eq('feed_id', feedId).maybeSingle(),
    fetchAllActiveProducts(db, feedId),
    db.from('feed_filters').select('filter_type, operator, rules').eq('feed_id', feedId),
  ])

  const marketUrl = (shopSettingsData?.market_url as string | null) ?? null
  const filterRows = (filtersData ?? []) as FeedFilter[]
  const filtered = applyFeedFilters(rawProducts, filterRows, marketUrl)

  return { total: rawProducts.length, included: filtered.length }
}

// ── Main export ────────────────────────────────────────────────────────────

// PostgREST defaults to a 1000-row cap (Supabase's db-max-rows). For a feed
// that needs every active product, page through with .range() until exhausted.
// PAGE_SIZE = 1000 matches the server cap so each request returns the maximum.
async function fetchAllActiveProducts(
  db: ReturnType<typeof adminClient>,
  feedId: string
): Promise<SupabaseProduct[]> {
  const PAGE_SIZE = 1000
  const out: SupabaseProduct[] = []
  let from = 0
  while (true) {
    const { data, error } = await db
      .from('products')
      .select('*, metafields:product_metafields(*)')
      .eq('feed_id', feedId)
      .eq('status', 'active')
      .order('created_at', { ascending: true })
      .range(from, from + PAGE_SIZE - 1)
    if (error) throw new Error(`Produkter fejlede: ${error.message}`)
    if (!data || data.length === 0) break
    out.push(...(data as SupabaseProduct[]))
    if (data.length < PAGE_SIZE) break
    from += PAGE_SIZE
  }
  return out
}

export async function generateFeed(feedId: string): Promise<FeedResult> {
  const db = adminClient()

  const [
    { data: settingsData },
    { data: shopSettingsData },
    { data: mappingsData, error: mappingsErr },
    rawProducts,
    { data: filtersData },
  ] = await Promise.all([
    db.from('feed_settings').select('feed_mode').eq('feed_id', feedId).maybeSingle(),
    db.from('shop_settings').select('market_url, selected_market_id, selected_locale').eq('feed_id', feedId).maybeSingle(),
    db.from('feed_mappings').select('google_field, mapping_type, config').eq('feed_id', feedId),
    fetchAllActiveProducts(db, feedId),
    db.from('feed_filters').select('filter_type, operator, rules').eq('feed_id', feedId),
  ])

  if (mappingsErr) throw new Error(`Mappings fejlede: ${mappingsErr.message}`)

  const feedMode = (settingsData?.feed_mode as 'product' | 'variant') ?? 'product'
  const marketUrl = (shopSettingsData?.market_url as string | null) ?? null

  const mappings = ((mappingsData ?? []) as FeedMapping[]).filter(
    (m) => m.mapping_type && m.mapping_type !== ('' as MappingType)
  )

  const filterRows = (filtersData ?? []) as FeedFilter[]

  const products = applyFeedFilters(rawProducts, filterRows, marketUrl)

  const needsAi = mappings.some((m) => m.mapping_type === 'AI')
  const anthropic =
    needsAi && process.env.ANTHROPIC_API_KEY
      ? new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY })
      : null

  const items: string[] = []

  if (feedMode === 'product') {
    for (const product of products) {
      const lines: string[] = []

      // Auto-inject g:id from shopify_id. User mappings for id and
      // item_group_id are skipped: id is locked to shopify_id, and
      // item_group_id has no meaning in product mode (no variant grouping).
      if (product.shopify_id) {
        lines.push(xmlLine('id', String(product.shopify_id)))
      }

      for (const mapping of mappings) {
        if (mapping.google_field === 'id' || mapping.google_field === 'item_group_id') continue
        const value = await resolvedValue(mapping, product, anthropic, marketUrl)
        if (value !== '') lines.push(xmlLine(mapping.google_field, value))
      }
      if (lines.length > 0) items.push(`    <item>\n${lines.join('\n')}\n    </item>`)
    }
  } else {
    // VARIANT mode — one feed item per variant
    const mappedFields = new Set(mappings.map((m) => m.google_field))

    for (const product of products) {
      const variants = product.variants as StoredVariant[]
      if (!variants.length) continue

      for (const variant of variants) {
        const vProduct = withVariantFirst(product, variant)

        // Apply mapping rules; id and item_group_id are always auto-computed
        const mappedLines: string[] = []
        const addedFields = new Set<string>()

        for (const mapping of mappings) {
          if (mapping.google_field === 'id' || mapping.google_field === 'item_group_id') continue
          const value = await resolvedValue(mapping, vProduct, anthropic, marketUrl)
          if (value !== '') {
            mappedLines.push(xmlLine(mapping.google_field, value))
            addedFields.add(mapping.google_field)
          }
        }

        // Always-inject: id and item_group_id
        const autoLines: string[] = [
          xmlLine('id', `${product.shopify_id}_${variant.id}`),
          xmlLine('item_group_id', product.shopify_id),
        ]

        // Auto-fill title if not covered by a mapping
        if (!mappedFields.has('title') || !addedFields.has('title')) {
          const suffix =
            variant.title && variant.title !== 'Default Title' ? ` - ${variant.title}` : ''
          const autoTitle = `${product.title ?? ''}${suffix}`.trim()
          if (autoTitle) autoLines.push(xmlLine('title', autoTitle))
        }

        // Auto-fill availability if not covered by a mapping
        if (!mappedFields.has('availability') || !addedFields.has('availability')) {
          const avail = (variant.inventory_quantity ?? 0) > 0 ? 'in_stock' : 'out_of_stock'
          autoLines.push(xmlLine('availability', avail))
        }

        const allLines = [...autoLines, ...mappedLines]
        if (allLines.length > 0) {
          items.push(`    <item>\n${allLines.join('\n')}\n    </item>`)
        }
      }
    }
  }

  const itemCount =
    feedMode === 'product'
      ? products.length
      : products.reduce((sum, p) => sum + (p.variants as unknown[]).length, 0)

  const xml = `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0" xmlns:g="http://base.google.com/ns/1.0">
  <channel>
    <title>Product Feed</title>
    <link>https://google.com</link>
    <description>Google Shopping Feed</description>
${items.join('\n')}
  </channel>
</rss>`

  return { xml, productCount: itemCount }
}

// ── Preview ────────────────────────────────────────────────────────────────

export type PreviewRow = {
  productId: string
  title: string
  fields: Record<string, string>
}

export type PreviewData = {
  feedMode: 'product' | 'variant'
  rows: PreviewRow[]
  googleFields: string[]
  totalProducts: number
}

export async function generatePreview(feedId: string, limit = 100): Promise<PreviewData> {
  const db = adminClient()

  const [
    { data: settingsData },
    { data: shopSettingsData },
    { data: mappingsData },
    { data: productsData },
    { data: filtersData },
  ] = await Promise.all([
    db.from('feed_settings').select('feed_mode').eq('feed_id', feedId).maybeSingle(),
    db.from('shop_settings').select('market_url, selected_market_id, selected_locale').eq('feed_id', feedId).maybeSingle(),
    db.from('feed_mappings').select('google_field, mapping_type, config').eq('feed_id', feedId),
    db.from('products').select('*, metafields:product_metafields(*)').eq('feed_id', feedId).eq('status', 'active').order('created_at', { ascending: true }),
    db.from('feed_filters').select('filter_type, operator, rules').eq('feed_id', feedId),
  ])

  const feedMode = (settingsData?.feed_mode as 'product' | 'variant') ?? 'product'
  const marketUrl = (shopSettingsData?.market_url as string | null) ?? null
  const mappings = ((mappingsData ?? []) as FeedMapping[]).filter(
    (m) => m.mapping_type && m.mapping_type !== ('' as MappingType)
  )
  const rawProducts = (productsData ?? []) as SupabaseProduct[]
  const filterRows = (filtersData ?? []) as FeedFilter[]
  const filteredProducts = applyFeedFilters(rawProducts, filterRows, marketUrl)

  let googleFields: string[]
  const rows: PreviewRow[] = []

  if (feedMode === 'product') {
    googleFields = mappings.map((m) => m.google_field)

    for (const product of filteredProducts.slice(0, limit)) {
      const fields: Record<string, string> = {}
      for (const mapping of mappings) {
        if (mapping.mapping_type === 'AI') {
          fields[mapping.google_field] = '__AI__'
          continue
        }
        fields[mapping.google_field] = await resolvedValue(mapping, product, null, marketUrl)
      }
      rows.push({ productId: product.shopify_id, title: product.title ?? product.shopify_id, fields })
    }
  } else {
    const autoFields = ['id', 'item_group_id', 'title', 'availability']
    const extraMapped = mappings
      .filter((m) => !['id', 'item_group_id'].includes(m.google_field))
      .map((m) => m.google_field)
    googleFields = [...new Set([...autoFields, ...extraMapped])]

    outer: for (const product of filteredProducts) {
      const variants = product.variants as StoredVariant[]
      for (const variant of variants) {
        if (rows.length >= limit) break outer
        const vProduct = withVariantFirst(product, variant)
        const fields: Record<string, string> = {}

        fields['id'] = `${product.shopify_id}_${variant.id}`
        fields['item_group_id'] = product.shopify_id
        const suffix = variant.title && variant.title !== 'Default Title' ? ` - ${variant.title}` : ''
        fields['title'] = `${product.title ?? ''}${suffix}`.trim()
        fields['availability'] = (variant.inventory_quantity ?? 0) > 0 ? 'in_stock' : 'out_of_stock'

        for (const mapping of mappings) {
          if (['id', 'item_group_id'].includes(mapping.google_field)) continue
          if (mapping.mapping_type === 'AI') {
            fields[mapping.google_field] = '__AI__'
            continue
          }
          const value = await resolvedValue(mapping, vProduct, null, marketUrl)
          if (value !== '') fields[mapping.google_field] = value
        }

        rows.push({
          productId: `${product.shopify_id}_${variant.id}`,
          title: fields['title'] || product.title || product.shopify_id,
          fields,
        })
      }
    }
  }

  return { feedMode, rows, googleFields, totalProducts: filteredProducts.length }
}
