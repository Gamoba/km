// Bucket layer for AI title optimization.
//
// A bucket = a named (filter + method + rules) unit within a feed, with an
// EXPLICIT, frozen product membership (bucket_products) — not the filter
// recomputed on the fly. One product belongs to exactly one bucket per feed
// (UNIQUE(feed_id, product_ref)). This module is the headless-testable service
// for buckets: CRUD, membership/overlap, per-bucket filters/rules, and the run.
//
// Membership ≠ optimized title: membership lives in bucket_products; produced
// titles live in product_title_optimizations (now stamped with bucket_id).

import { adminDb } from '@/lib/feeds'
import type { SupabaseProduct } from '@/lib/sync'
import { applyFeedFilters, type FeedFilter } from '@/lib/feedFilters'
import {
  fetchAllActiveProducts,
  type OptimizationScope,
  type ExistingStatus,
  type ExistingOptimization,
  type OverlapSummary,
} from '@/lib/titleOptimizationScope'
import {
  planRun,
  persistOutcomes,
  type RerunChoice,
} from '@/lib/titleOptimizationRun'
import {
  createOptimizerClient,
  optimizeBatch,
  toOptimizerProduct,
  localeToLanguage,
  type OptimizationOutcome,
  type OptimizerConfig,
  type OptimizerProduct,
  type TitleMethod,
  type TitleRule,
} from '@/lib/titleOptimizer'
import { getOptimizationSettings, type OptFilterConfig } from '@/lib/titleOptimizationService'

const IN_CHUNK = 200 // cap .in() list size to stay under URL limits

// ── Types ────────────────────────────────────────────────────────────────────

export type BucketMethod = 'auto' | 'rule_based'

export type Bucket = {
  id: string
  feed_id: string
  name: string
  method: BucketMethod
  created_at: string
  updated_at: string
}

export type BucketSummary = Bucket & {
  memberCount: number
  aiGenerated: number
  humanEdited: number
  needsReview: number
}

// A candidate product that already belongs to a DIFFERENT bucket.
export type BucketConflict = {
  product_ref: string
  bucketId: string
  bucketName: string
  status: ExistingStatus | null
}

// ── Internal helpers ─────────────────────────────────────────────────────────

function db() {
  return adminDb()
}

// Verifies the bucket exists in this feed (ownership belt — callers also pass
// through getOwnedFeed at the action layer).
export async function getBucket(feedId: string, bucketId: string): Promise<Bucket | null> {
  const { data } = await db()
    .from('optimization_buckets')
    .select('*')
    .eq('id', bucketId)
    .eq('feed_id', feedId)
    .maybeSingle()
  return (data as Bucket | null) ?? null
}

// Fetches products (with metafields) for a set of refs, chunking the .in() list.
async function fetchProductsByRefs(feedId: string, refs: string[]): Promise<SupabaseProduct[]> {
  const out: SupabaseProduct[] = []
  for (let i = 0; i < refs.length; i += IN_CHUNK) {
    const { data, error } = await db()
      .from('products')
      .select('*, metafields:product_metafields(*)')
      .eq('feed_id', feedId)
      .in('shopify_id', refs.slice(i, i + IN_CHUNK))
    if (error) throw new Error(`Products failed: ${error.message}`)
    out.push(...((data ?? []) as SupabaseProduct[]))
  }
  return out
}

// Builds the run config (per-feed settings + market language) and the bucket's
// rule map (only for rule_based).
async function buildBucketContext(
  feedId: string,
  bucketId: string,
  method: TitleMethod
): Promise<{ config: OptimizerConfig; rulesByType: Map<string, TitleRule> }> {
  const [settings, { data: shopSettings }] = await Promise.all([
    getOptimizationSettings(feedId),
    db().from('shop_settings').select('selected_locale').eq('feed_id', feedId).maybeSingle(),
  ])
  const config: OptimizerConfig = {
    charLimit: settings.charLimit,
    targetLanguage: localeToLanguage(shopSettings?.selected_locale as string | null),
    fewShotExamples: settings.fewShotExamples,
    model: settings.model ?? undefined,
    temperature: settings.temperature ?? undefined,
  }
  const rulesByType = new Map<string, TitleRule>()
  if (method === 'rule_based') {
    for (const rule of await getBucketRules(feedId, bucketId)) rulesByType.set(rule.product_type, rule)
  }
  return { config, rulesByType }
}

