// Performance buckets: rule-based labelling of products (or variants) by how
// they actually perform in Google Ads.
//
// THE RULE THAT SHAPES EVERYTHING HERE: a numeric comparison never matches null.
//
// A product with no spend has no ROAS — it does not have a ROAS of zero. If
// `roas < 1` caught those, the first bucket anyone writes would swallow the
// entire untested long tail and recommend suppressing it. So `null` fails every
// numeric operator, and catching no-data entities requires saying so explicitly
// with is_empty. On the CoffeeTools data that is 8 of 51 products.
//
// Assignment is FIRST MATCH WINS in priority order, so an entity is never in two
// buckets and the rule set reads top to bottom like an if/else chain.
//
// Membership is derived, never curated: every recompute rewrites it. That is the
// opposite of lib/optimizationBuckets.ts (AI titles), whose membership is frozen
// and hand-picked — which is why the two features have separate tables.

import type { SupabaseClient } from '@supabase/supabase-js'
import { dbError, AppError } from '@/lib/errors'
import { buildItemId, type IdPattern } from '@/lib/googleAdsIds'
import { getFeedSettings, type GoogleAdsFeedSettings } from '@/lib/feedGoogleAds'
import { getProductMargins } from '@/lib/variantCosts'
import {
  derive,
  windowRange,
  type Derived,
  type ProductRow,
  type VariantRow,
} from '@/lib/googleAdsAnalytics'

// ── Rule model ───────────────────────────────────────────────────────────────

export const BUCKET_METRICS = [
  'roas',
  'poas',
  'conversions',
  'conversions_value',
  'cost',
  'clicks',
  'impressions',
  'profit_after_ad_spend',
  // Catalogue margin from Shopify's cost per item — NOT the `margin` that
  // derive() computes from the two conversion actions. This one exists whether
  // or not a product has ever been advertised, which is what makes rules like
  // "high margin, no traffic" possible.
  'cogs_margin',
] as const
export type BucketMetric = (typeof BUCKET_METRICS)[number]

export const BUCKET_OPERATORS = [
  'gt',
  'gte',
  'lt',
  'lte',
  'eq',
  'neq',
  'is_empty',
  'is_not_empty',
] as const
export type BucketOperator = (typeof BUCKET_OPERATORS)[number]

export type BucketRule = {
  metric: BucketMetric
  operator: BucketOperator
  value?: number
  /**
   * Per-rule lookback. Unused by the UI today — every rule inherits the set-level
   * window — but stored so per-rule windows can be exposed later without a
   * migration or a data rewrite.
   */
  windowDays?: number
}

export type BucketLevel = 'product' | 'variant'

export type Bucket = {
  id: string
  feed_id: string
  name: string
  priority: number
  match_type: 'ALL' | 'ANY'
  rules: BucketRule[]
  is_fallback: boolean
  custom_label_index: number | null
  custom_label_value: string | null
  emit_to_feed: boolean
  description: string | null
}

const BUCKET_COLUMNS =
  'id, feed_id, name, priority, match_type, rules, is_fallback, ' +
  'custom_label_index, custom_label_value, emit_to_feed, description'

// ── Evaluation ───────────────────────────────────────────────────────────────

/** One thing a rule can be applied to: a product, or a Merchant Center item. */
export type BucketEntity = {
  ref: string
  productRef: string | null
  title: string | null
  /** False when Google reported nothing at all for this entity in the window. */
  hasData: boolean
  /**
   * Catalogue margin, or null when no cost is entered. At variant level this is
   * the PARENT PRODUCT's margin: variant_costs is per variant, but the roll-up
   * that turns cost into a margin is per product today. Variants of one product
   * can differ, so a per-variant margin is a later refinement — inheriting is
   * the approximation, and it is stated here rather than hidden.
   */
  cogsMargin: number | null
  metrics: Derived & {
    cost: number
    clicks: number
    impressions: number
    conversions: number
    conversions_value: number
    roas_value: number
    poas_value: number
  }
}

