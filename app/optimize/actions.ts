'use server'

// Thin server actions for AI title optimization — auth + ownership (getOwnedFeed)
// then delegate to the headless service layer (lib/titleOptimizationService).
// Reads return { data } | { error }; mutations return { error? }.

import { createSupabaseServerClient } from '@/lib/supabase-server'
import { getOwnedFeed } from '@/lib/feeds'
import * as svc from '@/lib/titleOptimizationService'
import type { OverlapSummary } from '@/lib/titleOptimizationScope'
import type { RunResult, RerunChoice } from '@/lib/titleOptimizationRun'
import type { OptimizationOutcome, TitleMethod, TitleRule } from '@/lib/titleOptimizer'

// Resolves the caller and verifies they own the feed.
async function requireOwnedFeed(feedId: string): Promise<{ userId: string } | { error: string }> {
  const supabase = await createSupabaseServerClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return { error: 'Unauthorized' }
  const owned = await getOwnedFeed(user.id, feedId)
  if (!owned) return { error: 'Feed ikke fundet' }
  return { userId: user.id }
}

// ── Settings ─────────────────────────────────────────────────────────────────

export async function getOptimizationSettings(
  feedId: string
): Promise<{ data: svc.OptimizationSettings } | { error: string }> {
  const g = await requireOwnedFeed(feedId)
  if ('error' in g) return g
  try {
    return { data: await svc.getOptimizationSettings(feedId) }
  } catch (e) {
    return { error: (e as Error).message }
  }
}

export async function saveOptimizationSettings(
  feedId: string,
  settings: svc.OptimizationSettings
): Promise<{ error?: string }> {
  const g = await requireOwnedFeed(feedId)
  if ('error' in g) return g
  try {
    await svc.saveOptimizationSettings(feedId, settings)
    return {}
  } catch (e) {
    return { error: (e as Error).message }
  }
}

// ── Optimization filters ─────────────────────────────────────────────────────

export async function getOptimizationFilters(
  feedId: string
): Promise<{ data: { include: svc.OptFilterConfig; exclude: svc.OptFilterConfig } } | { error: string }> {
  const g = await requireOwnedFeed(feedId)
  if ('error' in g) return g
  try {
    return { data: await svc.getOptimizationFilters(feedId) }
  } catch (e) {
    return { error: (e as Error).message }
  }
}

export async function saveOptimizationFilters(
  feedId: string,
  include: svc.OptFilterConfig,
  exclude: svc.OptFilterConfig
): Promise<{ error?: string }> {
  const g = await requireOwnedFeed(feedId)
  if ('error' in g) return g
  try {
    await svc.saveOptimizationFilters(feedId, include, exclude)
    return {}
  } catch (e) {
    return { error: (e as Error).message }
  }
}

// ── Overlap ──────────────────────────────────────────────────────────────────

export async function getOptimizationOverlap(
  feedId: string
): Promise<{ data: OverlapSummary } | { error: string }> {
  const g = await requireOwnedFeed(feedId)
  if ('error' in g) return g
  try {
    return { data: await svc.getOptimizationOverlap(feedId) }
  } catch (e) {
    return { error: (e as Error).message }
  }
}

// Live overlap for an unsaved filter set (Scope editor preview).
export async function getOptimizationOverlapForFilters(
  feedId: string,
  include: svc.OptFilterConfig,
  exclude: svc.OptFilterConfig
): Promise<{ data: OverlapSummary } | { error: string }> {
  const g = await requireOwnedFeed(feedId)
  if ('error' in g) return g
  try {
    return { data: await svc.getOptimizationOverlapForFilters(feedId, include, exclude) }
  } catch (e) {
    return { error: (e as Error).message }
  }
}

// ── Method B rules ───────────────────────────────────────────────────────────

export async function getTitleRules(
  feedId: string
): Promise<{ data: TitleRule[] } | { error: string }> {
  const g = await requireOwnedFeed(feedId)
  if ('error' in g) return g
  try {
    return { data: await svc.getTitleRules(feedId) }
  } catch (e) {
    return { error: (e as Error).message }
  }
}

export async function saveTitleRule(feedId: string, rule: TitleRule): Promise<{ error?: string }> {
  const g = await requireOwnedFeed(feedId)
  if ('error' in g) return g
  try {
    await svc.saveTitleRule(feedId, rule)
    return {}
  } catch (e) {
    return { error: (e as Error).message }
  }
}

export async function deleteTitleRule(
  feedId: string,
  productType: string
): Promise<{ error?: string }> {
  const g = await requireOwnedFeed(feedId)
  if ('error' in g) return g
  try {
    await svc.deleteTitleRule(feedId, productType)
    return {}
  } catch (e) {
    return { error: (e as Error).message }
  }
}

// ── Manual edit ──────────────────────────────────────────────────────────────

export async function saveManualTitle(
  feedId: string,
  productRef: string,
  title: string
): Promise<{ error?: string }> {
  const g = await requireOwnedFeed(feedId)
  if ('error' in g) return g
  try {
    await svc.saveManualTitle(feedId, productRef, title)
    return {}
  } catch (e) {
    return { error: (e as Error).message }
  }
}

// ── Run ──────────────────────────────────────────────────────────────────────

export async function runOptimization(
  feedId: string,
  method: TitleMethod,
  choice: RerunChoice
): Promise<{ data: RunResult } | { error: string }> {
  const g = await requireOwnedFeed(feedId)
  if ('error' in g) return g
  try {
    return { data: await svc.runOptimization(feedId, method, choice) }
  } catch (e) {
    return { error: (e as Error).message }
  }
}

// Returns the refs a run would process + the overlap summary (for the UI to
// size progress and chunk the run).
export async function planOptimization(
  feedId: string,
  choice: RerunChoice
): Promise<{ data: svc.RunPlanSummary } | { error: string }> {
  const g = await requireOwnedFeed(feedId)
  if ('error' in g) return g
  try {
    return { data: await svc.planOptimization(feedId, choice) }
  } catch (e) {
    return { error: (e as Error).message }
  }
}

// Dry run on a sample — generates titles without persisting (experimentation).
export async function previewOptimization(
  feedId: string,
  method: TitleMethod,
  limit: number
): Promise<{ data: OptimizationOutcome[] } | { error: string }> {
  const g = await requireOwnedFeed(feedId)
  if ('error' in g) return g
  try {
    return { data: await svc.previewOptimization(feedId, method, limit) }
  } catch (e) {
    return { error: (e as Error).message }
  }
}

// Runs + persists one chunk of refs (from planOptimization.targets), returning
// outcomes for incremental display.
export async function runOptimizationForRefs(
  feedId: string,
  method: TitleMethod,
  refs: string[]
): Promise<{ data: OptimizationOutcome[] } | { error: string }> {
  const g = await requireOwnedFeed(feedId)
  if ('error' in g) return g
  try {
    return { data: await svc.runOptimizationForRefs(feedId, method, refs) }
  } catch (e) {
    return { error: (e as Error).message }
  }
}