function buildOp(product: SupabaseProduct, originalTitle?: string): OptimizerProduct {
  const op = toOptimizerProduct(product)
  if (originalTitle !== undefined) op.title = originalTitle
  return op
}

// ── Bucket CRUD ──────────────────────────────────────────────────────────────

export async function listBuckets(feedId: string): Promise<BucketSummary[]> {
  const [{ data: buckets }, { data: members }, { data: opts }] = await Promise.all([
    db().from('optimization_buckets').select('*').eq('feed_id', feedId).order('created_at', { ascending: true }),
    db().from('bucket_products').select('bucket_id').eq('feed_id', feedId),
    db()
      .from('product_title_optimizations')
      .select('bucket_id, status')
      .eq('feed_id', feedId)
      .not('bucket_id', 'is', null),
  ])

  const memberCount = new Map<string, number>()
  for (const m of (members ?? []) as { bucket_id: string }[]) {
    memberCount.set(m.bucket_id, (memberCount.get(m.bucket_id) ?? 0) + 1)
  }

  const statusCount = new Map<string, { ai: number; human: number; review: number }>()
  for (const o of (opts ?? []) as { bucket_id: string; status: ExistingStatus }[]) {
    const s = statusCount.get(o.bucket_id) ?? { ai: 0, human: 0, review: 0 }
    if (o.status === 'ai_generated') s.ai++
    else if (o.status === 'human_edited') s.human++
    else s.review++
    statusCount.set(o.bucket_id, s)
  }

  return ((buckets ?? []) as Bucket[]).map((b) => {
    const s = statusCount.get(b.id) ?? { ai: 0, human: 0, review: 0 }
    return {
      ...b,
      memberCount: memberCount.get(b.id) ?? 0,
      aiGenerated: s.ai,
      humanEdited: s.human,
      needsReview: s.review,
    }
  })
}

export async function createBucket(
  feedId: string,
  name: string,
  method: BucketMethod
): Promise<Bucket> {
  const trimmed = name.trim()
  if (!trimmed) throw new Error('Bucket-navn må ikke være tomt')
  const { data, error } = await db()
    .from('optimization_buckets')
    .insert({ feed_id: feedId, name: trimmed, method })
    .select('*')
    .single()
  if (error) throw new Error(error.message)
  return data as Bucket
}

export async function renameBucket(feedId: string, bucketId: string, name: string): Promise<void> {
  const trimmed = name.trim()
  if (!trimmed) throw new Error('Bucket-navn må ikke være tomt')
  const { error } = await db()
    .from('optimization_buckets')
    .update({ name: trimmed, updated_at: new Date().toISOString() })
    .eq('id', bucketId)
    .eq('feed_id', feedId)
  if (error) throw new Error(error.message)
}

export async function setBucketMethod(
  feedId: string,
  bucketId: string,
  method: BucketMethod
): Promise<void> {
  const { error } = await db()
    .from('optimization_buckets')
    .update({ method, updated_at: new Date().toISOString() })
    .eq('id', bucketId)
    .eq('feed_id', feedId)
  if (error) throw new Error(error.message)
}

export async function deleteBucket(feedId: string, bucketId: string): Promise<void> {
  const { error } = await db()
    .from('optimization_buckets')
    .delete()
    .eq('id', bucketId)
    .eq('feed_id', feedId)
  if (error) throw new Error(error.message)
}

// ── Per-bucket filters ───────────────────────────────────────────────────────

