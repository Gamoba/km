// Service layer for AI title optimization — all the read/write logic the UI
// needs, as plain headless-testable functions (DB via adminDb). The server
// actions in app/optimize/actions.ts are thin getOwnedFeed-guarded wrappers
// around these.

import { adminDb } from '@/lib/feeds'
import type { SupabaseProduct } from '@/lib/sync'
import { getOptimizationScope, type OverlapSummary } from '@/lib/titleOptimizationScope'
import type { FeedFilter } from '@/lib/feedFilters'
import {
  runTitleOptimization,
  planRun,
  persistOutcomes,
  type RerunChoice,
  type RunResult,
} from '@/lib/titleOptimizationRun'
import {
  createOptimizerClient,
  optimizeBatch,
  toOptimizerProduct,
  localeToLanguage,
  DEFAULT_CHAR_LIMIT,
  type OptimizationOutcome,
  type OptimizerConfig,
  type OptimizerProduct,
  type TitleMethod,
  type TitleRule,
} from '@/lib/titleOptimizer'

// ── Settings ─────────────────────────────────────────────────────────────────

export type OptimizationSettings = {
  charLimit: number
  fewShotExamples: string
  model: string | null
  temperature: number | null
}

const DEFAULT_SETTINGS: OptimizationSettings = {
  charLimit: DEFAULT_CHAR_LIMIT,
  fewShotExamples: '',
  model: null,
  temperature: null,
}

export async function getOptimizationSettings(feedId: string): Promise<OptimizationSettings> {
  const db = adminDb()
  const { data } = await db
    .from('title_optimization_settings')
    .select('char_limit, few_shot_examples, model, temperature')
    .eq('feed_id', feedId)
    .maybeSingle()
  if (!data) return { ...DEFAULT_SETTINGS }
  return {
    charLimit: (data.char_limit as number) ?? DEFAULT_CHAR_LIMIT,
    fewShotExamples: (data.few_shot_examples as string) ?? '',
    model: (data.model as string | null) ?? null,
    temperature: (data.temperature as number | null) ?? null,
  }
}

export async function saveOptimizationSettings(
  feedId: string,
  settings: OptimizationSettings
): Promise<void> {
  const db = adminDb()
  const { error } = await db.from('title_optimization_settings').upsert(
    {
      feed_id: feedId,
      char_limit: settings.charLimit,
      few_shot_examples: settings.fewShotExamples,
      model: settings.model,
      temperature: settings.temperature,
      updated_at: new Date().toISOString(),
    },
    { onConflict: 'feed_id' }
  )
  if (error) throw new Error(error.message)
}

// ── Optimization filters (the separate scope filter set) ─────────────────────

export type OptFilterRule = { field: string; operator: string; value: string }
export type OptFilterConfig = { operator: 'AND' | 'OR'; rules: OptFilterRule[] }

export async function getOptimizationFilters(
  feedId: string
): Promise<{ include: OptFilterConfig; exclude: OptFilterConfig }> {
  const db = adminDb()
  const { data } = await db
    .from('title_optimization_filters')
    .select('filter_type, operator, rules')
    .eq('feed_id', feedId)
  const empty: OptFilterConfig = { operator: 'AND', rules: [] }
  const rows = (data ?? []) as { filter_type: string; operator: 'AND' | 'OR'; rules: OptFilterRule[] }[]
  const pick = (t: string): OptFilterConfig => {
    const r = rows.find((x) => x.filter_type === t)
    return r ? { operator: r.operator, rules: r.rules } : { ...empty }
  }
  return { include: pick('include'), exclude: pick('exclude') }
}

export async function saveOptimizationFilters(
  feedId: string,
  include: OptFilterConfig,
  exclude: OptFilterConfig
): Promise<void> {
  const db = adminDb()
  const { error } = await db.from('title_optimization_filters').upsert(
    [
      { feed_id: feedId, filter_type: 'include', operator: include.operator, rules: include.rules },
      { feed_id: feedId, filter_type: 'exclude', operator: exclude.operator, rules: exclude.rules },
    ],
    { onConflict: 'feed_id,filter_type' }
  )
  if (error) throw new Error(error.message)
}