function metricValue(e: BucketEntity, metric: BucketMetric): number | null {
  switch (metric) {
    case 'roas':
      return e.metrics.roas
    case 'poas':
      return e.metrics.poas
    case 'profit_after_ad_spend':
      return e.metrics.profitAfterAdSpend
    // Counts are genuinely 0 for an entity with no traffic — zero impressions is
    // a fact, unlike a ratio with no denominator.
    case 'conversions':
      return e.metrics.conversions
    case 'conversions_value':
      return e.metrics.roas_value
    case 'cost':
      return e.metrics.cost
    case 'clicks':
      return e.metrics.clicks
    case 'impressions':
      return e.metrics.impressions
    // Null when no cost is entered in Shopify, so it fails every numeric
    // operator — an un-costed product is never swept into a margin bucket.
    case 'cogs_margin':
      return e.cogsMargin
  }
}

export function evaluateRule(entity: BucketEntity, rule: BucketRule): boolean {
  const v = metricValue(entity, rule.metric)

  if (rule.operator === 'is_empty') return v === null
  if (rule.operator === 'is_not_empty') return v !== null

  // The load-bearing line: an absent measurement is not a low one.
  if (v === null) return false

  const target = Number(rule.value)
  if (!Number.isFinite(target)) return false

  switch (rule.operator) {
    case 'gt':
      return v > target
    case 'gte':
      return v >= target
    case 'lt':
      return v < target
    case 'lte':
      return v <= target
    case 'eq':
      return v === target
    case 'neq':
      return v !== target
    default:
      return false
  }
}

function isUsable(rule: BucketRule): boolean {
  if (!BUCKET_METRICS.includes(rule.metric)) return false
  if (!BUCKET_OPERATORS.includes(rule.operator)) return false
  if (rule.operator === 'is_empty' || rule.operator === 'is_not_empty') return true
  return Number.isFinite(Number(rule.value))
}

export function matchesBucket(entity: BucketEntity, bucket: Bucket): boolean {
  if (bucket.is_fallback) return true

  const rules = (bucket.rules ?? []).filter(isUsable)
  // A bucket with no usable rules matches NOTHING. The alternative — treating it
  // as "match everything" — would silently swallow the catalogue the moment
  // someone created a bucket and had not filled it in yet.
  if (!rules.length) return false

  return bucket.match_type === 'ANY'
    ? rules.some((r) => evaluateRule(entity, r))
    : rules.every((r) => evaluateRule(entity, r))
}

/** Buckets in evaluation order: by priority, with the fallback always last. */
export function orderBuckets(buckets: Bucket[]): Bucket[] {
  return [...buckets].sort((a, b) => {
    if (a.is_fallback !== b.is_fallback) return a.is_fallback ? 1 : -1
    return a.priority - b.priority || a.name.localeCompare(b.name, 'en')
  })
}

export function assign(
  entities: BucketEntity[],
  buckets: Bucket[]
): Map<string, string> {
  const ordered = orderBuckets(buckets)
  const out = new Map<string, string>()
  for (const e of entities) {
    const hit = ordered.find((b) => matchesBucket(e, b))
    if (hit) out.set(e.ref, hit.id)
  }
  return out
}

// ── CRUD ─────────────────────────────────────────────────────────────────────

export async function listBuckets(db: SupabaseClient, feedId: string): Promise<Bucket[]> {
  const { data, error } = await db
    .from('google_ads_buckets')
    .select(BUCKET_COLUMNS)
    .eq('feed_id', feedId)
  if (error) dbError('listBuckets', error)
  // Double cast: the select-string overload widens the inferred row type, so TS
  // can't see the overlap. BUCKET_COLUMNS pins the actual shape.
  return orderBuckets((data ?? []) as unknown as Bucket[])
}