export async function getBucketFilters(
  bucketId: string
): Promise<{ include: OptFilterConfig; exclude: OptFilterConfig }> {
  const { data } = await db()
    .from('title_optimization_filters')
    .select('filter_type, operator, rules')
    .eq('bucket_id', bucketId)
  const rows = (data ?? []) as { filter_type: string; operator: 'AND' | 'OR'; rules: OptFilterConfig['rules'] }[]
  const pick = (t: string): OptFilterConfig => {
    const r = rows.find((x) => x.filter_type === t)
    return r ? { operator: r.operator, rules: r.rules } : { operator: 'AND', rules: [] }
  }
  return { include: pick('include'), exclude: pick('exclude') }
}

export async function saveBucketFilters(
  feedId: string,
  bucketId: string,
  include: OptFilterConfig,
  exclude: OptFilterConfig
): Promise<void> {
  const { error } = await db()
    .from('title_optimization_filters')
    .upsert(
      [
        { feed_id: feedId, bucket_id: bucketId, filter_type: 'include', operator: include.operator, rules: include.rules },
        { feed_id: feedId, bucket_id: bucketId, filter_type: 'exclude', operator: exclude.operator, rules: exclude.rules },
      ],
      { onConflict: 'bucket_id,filter_type' }
    )
  if (error) throw new Error(error.message)
}

// ── Per-bucket rules (Method B) ──────────────────────────────────────────────

export async function getBucketRules(feedId: string, bucketId: string): Promise<TitleRule[]> {
  const { data } = await db()
    .from('title_rules')
    .select('product_type, priority_attributes, required_attributes, excluded_attributes')
    .eq('feed_id', feedId)
    .eq('bucket_id', bucketId)
  return ((data ?? []) as Record<string, unknown>[]).map((r) => ({
    product_type: r.product_type as string,
    priority_attributes: (r.priority_attributes as string[]) ?? [],
    required_attributes: (r.required_attributes as string[]) ?? [],
    excluded_attributes: (r.excluded_attributes as string[]) ?? [],
  }))
}

export async function saveBucketRule(
  feedId: string,
  bucketId: string,
  rule: TitleRule
): Promise<void> {
  const { error } = await db()
    .from('title_rules')
    .upsert(
      {
        feed_id: feedId,
        bucket_id: bucketId,
        product_type: rule.product_type,
        priority_attributes: rule.priority_attributes,
        required_attributes: rule.required_attributes,
        excluded_attributes: rule.excluded_attributes,
        updated_at: new Date().toISOString(),
      },
      { onConflict: 'bucket_id,product_type' }
    )
  if (error) throw new Error(error.message)
}

export async function deleteBucketRule(bucketId: string, productType: string): Promise<void> {
  const { error } = await db()
    .from('title_rules')
    .delete()
    .eq('bucket_id', bucketId)
    .eq('product_type', productType)
  if (error) throw new Error(error.message)
}

// ── Membership & overlap ─────────────────────────────────────────────────────

// Candidate refs from a (possibly unsaved) filter — applied via the shared
// applyFeedFilters, same as a feed filter.
export async function getBucketCandidates(
  feedId: string,
  include: OptFilterConfig,
  exclude: OptFilterConfig
): Promise<string[]> {
  const [{ data: ss }, products] = await Promise.all([
    db().from('shop_settings').select('market_url').eq('feed_id', feedId).maybeSingle(),
    fetchAllActiveProducts(db(), feedId),
  ])
  const marketUrl = (ss?.market_url as string | null) ?? null
  const filterRows: FeedFilter[] = [
    { filter_type: 'include', operator: include.operator, rules: include.rules },
    { filter_type: 'exclude', operator: exclude.operator, rules: exclude.rules },
  ]
  return applyFeedFilters(products, filterRows, marketUrl).map((p) => p.shopify_id)
}

export async function getBucketMembership(feedId: string, bucketId: string): Promise<string[]> {
  const { data } = await db()
    .from('bucket_products')
    .select('product_ref')
    .eq('feed_id', feedId)
    .eq('bucket_id', bucketId)
  return ((data ?? []) as { product_ref: string }[]).map((r) => r.product_ref)
}