// ── Overlap (pre-run summary) ────────────────────────────────────────────────

// Only the counts cross to the client — never the product list.
export async function getOptimizationOverlap(feedId: string): Promise<OverlapSummary> {
  const scope = await getOptimizationScope(feedId)
  return scope.summary
}

// Overlap for an UNSAVED filter set — powers the Scope editor's live "X in
// scope" as the user edits, via the same applyFeedFilters as a real run.
export async function getOptimizationOverlapForFilters(
  feedId: string,
  include: OptFilterConfig,
  exclude: OptFilterConfig
): Promise<OverlapSummary> {
  const filterRows: FeedFilter[] = [
    { filter_type: 'include', operator: include.operator, rules: include.rules },
    { filter_type: 'exclude', operator: exclude.operator, rules: exclude.rules },
  ]
  const scope = await getOptimizationScope(feedId, filterRows)
  return scope.summary
}

// ── Method B rules ───────────────────────────────────────────────────────────

export async function getTitleRules(feedId: string): Promise<TitleRule[]> {
  const db = adminDb()
  const { data } = await db
    .from('title_rules')
    .select('product_type, priority_attributes, required_attributes, excluded_attributes')
    .eq('feed_id', feedId)
  return ((data ?? []) as Record<string, unknown>[]).map((r) => ({
    product_type: r.product_type as string,
    priority_attributes: (r.priority_attributes as string[]) ?? [],
    required_attributes: (r.required_attributes as string[]) ?? [],
    excluded_attributes: (r.excluded_attributes as string[]) ?? [],
  }))
}

export async function saveTitleRule(feedId: string, rule: TitleRule): Promise<void> {
  const db = adminDb()
  const { error } = await db.from('title_rules').upsert(
    {
      feed_id: feedId,
      product_type: rule.product_type,
      priority_attributes: rule.priority_attributes,
      required_attributes: rule.required_attributes,
      excluded_attributes: rule.excluded_attributes,
      updated_at: new Date().toISOString(),
    },
    { onConflict: 'feed_id,product_type' }
  )
  if (error) throw new Error(error.message)
}

export async function deleteTitleRule(feedId: string, productType: string): Promise<void> {
  const db = adminDb()
  const { error } = await db
    .from('title_rules')
    .delete()
    .eq('feed_id', feedId)
    .eq('product_type', productType)
  if (error) throw new Error(error.message)
}

// ── Manual edit ──────────────────────────────────────────────────────────────

// Sets a human-edited title. Preserves original_title (the re-run source) from
// any existing row; for a product with no prior row, original_title is the
// current Shopify title. status becomes 'human_edited' (protected on re-runs).
export async function saveManualTitle(
  feedId: string,
  productRef: string,
  title: string
): Promise<void> {
  const db = adminDb()
  const trimmed = title.trim()
  if (!trimmed) throw new Error('Titel må ikke være tom')

  const { data: existing } = await db
    .from('product_title_optimizations')
    .select('original_title, proposed_title, method, source_hash')
    .eq('feed_id', feedId)
    .eq('product_ref', productRef)
    .maybeSingle()

  let originalTitle = existing?.original_title as string | undefined
  if (originalTitle === undefined) {
    const { data: product } = await db
      .from('products')
      .select('title')
      .eq('feed_id', feedId)
      .eq('shopify_id', productRef)
      .maybeSingle()
    originalTitle = (product?.title as string | null) ?? trimmed
  }

  const { error } = await db.from('product_title_optimizations').upsert(
    {
      feed_id: feedId,
      product_ref: productRef,
      status: 'human_edited',
      original_title: originalTitle,
      proposed_title: (existing?.proposed_title as string | null) ?? null,
      optimized_title: trimmed,
      method: (existing?.method as string | null) ?? null,
      source_hash: (existing?.source_hash as string | null) ?? null,
      validation_issues: null,
      updated_at: new Date().toISOString(),
    },
    { onConflict: 'feed_id,product_ref' }
  )
  if (error) throw new Error(error.message)
}