export async function saveBucket(
  db: SupabaseClient,
  feedId: string,
  bucket: Partial<Bucket> & { id?: string; name?: string }
): Promise<Bucket> {
  const row: Record<string, unknown> = { feed_id: feedId, updated_at: new Date().toISOString() }
  for (const k of [
    'name',
    'priority',
    'match_type',
    'rules',
    'is_fallback',
    'custom_label_index',
    'custom_label_value',
    'emit_to_feed',
    'description',
  ] as const) {
    if (bucket[k] !== undefined) row[k] = bucket[k]
  }

  const q = bucket.id
    ? db.from('google_ads_buckets').update(row).eq('id', bucket.id).eq('feed_id', feedId)
    : db.from('google_ads_buckets').insert(row)

  const { data, error } = await q.select(BUCKET_COLUMNS).single()
  if (error) {
    // The two constraints a user can actually hit, translated into something
    // actionable rather than a Postgres string.
    if (error.message.includes('one_fallback')) {
      throw new AppError('There is already a catch-all bucket for this feed.')
    }
    if (error.message.includes('google_ads_buckets_feed_id_name_key')) {
      throw new AppError('A bucket with that name already exists.')
    }
    dbError('saveBucket', error)
  }
  return data as unknown as Bucket
}

export async function deleteBucket(
  db: SupabaseClient,
  feedId: string,
  bucketId: string
): Promise<void> {
  const { error } = await db
    .from('google_ads_buckets')
    .delete()
    .eq('id', bucketId)
    .eq('feed_id', feedId)
  if (error) dbError('deleteBucket', error)
}

// ── Entity assembly ──────────────────────────────────────────────────────────

type CatalogueProduct = {
  shopify_id: string
  title: string | null
  variants: { id?: unknown }[] | null
}

/**
 * Every entity that COULD be bucketed — not just the ones Google reported on.
 *
 * This is the whole reason a "no traffic" bucket can exist: a product with zero
 * impressions never appears in shopping_performance_view, so building the list
 * from metrics alone would make the products most worth acting on invisible.
 * The catalogue supplies them, with zero counts and null ratios.
 */
async function buildEntities(
  db: SupabaseClient,
  feedId: string,
  settings: GoogleAdsFeedSettings,
  level: BucketLevel,
  windowDays: number
): Promise<BucketEntity[]> {
  const { from, to } = windowRange(windowDays)
  const actions = {
    p_roas_actions: settings.roas_conversion_actions ?? [],
    p_poas_actions: settings.poas_conversion_actions ?? [],
  }

  // Margins for the whole catalogue in one query. Costed independently of the
  // ads window: a margin is a property of the product, not of a date range.
  const margins = await getProductMargins(db, feedId)

  const byRef = new Map<string, BucketEntity>()

  const toEntity = (
    ref: string,
    productRef: string | null,
    title: string | null,
    row: Partial<BucketEntity['metrics']>,
    hasData: boolean
  ): BucketEntity => {
    const raw = {
      impressions: Number(row.impressions ?? 0),
      clicks: Number(row.clicks ?? 0),
      cost: Number(row.cost ?? 0),
      conversions: Number(row.conversions ?? 0),
      conversions_value: Number(row.conversions_value ?? 0),
      roas_conversions: 0,
      roas_value: Number(row.roas_value ?? 0),
      poas_conversions: 0,
      poas_value: Number(row.poas_value ?? 0),
    }
    return {
      ref,
      productRef,
      title,
      hasData,
      cogsMargin: productRef ? (margins.get(productRef)?.margin ?? null) : null,
      metrics: { ...raw, ...derive(raw) },
    }
  }

  if (level === 'product') {
    const { data, error } = await db.rpc('google_ads_product_summary', {
      p_feed_id: feedId,
      p_from: from,
      p_to: to,
      ...actions,
    })
    if (error) dbError('buildEntities/product', error)
    for (const r of (data ?? []) as unknown as ProductRow[] & Record<string, unknown>[]) {
      const ref = (r.product_ref as string | null) ?? null
      if (!ref) continue // unparseable item id — cannot belong to a product bucket
      byRef.set(ref, toEntity(ref, ref, (r.title as string | null) ?? null, r as never, true))
    }
  } else {
    const { data, error } = await db.rpc('google_ads_variant_summary', {
      p_feed_id: feedId,
      p_from: from,
      p_to: to,
      p_product_ref: null,
      ...actions,
    })
    if (error) dbError('buildEntities/variant', error)
    for (const r of (data ?? []) as unknown as VariantRow[] & Record<string, unknown>[]) {
      const ref = String(r.item_id ?? '')
      if (!ref) continue
      byRef.set(
        ref,
        toEntity(ref, (r.product_ref as string | null) ?? null, (r.product_title as string | null) ?? null, r as never, true)
      )
    }
  }

  // ── Fill in the catalogue ──
  const products: CatalogueProduct[] = []
  const PAGE = 1000
  for (let page = 0; ; page++) {
    const { data, error } = await db
      .from('products')
      .select('shopify_id, title, variants')
      .eq('feed_id', feedId)
      .order('shopify_id', { ascending: true })
      .range(page * PAGE, page * PAGE + PAGE - 1)
    if (error) dbError('buildEntities/catalogue', error)
    const rows = (data ?? []) as CatalogueProduct[]
    products.push(...rows)
    if (rows.length < PAGE) break
  }

  if (level === 'product') {
    for (const p of products) {
      if (!p.shopify_id || byRef.has(p.shopify_id)) continue
      byRef.set(p.shopify_id, toEntity(p.shopify_id, p.shopify_id, p.title, {}, false))
    }
  } else {
    const pattern = (settings.id_pattern === 'auto' ? null : settings.id_pattern) as IdPattern | null
    // Without a known pattern we cannot construct the id Merchant Center would
    // use, so untrafficked variants stay out rather than being invented wrongly.
    if (pattern) {
      for (const p of products) {
        for (const v of p.variants ?? []) {
          if (v?.id == null) continue
          const ref = buildItemId(pattern, p.shopify_id, String(v.id), settings.id_pattern_country)
          if (!ref || byRef.has(ref)) continue
          byRef.set(ref, toEntity(ref, p.shopify_id, p.title, {}, false))
        }
      }
    }
  }

  return [...byRef.values()]
}