// For a set of candidate refs, classifies them against existing membership:
// conflicts (in a DIFFERENT bucket), inThisBucket, and unassigned.
export async function getBucketOverlap(
  feedId: string,
  bucketId: string,
  candidateRefs: string[]
): Promise<{ conflicts: BucketConflict[]; inThisBucket: number; unassigned: number }> {
  if (candidateRefs.length === 0) return { conflicts: [], inThisBucket: 0, unassigned: 0 }

  const memberMap = new Map<string, string>() // ref -> bucket_id
  const statusByRef = new Map<string, ExistingStatus>()
  for (let i = 0; i < candidateRefs.length; i += IN_CHUNK) {
    const slice = candidateRefs.slice(i, i + IN_CHUNK)
    const [{ data: members }, { data: opts }] = await Promise.all([
      db().from('bucket_products').select('product_ref, bucket_id').eq('feed_id', feedId).in('product_ref', slice),
      db().from('product_title_optimizations').select('product_ref, status').eq('feed_id', feedId).in('product_ref', slice),
    ])
    for (const m of (members ?? []) as { product_ref: string; bucket_id: string }[]) memberMap.set(m.product_ref, m.bucket_id)
    for (const o of (opts ?? []) as { product_ref: string; status: ExistingStatus }[]) statusByRef.set(o.product_ref, o.status)
  }

  const otherBucketIds = [...new Set([...memberMap.values()].filter((b) => b !== bucketId))]
  const nameById = new Map<string, string>()
  if (otherBucketIds.length) {
    const { data: bks } = await db().from('optimization_buckets').select('id, name').in('id', otherBucketIds)
    for (const b of (bks ?? []) as { id: string; name: string }[]) nameById.set(b.id, b.name)
  }

  let inThisBucket = 0
  let unassigned = 0
  const conflicts: BucketConflict[] = []
  for (const ref of candidateRefs) {
    const b = memberMap.get(ref)
    if (!b) unassigned++
    else if (b === bucketId) inThisBucket++
    else conflicts.push({ product_ref: ref, bucketId: b, bucketName: nameById.get(b) ?? '(unknown)', status: statusByRef.get(ref) ?? null })
  }
  return { conflicts, inThisBucket, unassigned }
}

// Sets the bucket's membership to exactly `refs`. Upserting on (feed_id,
// product_ref) MOVES any ref currently in another bucket into this one
// (enforcing one-bucket-per-product); refs removed from this bucket are deleted.
export async function setBucketMembership(
  feedId: string,
  bucketId: string,
  refs: string[]
): Promise<void> {
  const unique = [...new Set(refs)]

  if (unique.length) {
    const rows = unique.map((product_ref) => ({ bucket_id: bucketId, feed_id: feedId, product_ref }))
    for (let i = 0; i < rows.length; i += 500) {
      const { error } = await db()
        .from('bucket_products')
        .upsert(rows.slice(i, i + 500), { onConflict: 'feed_id,product_ref' })
      if (error) throw new Error(error.message)
    }
  }

  // Delete rows that were in THIS bucket but are no longer wanted.
  const current = await getBucketMembership(feedId, bucketId)
  const keep = new Set(unique)
  const toDelete = current.filter((r) => !keep.has(r))
  for (let i = 0; i < toDelete.length; i += IN_CHUNK) {
    const { error } = await db()
      .from('bucket_products')
      .delete()
      .eq('feed_id', feedId)
      .eq('bucket_id', bucketId)
      .in('product_ref', toDelete.slice(i, i + IN_CHUNK))
    if (error) throw new Error(error.message)
  }
}

// ── Bucket scope (membership-based, for planRun) ─────────────────────────────

