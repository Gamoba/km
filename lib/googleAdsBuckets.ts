// Custom labels: rule-based segmentation of products (or variants) by how they
// actually perform in Google Ads.
//
// ── THE MODEL ───────────────────────────────────────────────────────────────
// A CUSTOM LABEL is a dimension — one of Google's five custom_label_N slots,
// each holding one string per offer. BUCKETS are the mutually exclusive values
// within one dimension. A product is "high" on the performance label AND "thin"
// on the margin label at the same time; the dimensions are independent analyses
// that happen to run over the same catalogue.
//
// First match wins WITHIN a label, so a product gets exactly one value per
// dimension and each label's buckets read top to bottom like an if/else chain.
//
// ── THE RULE THAT SHAPES EVERYTHING HERE ────────────────────────────────────
// A numeric comparison never matches null.
//
// A product with no spend has no ROAS — it does not have a ROAS of zero. If
// `roas < 1` caught those, the first bucket anyone writes would swallow the
// entire untested long tail and recommend suppressing it. So `null` fails every
// numeric operator, and catching no-data entities requires saying so explicitly
// with is_empty. The same applies to metrics whose conversion action has not
// been chosen: see BucketEntity.tracked.
//
// Membership is derived, never curated: every recompute rewrites it, one label
// at a time. That is the opposite of lib/optimizationBuckets.ts (AI titles),
// whose membership is frozen and hand-picked — which is why the two features
// have separate tables despite both saying "bucket".

import type { SupabaseClient } from '@supabase/supabase-js'
import { dbError, AppError } from '@/lib/errors'
import { buildItemId, type IdPattern } from '@/lib/googleAdsIds'
import { getFeedSettings, type GoogleAdsFeedSettings } from '@/lib/feedGoogleAds'
import { getProductMargins, vatBasis } from '@/lib/variantCosts'
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
  // Three different conversion counts, because they answer different questions
  // and an account can disagree with itself about which one is "sales":
  //   conversions      — Google's account default, PRIMARY goals only. Nothing
  //                      to do with the actions chosen for ROAS/POAS below, so
  //                      a product selling through a secondary action counts 0
  //                      here while showing real revenue.
  //   roas_conversions — counted by the actions picked as revenue.
  //   poas_conversions — counted by the actions picked as gross profit.
  'conversions',
  'roas_conversions',
  'poas_conversions',
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
   * Per-rule lookback. Unused by the UI — every rule inherits its label's
   * window — but stored so per-rule windows can be exposed later without a
   * migration or a data rewrite.
   */
  windowDays?: number
}

export type BucketLevel = 'product' | 'variant'

/** One of Google's five custom_label_N slots, and everything it measures with. */
export type CustomLabel = {
  id: string
  feed_id: string
  /** Human name for the dimension ("Performance"). Never sent to Google. */
  name: string
  /** 0–4, or null while the dimension is still a draft. */
  slot: number | null
  /** Per label: a dimension chooses what it measures and over how long. */
  level: BucketLevel
  window_days: number
  emit_to_feed: boolean
  description: string | null
  computed_at: string | null
}

const LABEL_COLUMNS =
  'id, feed_id, name, slot, level, window_days, emit_to_feed, description, computed_at'

/** One value within a dimension. */
export type Bucket = {
  id: string
  feed_id: string
  label_id: string
  /** Readable ("High performers"). */
  name: string
  /** What Google would receive ("high"). Deliberately not the name. */
  value: string
  priority: number
  match_type: 'ALL' | 'ANY'
  rules: BucketRule[]
  is_fallback: boolean
  description: string | null
}

const BUCKET_COLUMNS =
  'id, feed_id, label_id, name, value, priority, match_type, rules, is_fallback, description'

// ── Evaluation ───────────────────────────────────────────────────────────────

