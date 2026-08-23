// Cost of goods per variant, and the product margins derived from it.
//
// THE RULE THAT SHAPES THIS FILE: an unentered cost is not a cost of zero.
//
// A merchant who has never filled in "Cost per item" has an unknown margin. If
// that rendered as 100% margin, every un-costed product would sort to the top of
// any "most profitable" view and straight into a bidding-up bucket. So unit_cost
// is nullable end to end, margin is null unless something is actually known, and
// every surface reports coverage alongside the number.
//
// Cost sync is separate from product sync on purpose: cost lives on
// inventoryItem (GraphQL only, not in the REST product payload) and changes on a
// different rhythm than the catalogue.

import type { SupabaseClient } from '@supabase/supabase-js'
import { createShopifyClientForProject } from '@/lib/projectShopify'
import { AppError, dbError } from '@/lib/errors'

const UPSERT_CHUNK = 500

export type CostSyncResult = {
  products: number
  variants: number
  /** Variants where Shopify actually returned a cost. */
  costed: number
  durationMs: number
}

/** Pulls "Cost per item" for every variant in the feed and stores it. */
export async function syncVariantCosts(
  db: SupabaseClient,
  feedId: string
): Promise<CostSyncResult> {
  const t0 = Date.now()

  const { data: feedRow } = await db
    .from('feeds')
    .select('project_id')
    .eq('id', feedId)
    .maybeSingle()
  const projectId = (feedRow as { project_id: string | null } | null)?.project_id ?? null
  if (!projectId) throw new AppError('This feed has no project, so Shopify cannot be reached.')

  // Paged, because a large catalogue exceeds PostgREST's default row cap and a
  // silently truncated product list would silently truncate the cost data.
  const productIds: number[] = []
  const PAGE = 1000
  for (let page = 0; ; page++) {
    const { data, error } = await db
      .from('products')
      .select('shopify_id')
      .eq('feed_id', feedId)
      .order('shopify_id', { ascending: true })
      .range(page * PAGE, page * PAGE + PAGE - 1)
    if (error) dbError('syncVariantCosts/products', error)
    const rows = (data ?? []) as { shopify_id: string }[]
    for (const r of rows) {
      const n = Number(r.shopify_id)
      if (Number.isFinite(n)) productIds.push(n)
    }
    if (rows.length < PAGE) break
  }

  if (!productIds.length) {
    return { products: 0, variants: 0, costed: 0, durationMs: Date.now() - t0 }
  }

  const shopify = await createShopifyClientForProject(db, projectId)
  const costs = await shopify.fetchVariantCostsBulk(productIds)

  const now = new Date().toISOString()
  const rows = costs.map((c) => ({
    feed_id: feedId,
    product_ref: String(c.productId),
    variant_ref: String(c.variantId),
    unit_cost: c.unitCost,
    currency: c.currency,
    synced_at: now,
  }))

  // Upsert rather than replace: a batch that failed inside fetchVariantCostsBulk
  // returns no rows for those variants, and wiping first would turn a partial
  // fetch into deleted data. Stale beats missing here.
  for (let i = 0; i < rows.length; i += UPSERT_CHUNK) {
    const { error } = await db
      .from('variant_costs')
      .upsert(rows.slice(i, i + UPSERT_CHUNK), { onConflict: 'feed_id,variant_ref' })
    if (error) dbError('syncVariantCosts/upsert', error)
  }

  return {
    products: productIds.length,
    variants: rows.length,
    costed: rows.filter((r) => r.unit_cost !== null).length,
    durationMs: Date.now() - t0,
  }
}

// ── Margins ──────────────────────────────────────────────────────────────────

export type ProductMargin = {
  productRef: string
  variantsTotal: number
  variantsCosted: number
  priceSum: number
  costSum: number
  /** (price − cost) ÷ price over the costed variants. Null when nothing is known. */
  margin: number | null
  /** Gross profit per unit at list price, summed over the costed variants. */
  unitProfit: number | null
  /** How much of the product the margin actually covers, 0–1. */
  coverage: number
}

const num = (v: unknown): number => {
  const n = Number(v ?? 0)
  return Number.isFinite(n) ? n : 0
}

export async function getProductMargins(
  db: SupabaseClient,
  feedId: string
): Promise<Map<string, ProductMargin>> {
  const { data, error } = await db.rpc('product_cost_summary', { p_feed_id: feedId })
  if (error) dbError('getProductMargins', error)

  const out = new Map<string, ProductMargin>()
  for (const r of (data ?? []) as Record<string, unknown>[]) {
    const productRef = String(r.product_ref ?? '')
    if (!productRef) continue

    const variantsTotal = num(r.variants_total)
    const variantsCosted = num(r.variants_costed)
    const priceSum = num(r.price_sum)
    const costSum = num(r.cost_sum)

    // No costed variant, or a zero price to divide by, means we do not know —
    // which is a different answer from a margin of zero.
    const known = variantsCosted > 0 && priceSum > 0

    out.set(productRef, {
      productRef,
      variantsTotal,
      variantsCosted,
      priceSum,
      costSum,
      margin: known ? (priceSum - costSum) / priceSum : null,
      unitProfit: known ? priceSum - costSum : null,
      coverage: variantsTotal > 0 ? variantsCosted / variantsTotal : 0,
    })
  }
  return out
}

/** Feed-wide coverage, for telling the user how much to trust the column. */
export function marginCoverage(margins: Map<string, ProductMargin>): {
  products: number
  withMargin: number
  variants: number
  variantsCosted: number
} {
  let variants = 0
  let variantsCosted = 0
  let withMargin = 0
  for (const m of margins.values()) {
    variants += m.variantsTotal
    variantsCosted += m.variantsCosted
    if (m.margin !== null) withMargin++
  }
  return { products: margins.size, withMargin, variants, variantsCosted }
}