// ── Recompute ────────────────────────────────────────────────────────────────

export type RecomputeResult = {
  level: BucketLevel
  windowDays: number
  entities: number
  withData: number
  assigned: number
  unassigned: number
  moved: number
  perBucket: { id: string; name: string; count: number }[]
  warnings: string[]
}

export async function recomputeBuckets(
  db: SupabaseClient,
  feedId: string
): Promise<RecomputeResult> {
  const settings = await getFeedSettings(db, feedId)
  if (!settings) throw new AppError('Google Ads is not set up for this feed.')

  const level = (settings.bucket_level ?? 'product') as BucketLevel
  const windowDays = settings.bucket_window_days ?? 30
  const warnings: string[] = []

  const roasActions = settings.roas_conversion_actions ?? []
  const poasActions = settings.poas_conversion_actions ?? []

  if (!roasActions.length) {
    warnings.push('No revenue conversion action selected — ROAS rules will never match.')
  }
  if (!poasActions.length) {
    warnings.push('No gross profit conversion action selected — POAS rules will never match.')
  }

  // Actions counted on both sides are not an error — the same order really is
  // reported by several actions — but they make POAS partly a restatement of
  // ROAS, which is worth saying out loud before someone bids on it.
  const shared = roasActions.filter((a) => poasActions.includes(a))
  if (shared.length && shared.length === roasActions.length && shared.length === poasActions.length) {
    warnings.push('Revenue and gross profit use the same conversion actions, so POAS equals ROAS.')
  } else if (shared.length) {
    warnings.push(
      `${shared.length} conversion action${shared.length === 1 ? '' : 's'} count towards both revenue and gross profit.`
    )
  }

  const buckets = await listBuckets(db, feedId)
  const entities = await buildEntities(db, feedId, settings, level, windowDays)

  if (level === 'variant' && settings.id_pattern === 'auto') {
    warnings.push(
      'The item ID format is not confirmed yet, so variants without traffic are excluded.'
    )
  }

  // Previous assignment, for the "what changed" count. Read BEFORE the rewrite.
  const previous = new Map<string, string>()
  {
    const { data } = await db
      .from('google_ads_bucket_members')
      .select('ref, bucket_id')
      .eq('feed_id', feedId)
    for (const r of (data ?? []) as { ref: string; bucket_id: string }[]) {
      previous.set(r.ref, r.bucket_id)
    }
  }

  const assignment = assign(entities, buckets)

  // Full replace, in ONE transaction (migration 036). Membership is derived, so
  // a partial update would leave stale rows for entities that no longer match —
  // and a partial REPLACE, which is what a delete followed by separate chunked
  // inserts leaves behind when one chunk fails, is worse still: the page would
  // show counts that are wrong rather than merely out of date, with no way to
  // tell. The RPC deletes, inserts and stamps atomically or does none of it.
  //
  // `level` rides as a scalar because it is a property of the whole set, which
  // keeps the single jsonb payload narrow.
  const now = new Date().toISOString()
  const members = entities
    .filter((e) => assignment.has(e.ref))
    .map((e) => ({
      bucket_id: assignment.get(e.ref)!,
      ref: e.ref,
      product_ref: e.productRef,
    }))

  const { data: inserted, error: replaceErr } = await db.rpc(
    'google_ads_replace_bucket_members',
    {
      p_feed_id: feedId,
      p_level: level,
      p_members: members,
      p_computed_at: now,
    }
  )
  if (replaceErr) dbError('recomputeBuckets/replace', replaceErr)

  const perBucket = orderBuckets(buckets).map((b) => ({
    id: b.id,
    name: b.name,
    count: [...assignment.values()].filter((v) => v === b.id).length,
  }))

  let moved = 0
  for (const [ref, bucketId] of assignment) {
    if (previous.get(ref) !== bucketId) moved++
  }

  // Row count as the database actually wrote it, not as we intended to write it.
  // The two can only differ if the RPC changes shape, and if they ever do the
  // committed number is the one worth reporting.
  const assigned = Number(inserted ?? assignment.size)

  return {
    level,
    windowDays,
    entities: entities.length,
    withData: entities.filter((e) => e.hasData).length,
    assigned,
    unassigned: entities.length - assigned,
    moved,
    perBucket,
    warnings,
  }
}