/** One thing a rule can be applied to: a product, or a Merchant Center item. */
export type BucketEntity = {
  ref: string
  productRef: string | null
  title: string | null
  /** False when Google reported nothing at all for this entity in the window. */
  hasData: boolean
  /**
   * Whether the feed has actually named the conversion actions that stand for
   * revenue and for gross profit.
   *
   * Without them the summary RPCs return 0, and 0 is not a measurement — it is
   * the absence of a definition. Left as a number it reads as "this product
   * earned nothing", so `roas < 1` would match EVERY product with spend and the
   * catalogue would be condemned wholesale by a setting nobody filled in.
   */
  tracked: { roas: boolean; poas: boolean }
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
    roas_conversions: number
    roas_value: number
    poas_conversions: number
    poas_value: number
  }
}

function metricValue(e: BucketEntity, metric: BucketMetric): number | null {
  switch (metric) {
    // Everything derived from the chosen actions is unknown until they are
    // chosen — see BucketEntity.tracked.
    case 'roas':
      return e.tracked.roas ? e.metrics.roas : null
    case 'poas':
      return e.tracked.poas ? e.metrics.poas : null
    case 'profit_after_ad_spend':
      return e.metrics.profitAfterAdSpend // derive() already returns null when untracked
    case 'roas_conversions':
      return e.tracked.roas ? e.metrics.roas_conversions : null
    case 'poas_conversions':
      return e.tracked.poas ? e.metrics.poas_conversions : null
    case 'conversions_value':
      return e.tracked.roas ? e.metrics.roas_value : null
    // Counts are genuinely 0 for an entity with no traffic — zero impressions is
    // a fact, unlike a ratio with no denominator. This one needs no action to be
    // chosen: it is Google's own account-default count.
    case 'conversions':
      return e.metrics.conversions
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

/** One label's buckets in evaluation order: by priority, fallback always last. */
export function orderBuckets(buckets: Bucket[]): Bucket[] {
  return [...buckets].sort((a, b) => {
    if (a.is_fallback !== b.is_fallback) return a.is_fallback ? 1 : -1
    return a.priority - b.priority || a.name.localeCompare(b.name, 'en')
  })
}

/**
 * Labels in display order: by slot, drafts last.
 *
 * Slot order rather than creation order, because the slot is what anyone
 * reading a Merchant Center export will be looking at.
 */
export function orderLabels(labels: CustomLabel[]): CustomLabel[] {
  return [...labels].sort((a, b) => {
    if ((a.slot === null) !== (b.slot === null)) return a.slot === null ? 1 : -1
    if (a.slot !== null && b.slot !== null && a.slot !== b.slot) return a.slot - b.slot
    return a.name.localeCompare(b.name, 'en')
  })
}

/** ref → bucket id, for ONE label's buckets. */
export function assign(entities: BucketEntity[], buckets: Bucket[]): Map<string, string> {
  const ordered = orderBuckets(buckets)
  const out = new Map<string, string>()
  for (const e of entities) {
    const hit = ordered.find((b) => matchesBucket(e, b))
    if (hit) out.set(e.ref, hit.id)
  }
  return out
}

// ── Labels ───────────────────────────────────────────────────────────────────

export async function listLabels(db: SupabaseClient, feedId: string): Promise<CustomLabel[]> {
  const { data, error } = await db
    .from('google_ads_custom_labels')
    .select(LABEL_COLUMNS)
    .eq('feed_id', feedId)
  if (error) dbError('listLabels', error)
  return orderLabels((data ?? []) as unknown as CustomLabel[])
}

export async function getLabel(
  db: SupabaseClient,
  feedId: string,
  labelId: string
): Promise<CustomLabel | null> {
  const { data, error } = await db
    .from('google_ads_custom_labels')
    .select(LABEL_COLUMNS)
    .eq('feed_id', feedId)
    .eq('id', labelId)
    .maybeSingle()
  if (error) dbError('getLabel', error)
  return (data as unknown as CustomLabel | null) ?? null
}

export async function saveLabel(
  db: SupabaseClient,
  feedId: string,
  label: Partial<CustomLabel> & { id?: string }
): Promise<CustomLabel> {
  const row: Record<string, unknown> = { feed_id: feedId, updated_at: new Date().toISOString() }
  for (const k of [
    'name',
    'slot',
    'level',
    'window_days',
    'emit_to_feed',
    'description',
  ] as const) {
    if (label[k] !== undefined) row[k] = label[k]
  }

  const q = label.id
    ? db.from('google_ads_custom_labels').update(row).eq('id', label.id).eq('feed_id', feedId)
    : db.from('google_ads_custom_labels').insert(row)

  const { data, error } = await q.select(LABEL_COLUMNS).single()
  if (error) {
    // The constraints a user can actually hit, translated into something
    // actionable rather than a Postgres string.
    if (error.message.includes('one_per_slot')) {
      throw new AppError(
        'Another custom label already uses that slot. A slot holds one value per product, so two labels cannot share it.'
      )
    }
    if (error.message.includes('google_ads_custom_labels_feed_id_name_key')) {
      throw new AppError('A custom label with that name already exists.')
    }
    dbError('saveLabel', error)
  }
  return data as unknown as CustomLabel
}

/** Deletes the label, and with it (ON DELETE CASCADE) its buckets and members. */
export async function deleteLabel(
  db: SupabaseClient,
  feedId: string,
  labelId: string
): Promise<void> {
  const { error } = await db
    .from('google_ads_custom_labels')
    .delete()
    .eq('id', labelId)
    .eq('feed_id', feedId)
  if (error) dbError('deleteLabel', error)
}

// ── Buckets ──────────────────────────────────────────────────────────────────

/** Every bucket on the feed, or just one label's, in evaluation order. */
export async function listBuckets(
  db: SupabaseClient,
  feedId: string,
  labelId?: string
): Promise<Bucket[]> {
  let q = db.from('google_ads_buckets').select(BUCKET_COLUMNS).eq('feed_id', feedId)
  if (labelId) q = q.eq('label_id', labelId)
  const { data, error } = await q
  if (error) dbError('listBuckets', error)
  // Double cast: the select-string overload widens the inferred row type, so TS
  // can't see the overlap. BUCKET_COLUMNS pins the actual shape.
  return orderBuckets((data ?? []) as unknown as Bucket[])
}

export async function saveBucket(
  db: SupabaseClient,
  feedId: string,
  bucket: Partial<Bucket> & { id?: string }
): Promise<Bucket> {
  if (!bucket.id && !bucket.label_id) {
    throw new AppError('A bucket must belong to a custom label.')
  }

  const row: Record<string, unknown> = { feed_id: feedId, updated_at: new Date().toISOString() }
  for (const k of [
    'label_id',
    'name',
    'value',
    'priority',
    'match_type',
    'rules',
    'is_fallback',
    'description',
  ] as const) {
    if (bucket[k] !== undefined) row[k] = bucket[k]
  }

  const q = bucket.id
    ? db.from('google_ads_buckets').update(row).eq('id', bucket.id).eq('feed_id', feedId)
    : db.from('google_ads_buckets').insert(row)

  const { data, error } = await q.select(BUCKET_COLUMNS).single()
  if (error) {
    if (error.message.includes('one_fallback')) {
      throw new AppError('This custom label already has a catch-all bucket.')
    }
    if (error.message.includes('google_ads_buckets_label_id_name_key')) {
      throw new AppError('A bucket with that name already exists in this custom label.')
    }
    if (error.message.includes('google_ads_buckets_value_chk')) {
      throw new AppError('A bucket needs a value — that is the text Google would receive.')
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
  variants?: { id?: unknown }[] | null
}

type EntitySet = { entities: BucketEntity[]; unmatchedCost: number }

/**
 * Every entity that COULD be labelled — not just the ones Google reported on.
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
): Promise<EntitySet> {
  const { from, to } = windowRange(windowDays)
  const actions = {
    p_roas_actions: settings.roas_conversion_actions ?? [],
    p_poas_actions: settings.poas_conversion_actions ?? [],
  }
  const tracked = {
    roas: actions.p_roas_actions.length > 0,
    poas: actions.p_poas_actions.length > 0,
  }

  // Margins for the whole catalogue in one query. Costed independently of the
  // ads window: a margin is a property of the product, not of a date range.
  //
  // Always the VAT-corrected figure, never the display basis — a cogs_margin
  // threshold has to mean one thing regardless of how anyone is viewing the
  // Performance table.
  const margins = await getProductMargins(db, feedId, vatBasis(settings))

  const byRef = new Map<string, BucketEntity>()
  // Spend Google reported against item ids the pattern could not parse. It has
  // nowhere to go at product level, and silently dropping it is how a wrong ID
  // pattern stays invisible — so it is counted and reported.
  let unmatchedCost = 0

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
      // The conversion COUNTS matter even though few rules read them directly:
      // derive() uses poas_conversions to tell "gross profit of zero" apart from
      // "no profit data".
      roas_conversions: Number(row.roas_conversions ?? 0),
      roas_value: Number(row.roas_value ?? 0),
      poas_conversions: Number(row.poas_conversions ?? 0),
      poas_value: Number(row.poas_value ?? 0),
    }
    return {
      ref,
      productRef,
      title,
      hasData,
      tracked,
      cogsMargin: productRef ? (margins.get(productRef)?.margin ?? null) : null,
      metrics: { ...raw, ...derive(raw, tracked.poas) },
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
      if (!ref) {
        // Unparseable item id — cannot belong to a product bucket.
        unmatchedCost += Number((r as Record<string, unknown>).cost ?? 0)
        continue
      }
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
        toEntity(
          ref,
          (r.product_ref as string | null) ?? null,
          (r.product_title as string | null) ?? null,
          r as never,
          true
        )
      )
    }
  }

  // ── Fill in the catalogue ──
  const products: CatalogueProduct[] = []
  const PAGE = 1000
  // The variants jsonb is only needed to synthesise Merchant Center item ids at
  // variant level; at product level it is pure payload, and it is the largest
  // column in the table.
  const columns = level === 'variant' ? 'shopify_id, title, variants' : 'shopify_id, title'
  for (let page = 0; ; page++) {
    const { data, error } = await db
      .from('products')
      .select(columns)
      // Google cannot serve a draft or an archived product, so labelling one
      // "no traffic" is not a finding about advertising — it is noise that
      // inflates that bucket and the denominator under every share bar. A NULL
      // status is kept: it means the sync recorded none, not that the product
      // is hidden.
      .or('status.is.null,status.eq.active')
      .eq('feed_id', feedId)
      .order('shopify_id', { ascending: true })
      .range(page * PAGE, page * PAGE + PAGE - 1)
    if (error) dbError('buildEntities/catalogue', error)
    const rows = (data ?? []) as unknown as CatalogueProduct[]
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

  return { entities: [...byRef.values()], unmatchedCost }
}

/**
 * Builds each distinct (level, window) combination once and shares it.
 *
 * Two labels both measuring products over 30 days are asking the same question
 * of the same data, and the build is the expensive part of a recompute — the
 * summary RPC plus the whole catalogue plus every margin. Caching the PROMISE
 * rather than the result also collapses concurrent requests for the same key.
 */
function entityBuilder(db: SupabaseClient, feedId: string, settings: GoogleAdsFeedSettings) {
  const cache = new Map<string, Promise<EntitySet>>()
  return (level: BucketLevel, windowDays: number): Promise<EntitySet> => {
    const key = `${level}:${windowDays}`
    let hit = cache.get(key)
    if (!hit) {
      hit = buildEntities(db, feedId, settings, level, windowDays)
      cache.set(key, hit)
    }
    return hit
  }
}

// ── Recompute ────────────────────────────────────────────────────────────────

export type LabelResult = {
  labelId: string
  name: string
  slot: number | null
  level: BucketLevel
  windowDays: number
  entities: number
  withData: number
  assigned: number
  /** Entities matching no bucket. Normal: a product need not carry every label. */
  unlabelled: number
  moved: number
  perBucket: { id: string; name: string; value: string; count: number }[]
  warnings: string[]
}

export type RecomputeResult = {
  labels: LabelResult[]
  /** Warnings about the feed as a whole, said once rather than per label. */
  warnings: string[]
}

/** Conversion-action problems, which apply to every label equally. */
function feedWarnings(settings: GoogleAdsFeedSettings): string[] {
  const warnings: string[] = []
  const roasActions = settings.roas_conversion_actions ?? []
  const poasActions = settings.poas_conversion_actions ?? []

  if (!roasActions.length) {
    warnings.push(
      'No revenue conversion action selected, so ROAS, revenue and revenue-based conversion ' +
        'counts have no value and every rule using them fails to match.'
    )
  }
  if (!poasActions.length) {
    warnings.push(
      'No gross profit conversion action selected, so POAS, profit − cost and profit-based ' +
        'conversion counts have no value and every rule using them fails to match.'
    )
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

  return warnings
}

async function recomputeOne(
  db: SupabaseClient,
  feedId: string,
  settings: GoogleAdsFeedSettings,
  label: CustomLabel,
  buckets: Bucket[],
  build: ReturnType<typeof entityBuilder>,
  previous: Map<string, string>
): Promise<LabelResult> {
  const warnings: string[] = []
  const level = label.level
  const windowDays = label.window_days

  // Rules can only see days that were actually pulled. A 365-day label on a
  // 90-day sync window is not an error, but it silently measures 90 days and
  // calls it a year.
  const synced = settings.sync_window_days ?? 90
  if (windowDays > synced) {
    warnings.push(
      `The window is ${windowDays} days but only the last ${synced} days have been synced, ` +
        `so rules are effectively evaluated over ${synced} days.`
    )
  }

  if (!buckets.length) {
    warnings.push('This label has no buckets, so no product carries a value for it.')
  }

  if (level === 'variant' && settings.id_pattern === 'auto') {
    warnings.push(
      'The item ID format is not confirmed yet, so variants without traffic are excluded.'
    )
  }

  const { entities, unmatchedCost } = await build(level, windowDays)

  if (unmatchedCost > 0) {
    const spend = unmatchedCost.toLocaleString('da-DK', { maximumFractionDigits: 0 })
    warnings.push(
      `${spend} ${settings.currency_code ?? ''}`.trim() +
        ' of ad spend is on item IDs that could not be matched to a product, and is not labelled.'
    )
  }

  const assignment = assign(entities, buckets)

  const now = new Date().toISOString()
  const members = entities
    .filter((e) => assignment.has(e.ref))
    .map((e) => ({
      bucket_id: assignment.get(e.ref)!,
      ref: e.ref,
      product_ref: e.productRef,
    }))

  // Full replace for THIS label, in one transaction (migration 039). Membership
  // is derived, so a partial update would leave stale rows for entities that no
  // longer match — and a partial replace is worse still: the page would show
  // counts that are wrong rather than merely out of date, with no way to tell.
  const { data: inserted, error: replaceErr } = await db.rpc('google_ads_replace_label_members', {
    p_feed_id: feedId,
    p_label_id: label.id,
    p_level: level,
    p_members: members,
    p_computed_at: now,
  })
  if (replaceErr) dbError('recomputeOne/replace', replaceErr)

  const perBucket = orderBuckets(buckets).map((b) => ({
    id: b.id,
    name: b.name,
    value: b.value,
    count: [...assignment.values()].filter((v) => v === b.id).length,
  }))

  let moved = 0
  for (const [ref, bucketId] of assignment) {
    if (previous.get(ref) !== bucketId) moved++
  }

  // Row count as the database actually wrote it, not as we intended to write it.
  const assigned = Number(inserted ?? assignment.size)

  return {
    labelId: label.id,
    name: label.name,
    slot: label.slot,
    level,
    windowDays,
    entities: entities.length,
    withData: entities.filter((e) => e.hasData).length,
    assigned,
    unlabelled: entities.length - assigned,
    moved,
    perBucket,
    warnings,
  }
}

/** Previous membership per label, read BEFORE any rewrite, for "what changed". */
async function previousMembership(
  db: SupabaseClient,
  feedId: string
): Promise<Map<string, Map<string, string>>> {
  const { data } = await db
    .from('google_ads_bucket_members')
    .select('label_id, ref, bucket_id')
    .eq('feed_id', feedId)

  const out = new Map<string, Map<string, string>>()
  for (const r of (data ?? []) as { label_id: string; ref: string; bucket_id: string }[]) {
    let m = out.get(r.label_id)
    if (!m) out.set(r.label_id, (m = new Map()))
    m.set(r.ref, r.bucket_id)
  }
  return out
}

/**
 * Recompute every label on the feed.
 *
 * Each label is replaced in its own transaction, on purpose: they are
 * independent analyses, so if the third of five fails the first two are whole
 * and correctly stamped — more useful than rolling all five back, and far
 * better than leaving one half-written.
 */
export async function recomputeFeed(
  db: SupabaseClient,
  feedId: string
): Promise<RecomputeResult> {
  const settings = await getFeedSettings(db, feedId)
  if (!settings) throw new AppError('Google Ads is not set up for this feed.')

  const labels = await listLabels(db, feedId)
  const allBuckets = await listBuckets(db, feedId)
  const previous = await previousMembership(db, feedId)
  const build = entityBuilder(db, feedId, settings)

  const results: LabelResult[] = []
  for (const label of labels) {
    results.push(
      await recomputeOne(
        db,
        feedId,
        settings,
        label,
        allBuckets.filter((b) => b.label_id === label.id),
        build,
        previous.get(label.id) ?? new Map()
      )
    )
  }

  return { labels: results, warnings: feedWarnings(settings) }
}

/** Recompute a single dimension, leaving the others exactly as they were. */
export async function recomputeLabel(
  db: SupabaseClient,
  feedId: string,
  labelId: string
): Promise<RecomputeResult> {
  const settings = await getFeedSettings(db, feedId)
  if (!settings) throw new AppError('Google Ads is not set up for this feed.')

  const label = await getLabel(db, feedId, labelId)
  if (!label) throw new AppError('That custom label does not exist on this feed.')

  const previous = await previousMembership(db, feedId)
  const result = await recomputeOne(
    db,
    feedId,
    settings,
    label,
    await listBuckets(db, feedId, labelId),
    entityBuilder(db, feedId, settings),
    previous.get(labelId) ?? new Map()
  )

  return { labels: [result], warnings: feedWarnings(settings) }
}

// ── No starter set ───────────────────────────────────────────────────────────
//
// There was a starterLabel() here: one "Performance" dimension with six values
// and thresholds picked by a developer. It was removed at the operator's
// request. The thresholds are a commercial judgement — 25 clicks before you can
// judge a product, POAS 2 to call something a hero — and offering a guess as a
// "suggested set" is how a guess becomes the default nobody revisits.
//
// Templates are coming from the person who runs the accounts. They will be
// several named options rather than one hardcoded dimension, so the shape here
// will be a registry, not a single function. The UI keeps a disabled "Use
// suggested set" button as the placeholder for it.
// ─────────────────────────────────────────────────────────────────────────────
