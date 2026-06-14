// Run + persistence for AI title optimization.
//
// planRun is the pure skip/re-run decision over a scope (with human_edited
// protection). runTitleOptimization executes a run: scope → planRun →
// only-changed filter → optimizeBatch → upsert product_title_optimizations.
//
// Re-run invariant: a product that already has a row is re-optimized from its
// stored original_title (NOT optimized_title) plus the current product data —
// never feeding a previous AI title back in. original_title and source_hash are
// carried by the OptimizationOutcome (optimizeOne stamps them from the
// OptimizerProduct we pass), so persistence maps outcomes directly.

import { adminDb } from '@/lib/feeds'
import type { SupabaseProduct } from '@/lib/sync'
import {
  getOptimizationScope,
  type OptimizationScope,
} from '@/lib/titleOptimizationScope'
import {
  createOptimizerClient,
  optimizeBatch,
  toOptimizerProduct,
  sourceHash,
  type OptimizationOutcome,
  type OptimizerConfig,
  type OptimizerProduct,
  type TitleMethod,
  type TitleRule,
} from '@/lib/titleOptimizer'

// Whether to re-do already-optimized products, and whether that also includes
// human-edited ones. human_edited needs BOTH flags — the double opt-in that
// protects manual work from accidental overwrite.
export type RerunChoice = { rerun: boolean; includeHumanEdited: boolean }

export type RunPlan = {
  toProcess: SupabaseProduct[] // products that will be optimized
  skippedExisting: string[] // ai_generated/needs_review skipped because !rerun
  skippedProtected: string[] // human_edited skipped (protected)
}

export type RunResult = {
  inScope: number
  processed: number
  accepted: number // status 'ai_generated'
  needsReview: number // status 'needs_review'
  skippedExisting: number
  skippedProtected: number
  skippedUnchanged: number // source_hash matched (only-changed)
}

// Pure decision: which in-scope products this run will touch.
export function planRun(scope: OptimizationScope, choice: RerunChoice): RunPlan {
  const toProcess: SupabaseProduct[] = []
  const skippedExisting: string[] = []
  const skippedProtected: string[] = []

  for (const p of scope.products) {
    const existing = scope.existingByRef.get(p.shopify_id)
    if (!existing) {
      toProcess.push(p) // never optimized → always
    } else if (existing.status === 'human_edited') {
      if (choice.rerun && choice.includeHumanEdited) toProcess.push(p)
      else skippedProtected.push(p.shopify_id)
    } else {
      // ai_generated | needs_review → only on re-run
      if (choice.rerun) toProcess.push(p)
      else skippedExisting.push(p.shopify_id)
    }
  }

  return { toProcess, skippedExisting, skippedProtected }
}

// Builds the OptimizerProduct for a product, overriding the title with the
// stored original_title when one exists (re-run source).
function toScopedOptimizerProduct(
  product: SupabaseProduct,
  scope: OptimizationScope
): OptimizerProduct {
  const op = toOptimizerProduct(product)
  const existing = scope.existingByRef.get(product.shopify_id)
  if (existing) op.title = existing.original_title
  return op
}

export async function runTitleOptimization(
  feedId: string,
  method: TitleMethod,
  choice: RerunChoice,
  config: OptimizerConfig,
  opts: {
    rulesByType?: Map<string, TitleRule>
    skipUnchanged?: boolean // only-changed: skip ai_generated rows whose source_hash is unchanged
    concurrency?: number
  } = {}
): Promise<RunResult> {
  const { rulesByType = new Map(), skipUnchanged = false, concurrency = 5 } = opts

  const scope = await getOptimizationScope(feedId)
  const plan = planRun(scope, choice)

  // Map to OptimizerProducts (title overridden to original_title for re-runs).
  // Dedupe by product_ref defensively — the upsert key is (feed_id, product_ref),
  // so a duplicate would both waste an API call and crash the ON CONFLICT batch.
  const seenRefs = new Set<string>()
  let candidates = plan.toProcess
    .map((p) => toScopedOptimizerProduct(p, scope))
    .filter((op) => (seenRefs.has(op.product_ref) ? false : (seenRefs.add(op.product_ref), true)))

  // Only-changed: drop ai_generated products whose input data hasn't changed
  // since last time (same source_hash) — saves API calls on syncs. needs_review
  // and brand-new products are always (re)processed.
  let skippedUnchanged = 0
  if (skipUnchanged) {
    candidates = candidates.filter((op) => {
      const existing = scope.existingByRef.get(op.product_ref)
      if (existing?.status === 'ai_generated' && existing.source_hash === sourceHash(op)) {
        skippedUnchanged++
        return false
      }
      return true
    })
  }

  let accepted = 0
  let needsReview = 0

  if (candidates.length > 0) {
    const client = createOptimizerClient()
    const outcomes = await optimizeBatch(client, candidates, method, config, rulesByType, concurrency)
    for (const o of outcomes) {
      if (o.validation.ok) accepted++
      else needsReview++
    }
    await persistOutcomes(feedId, outcomes)
  }

  return {
    inScope: scope.summary.inScope,
    processed: candidates.length,
    accepted,
    needsReview,
    skippedExisting: plan.skippedExisting.length,
    skippedProtected: plan.skippedProtected.length,
    skippedUnchanged,
  }
}

// Maps an outcome to a product_title_optimizations row. status derives from
// validation; optimized_title is null on failure (satisfies the invariant CHECK).
function outcomeToRow(feedId: string, o: OptimizationOutcome) {
  const ok = o.validation.ok
  return {
    feed_id: feedId,
    product_ref: o.product_ref,
    status: ok ? 'ai_generated' : 'needs_review',
    original_title: o.original_title,
    proposed_title: o.proposed_title,
    optimized_title: o.optimized_title,
    method: o.method,
    source_hash: o.source_hash,
    validation_issues: ok ? null : o.validation.issues,
    updated_at: new Date().toISOString(),
  }
}

// Upserts outcomes into product_title_optimizations (chunked). Shared by the
// full run and the chunked per-refs run used by the UI.
export async function persistOutcomes(
  feedId: string,
  outcomes: OptimizationOutcome[]
): Promise<void> {
  if (outcomes.length === 0) return
  const db = adminDb()
  const rows = outcomes.map((o) => outcomeToRow(feedId, o))
  const CHUNK = 500
  for (let i = 0; i < rows.length; i += CHUNK) {
    const { error } = await db
      .from('product_title_optimizations')
      .upsert(rows.slice(i, i + CHUNK), { onConflict: 'feed_id,product_ref' })
    if (error) throw new Error(`Upsert of optimizations failed: ${error.message}`)
  }
}