// ── Starter set ──────────────────────────────────────────────────────────────

/**
 * A default rule set, ordered so the cheap structural checks run before the
 * performance ones. Not applied automatically — offered in the UI, because the
 * thresholds are a commercial judgement, not a technical default.
 */
export function starterBuckets(): Omit<Bucket, 'id' | 'feed_id'>[] {
  return [
    {
      name: 'No traffic',
      priority: 10,
      match_type: 'ALL',
      rules: [{ metric: 'impressions', operator: 'eq', value: 0 }],
      is_fallback: false,
      custom_label_index: null,
      custom_label_value: null,
      emit_to_feed: false,
      description: 'Never shown by Google. Not bad performers — untested ones.',
    },
    {
      name: 'Too little data',
      priority: 20,
      match_type: 'ALL',
      rules: [{ metric: 'clicks', operator: 'lt', value: 25 }],
      is_fallback: false,
      custom_label_index: null,
      custom_label_value: null,
      emit_to_feed: false,
      description: 'Some traffic, but too few clicks to judge on yet.',
    },
    {
      name: 'Zombies',
      priority: 30,
      match_type: 'ALL',
      rules: [{ metric: 'conversions', operator: 'eq', value: 0 }],
      is_fallback: false,
      custom_label_index: null,
      custom_label_value: null,
      emit_to_feed: false,
      description: 'Enough clicks to judge, and still no conversions.',
    },
    {
      name: 'Losing money',
      priority: 40,
      match_type: 'ALL',
      rules: [{ metric: 'poas', operator: 'lt', value: 1 }],
      is_fallback: false,
      custom_label_index: null,
      custom_label_value: null,
      emit_to_feed: false,
      description: 'Converts, but the gross profit is less than the ad spend.',
    },
    {
      name: 'Heroes',
      priority: 50,
      match_type: 'ALL',
      rules: [{ metric: 'poas', operator: 'gte', value: 2 }],
      is_fallback: false,
      custom_label_index: null,
      custom_label_value: null,
      emit_to_feed: false,
      description: 'At least two kroner of gross profit per krone spent.',
    },
    {
      name: 'Everything else',
      priority: 999,
      match_type: 'ALL',
      rules: [],
      is_fallback: true,
      custom_label_index: null,
      custom_label_value: null,
      emit_to_feed: false,
      description: 'Profitable, but not remarkably so.',
    },
  ]
}