// ── Run ──────────────────────────────────────────────────────────────────────

// Builds the run config (settings + market language) and the rule map for the
// chosen method — shared by the full run, preview, and chunked run.
type RunContext = { config: OptimizerConfig; rulesByType: Map<string, TitleRule> }

async function buildRunContext(feedId: string, method: TitleMethod): Promise<RunContext> {
  const db = adminDb()
  const [settings, { data: shopSettings }] = await Promise.all([
    getOptimizationSettings(feedId),
    db.from('shop_settings').select('selected_locale').eq('feed_id', feedId).maybeSingle(),
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
    for (const rule of await getTitleRules(feedId)) rulesByType.set(rule.product_type, rule)
  }
  return { config, rulesByType }
}

// Re-run source: stored original_title when one exists, else the product title.
function buildOp(product: SupabaseProduct, originalTitle?: string): OptimizerProduct {
  const op = toOptimizerProduct(product)
  if (originalTitle !== undefined) op.title = originalTitle
  return op
}

// Full run (all in-scope, respecting the choice). Counts only — used by the
// non-chunked path / future sync.
export async function runOptimization(
  feedId: string,
  method: TitleMethod,
  choice: RerunChoice
): Promise<RunResult> {
  const { config, rulesByType } = await buildRunContext(feedId, method)
  return runTitleOptimization(feedId, method, choice, config, { rulesByType })
}

// Returns the product_refs a run would process (post skip/re-run decision) plus
// the overlap summary — the UI uses targets.length as the progress total and
// chunks the targets through runOptimizationForRefs.
export type RunPlanSummary = { targets: string[]; summary: OverlapSummary }

export async function planOptimization(
  feedId: string,
  choice: RerunChoice
): Promise<RunPlanSummary> {
  const scope = await getOptimizationScope(feedId)
  const plan = planRun(scope, choice)
  const targets = [...new Set(plan.toProcess.map((p) => p.shopify_id))]
  return { targets, summary: scope.summary }
}

// Dry run on the first `limit` in-scope products — generates titles WITHOUT
// persisting, for experimenting (e.g. before few-shot examples are set). Capped.
export async function previewOptimization(
  feedId: string,
  method: TitleMethod,
  limit: number
): Promise<OptimizationOutcome[]> {
  const scope = await getOptimizationScope(feedId)
  const n = Math.max(1, Math.min(limit, 50))
  const sample = scope.products.slice(0, n)
  const ops = sample.map((p) => buildOp(p, scope.existingByRef.get(p.shopify_id)?.original_title))
  const { config, rulesByType } = await buildRunContext(feedId, method)
  const client = createOptimizerClient()
  return optimizeBatch(client, ops, method, config, rulesByType)
}

// Runs the optimizer for a specific set of product_refs (a chunk from
// planOptimization.targets), persists, and returns outcomes for display. The
// refs are already filtered by the plan, so the choice is not re-applied here.
export async function runOptimizationForRefs(
  feedId: string,
  method: TitleMethod,
  refs: string[]
): Promise<OptimizationOutcome[]> {
  if (refs.length === 0) return []
  const db = adminDb()
  const { config, rulesByType } = await buildRunContext(feedId, method)
  const [{ data: prods }, { data: ex }] = await Promise.all([
    db.from('products').select('*, metafields:product_metafields(*)').eq('feed_id', feedId).in('shopify_id', refs),
    db.from('product_title_optimizations').select('product_ref, original_title').eq('feed_id', feedId).in('product_ref', refs),
  ])
  const origByRef = new Map(
    ((ex ?? []) as { product_ref: string; original_title: string }[]).map((r) => [
      r.product_ref,
      r.original_title,
    ])
  )
  const ops = ((prods ?? []) as SupabaseProduct[]).map((p) => buildOp(p, origByRef.get(p.shopify_id)))
  const client = createOptimizerClient()
  const outcomes = await optimizeBatch(client, ops, method, config, rulesByType)
  await persistOutcomes(feedId, outcomes)
  return outcomes
}