async function getBucketScope(feedId: string, bucketId: string): Promise<OptimizationScope> {
  const refs = await getBucketMembership(feedId, bucketId)
  const [{ data: ss }, products, existingRows] = await Promise.all([
    db().from('shop_settings').select('market_url').eq('feed_id', feedId).maybeSingle(),
    refs.length ? fetchProductsByRefs(feedId, refs) : Promise.resolve([] as SupabaseProduct[]),
    refs.length ? fetchExistingByRefs(feedId, refs) : Promise.resolve([] as ExistingRow[]),
  ])

  const marketUrl = (ss?.market_url as string | null) ?? null
  const existingByRef = new Map<string, ExistingOptimization>()
  for (const r of existingRows) {
    existingByRef.set(r.product_ref, { status: r.status, original_title: r.original_title, source_hash: r.source_hash })
  }

  const summary: OverlapSummary = {
    inScope: products.length,
    alreadyOptimized: 0,
    humanEdited: 0,
    needsReview: 0,
    notYetOptimized: 0,
  }
  for (const p of products) {
    const e = existingByRef.get(p.shopify_id)
    if (!e) summary.notYetOptimized++
    else if (e.status === 'ai_generated') summary.alreadyOptimized++
    else if (e.status === 'human_edited') summary.humanEdited++
    else summary.needsReview++
  }

  return { feedId, marketUrl, products, existingByRef, summary }
}

type ExistingRow = { product_ref: string; status: ExistingStatus; original_title: string; source_hash: string | null }

async function fetchExistingByRefs(feedId: string, refs: string[]): Promise<ExistingRow[]> {
  const out: ExistingRow[] = []
  for (let i = 0; i < refs.length; i += IN_CHUNK) {
    const { data } = await db()
      .from('product_title_optimizations')
      .select('product_ref, status, original_title, source_hash')
      .eq('feed_id', feedId)
      .in('product_ref', refs.slice(i, i + IN_CHUNK))
    out.push(...((data ?? []) as ExistingRow[]))
  }
  return out
}

// ── Run a bucket ─────────────────────────────────────────────────────────────

// Plan: which membership refs a run would process (skip/re-run/human-edited),
// plus the membership overlap summary. The UI chunks `targets` through runBucketRefs.
export async function planBucketRun(
  feedId: string,
  bucketId: string,
  choice: RerunChoice
): Promise<{ targets: string[]; summary: OverlapSummary }> {
  const scope = await getBucketScope(feedId, bucketId)
  const plan = planRun(scope, choice)
  const targets = [...new Set(plan.toProcess.map((p) => p.shopify_id))]
  return { targets, summary: scope.summary }
}

// Runs the optimizer for a chunk of the bucket's targets, persists with
// bucket_id, returns outcomes. Re-run source is the stored original_title.
export async function runBucketRefs(
  feedId: string,
  bucketId: string,
  refs: string[]
): Promise<OptimizationOutcome[]> {
  if (refs.length === 0) return []
  const bucket = await getBucket(feedId, bucketId)
  if (!bucket) throw new Error('Bucket ikke fundet')

  const { config, rulesByType } = await buildBucketContext(feedId, bucketId, bucket.method)
  const [products, existing] = await Promise.all([
    fetchProductsByRefs(feedId, refs),
    fetchExistingByRefs(feedId, refs),
  ])
  const origByRef = new Map(existing.map((r) => [r.product_ref, r.original_title]))
  const ops = products.map((p) => buildOp(p, origByRef.get(p.shopify_id)))

  const client = createOptimizerClient()
  const outcomes = await optimizeBatch(client, ops, bucket.method, config, rulesByType)
  await persistOutcomes(feedId, outcomes, bucketId)
  return outcomes
}

// Dry run on a sample of the bucket's membership — no persist (experimentation).
export async function previewBucket(
  feedId: string,
  bucketId: string,
  limit: number
): Promise<OptimizationOutcome[]> {
  const bucket = await getBucket(feedId, bucketId)
  if (!bucket) throw new Error('Bucket ikke fundet')
  const refs = (await getBucketMembership(feedId, bucketId)).slice(0, Math.max(1, Math.min(limit, 50)))
  if (refs.length === 0) return []

  const { config, rulesByType } = await buildBucketContext(feedId, bucketId, bucket.method)
  const [products, existing] = await Promise.all([
    fetchProductsByRefs(feedId, refs),
    fetchExistingByRefs(feedId, refs),
  ])
  const origByRef = new Map(existing.map((r) => [r.product_ref, r.original_title]))
  const ops = products.map((p) => buildOp(p, origByRef.get(p.shopify_id)))

  const client = createOptimizerClient()
  return optimizeBatch(client, ops, bucket.method, config, rulesByType)
}
