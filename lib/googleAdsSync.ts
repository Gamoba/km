// Pulls per-product performance from Google Ads into google_ads_product_daily
// (cost/clicks/impressions) and google_ads_product_conversions (every conversion
// action, per product per day).
//
// Read-only against Google (GAQL SELECT via lib/googleAds, which refuses
// anything else); writes only to Supabase.
//
// THREE THINGS THAT ARE EASY TO GET WRONG, AND WHY THIS DOES THEM THIS WAY:
//
// 1. ROLLING RE-FETCH, NOT APPEND. Google attributes conversions RETROACTIVELY —
//    a sale today can be credited to a click three weeks ago, changing that day's
//    numbers long after it passed. Appending only new days would permanently
//    understate history, so every run re-pulls the whole window and upserts.
//
// 2. EVERY CONVERSION ACTION IS STORED, none is chosen here. What an account
//    calls its conversion value differs wildly — revenue in one, gross profit in
//    another, phone calls in a third, and often a view_item tracker reporting the
//    product price as "value". Which action means revenue and which means profit
//    is a DISPLAY decision (migration 033), so the sync stays neutral and the
//    user can change their mind without re-syncing.
//
// 3. ITEM IDS ARE VARIANT-LEVEL. Google reports per Merchant Center offer. The
//    raw id is stored as the key, with product/variant refs resolved beside it,
//    so product-level roll-up and variant-level detail both read one table.

import type { SupabaseClient } from '@supabase/supabase-js'
import {
  createGoogleAdsClientForFeed,
  markConnectionError,
  type GoogleAdsFeedSettings,
} from '@/lib/feedGoogleAds'
import { metricNumber, gaqlDate, type GoogleAdsClient, type GoogleAdsRow } from '@/lib/googleAds'
import { detectIdPattern, parseItemId, type IdPattern } from '@/lib/googleAdsIds'
import { AppError } from '@/lib/errors'

const UPSERT_CHUNK = 500

export type SyncResult = {
  feedId: string
  from: string
  to: string
  rows: number
  conversionRows: number
  actions: string[]
  itemIds: number
  products: number
  unmatched: number
  pattern: IdPattern | null
  patternConfidence: number
  durationMs: number
  warnings: string[]
}

type Bucket = {
  impressions: number
  clicks: number
  cost_micros: number
  conversions: number
  conversions_value: number
}

const emptyBucket = (): Bucket => ({
  impressions: 0,
  clicks: 0,
  cost_micros: 0,
  conversions: 0,
  conversions_value: 0,
})

// ── Window ───────────────────────────────────────────────────────────────────

// Ends YESTERDAY: today is a partial day in the account's timezone and would
// make every "last N days" comparison wobble depending on the hour it ran.
export function syncWindow(days: number, now = new Date()): { from: string; to: string } {
  const DAY = 86_400_000
  const to = new Date(now.getTime() - DAY)
  const from = new Date(to.getTime() - (Math.max(1, days) - 1) * DAY)
  return { from: gaqlDate(from), to: gaqlDate(to) }
}

// ── Queries ──────────────────────────────────────────────────────────────────

// One Ads account can serve several markets; the feed label isolates the one
// this feed represents.
//
// GAQL requires any segment used in WHERE to ALSO appear in SELECT
// (EXPECTED_REFERENCED_FIELD_IN_SELECT_CLAUSE), so the filter and the projection
// have to be added together — which is why this returns both halves rather than
// just a WHERE fragment.
function feedLabelParts(feedLabel: string | null): { select: string; where: string } {
  if (!feedLabel) return { select: '', where: '' }
  // Escaped defensively even though it comes from our own settings — GAQL
  // string literals are single-quoted.
  const escaped = feedLabel.replace(/'/g, "\\'")
  return {
    select: ', segments.product_feed_label',
    where: ` AND segments.product_feed_label = '${escaped}'`,
  }
}

// Base metrics. metrics.conversions here is the ACCOUNT DEFAULT (primary goals
// only) — stored for reconciling against the Google Ads UI, never used for
// ROAS/POAS, which come from a named action instead.
async function fetchBaseMetrics(
  client: GoogleAdsClient,
  from: string,
  to: string,
  feedLabel: string | null
): Promise<GoogleAdsRow[]> {
  const label = feedLabelParts(feedLabel)
  return client.query(
    `SELECT segments.date, segments.product_item_id,
            metrics.impressions, metrics.clicks, metrics.cost_micros,
            metrics.conversions, metrics.conversions_value${label.select}
     FROM shopping_performance_view
     WHERE segments.date BETWEEN '${from}' AND '${to}'${label.where}`
  )
}

// EVERY conversion action, unfiltered. segments.conversion_action_name is only
// valid alongside all_conversions metrics — metrics.conversions cannot be
// segmented this way.
//
// The result is sparse: Google returns only action/item/day combinations that
// actually converted, which on a real catalogue is a small minority of rows.
async function fetchAllActionMetrics(
  client: GoogleAdsClient,
  from: string,
  to: string,
  feedLabel: string | null
): Promise<GoogleAdsRow[]> {
  const label = feedLabelParts(feedLabel)
  return client.query(
    `SELECT segments.date, segments.product_item_id, segments.conversion_action_name,
            metrics.all_conversions, metrics.all_conversions_value${label.select}
     FROM shopping_performance_view
     WHERE segments.date BETWEEN '${from}' AND '${to}'${label.where}`
  )
}

// ── Sync ─────────────────────────────────────────────────────────────────────

export async function syncGoogleAdsMetrics(
  db: SupabaseClient,
  feedId: string,
  options: { days?: number } = {}
): Promise<SyncResult> {
  const t0 = Date.now()
  const warnings: string[] = []

  const { client, settings, connectionId } = await createGoogleAdsClientForFeed(db, feedId)
  const days = options.days ?? settings.sync_window_days ?? 90
  const { from, to } = syncWindow(days)

  console.log(`[googleAdsSync] feed=${feedId} customer=${client.customerId} ${from}..${to}`)

  let base: GoogleAdsRow[]
  try {
    base = await fetchBaseMetrics(client, from, to, settings.feed_label)
  } catch (err) {
    // An auth failure is the connection's problem, not this feed's — record it
    // once so every feed on that grant reports the same actionable state.
    if (err instanceof AppError && err.status === 401) {
      await markConnectionError(db, connectionId, err.message)
    }
    await noteSyncError(db, feedId, err)
    throw err
  }

  // key = `${date} ${itemId}` — neither part can contain a space, so this is a
  // safe composite that avoids allocating a nested map per day.
  const rows = new Map<string, Bucket>()
  const keyOf = (date: string, itemId: string) => `${date} ${itemId}`

  for (const r of base) {
    const date = String(r.segments?.date ?? '')
    const itemId = String(r.segments?.productItemId ?? '')
    if (!date || !itemId) continue
    const k = keyOf(date, itemId)
    let b = rows.get(k)
    if (!b) rows.set(k, (b = emptyBucket()))
    // Several campaigns can serve the same item on the same day; sum them.
    b.impressions += metricNumber(r.metrics?.impressions)
    b.clicks += metricNumber(r.metrics?.clicks)
    b.cost_micros += metricNumber(r.metrics?.costMicros)
    b.conversions += metricNumber(r.metrics?.conversions)
    b.conversions_value += metricNumber(r.metrics?.conversionsValue)
  }

  // ── Conversions, per action ────────────────────────────────────────────────
  const convByKey = new Map<string, { conversions: number; value: number }>()
  const actionNames = new Set<string>()
  try {
    for (const r of await fetchAllActionMetrics(client, from, to, settings.feed_label)) {
      const date = String(r.segments?.date ?? '')
      const itemId = String(r.segments?.productItemId ?? '')
      const action = String(r.segments?.conversionActionName ?? '')
      if (!date || !itemId || !action) continue
      actionNames.add(action)
      const k = `${date} ${itemId} ${action}`
      const cur = convByKey.get(k) ?? { conversions: 0, value: 0 }
      cur.conversions += metricNumber(r.metrics?.allConversions)
      cur.value += metricNumber(r.metrics?.allConversionsValue)
      convByKey.set(k, cur)
    }
  } catch (err) {
    // Cost data is still worth storing without conversions — the page just shows
    // spend with empty ROAS rather than nothing at all.
    warnings.push(
      `Could not fetch conversions per action: ${err instanceof Error ? err.message : 'unknown error'}`
    )
  }

  if (!actionNames.size && rows.size) {
    warnings.push('No conversion data in this period — ROAS and POAS cannot be calculated.')
  }

  // ── Resolve item ids → products ────────────────────────────────────────────
  const itemIds = [...new Set([...rows.keys()].map((k) => k.split(' ')[1]))]
  const detection = detectIdPattern(itemIds)
  const pattern: IdPattern | null =
    settings.id_pattern && settings.id_pattern !== 'auto'
      ? (settings.id_pattern as IdPattern)
      : detection.pattern

  if (!pattern && itemIds.length) {
    warnings.push('Could not determine the item ID format — products cannot be matched to the catalogue.')
  } else if (detection.confidence < 0.9 && itemIds.length) {
    warnings.push(
      `The item ID format is ambiguous (${Math.round(detection.confidence * 100)}% match ${pattern}).`
    )
  }

  const records: Record<string, unknown>[] = []
  let unmatched = 0
  const products = new Set<string>()
  const now = new Date().toISOString()

  for (const [k, b] of rows) {
    const [date, itemId] = k.split(' ')
    const parsed = pattern ? parseItemId(itemId, pattern) : null
    if (!parsed) unmatched++
    else products.add(parsed.productRef)

    records.push({
      feed_id: feedId,
      date,
      item_id: itemId,
      // Nullable on purpose: an unparseable id is still stored, so a pattern
      // misconfiguration shows up as visible unmatched spend rather than as
      // silently missing data.
      product_ref: parsed?.productRef ?? null,
      variant_ref: parsed?.variantRef ?? null,
      impressions: b.impressions,
      clicks: b.clicks,
      cost_micros: b.cost_micros,
      conversions: b.conversions,
      conversions_value: b.conversions_value,
      synced_at: now,
    })
  }

  const convRecords: Record<string, unknown>[] = []
  for (const [k, v] of convByKey) {
    const [date, itemId, action] = k.split(' ')
    convRecords.push({
      feed_id: feedId,
      date,
      item_id: itemId,
      conversion_action: action,
      conversions: v.conversions,
      conversions_value: v.value,
      synced_at: now,
    })
  }

  // ── Persist ────────────────────────────────────────────────────────────────
  await upsertChunked(db, 'google_ads_product_daily', records, 'feed_id,date,item_id', feedId)
  await upsertChunked(
    db,
    'google_ads_product_conversions',
    convRecords,
    'feed_id,date,item_id,conversion_action',
    feedId
  )

  await db
    .from('google_ads_feed_settings')
    .update({
      last_synced_at: now,
      last_sync_error: null,
      // Persist what was detected so the UI can show it and the user can override.
      ...(settings.id_pattern === 'auto' && pattern
        ? { id_pattern: pattern, id_pattern_country: detection.country }
        : {}),
      updated_at: now,
    })
    .eq('feed_id', feedId)

  return {
    feedId,
    from,
    to,
    rows: records.length,
    conversionRows: convRecords.length,
    actions: [...actionNames].sort(),
    itemIds: itemIds.length,
    products: products.size,
    unmatched,
    pattern,
    patternConfidence: detection.confidence,
    durationMs: Date.now() - t0,
    warnings,
  }
}

async function upsertChunked(
  db: SupabaseClient,
  table: string,
  records: Record<string, unknown>[],
  onConflict: string,
  feedId: string
): Promise<void> {
  for (let i = 0; i < records.length; i += UPSERT_CHUNK) {
    const { error } = await db
      .from(table)
      .upsert(records.slice(i, i + UPSERT_CHUNK), { onConflict })
    if (error) {
      await noteSyncError(db, feedId, error)
      throw new Error(`Could not save Google Ads data (${table}): ${error.message}`)
    }
  }
}

async function noteSyncError(db: SupabaseClient, feedId: string, err: unknown): Promise<void> {
  const message = err instanceof Error ? err.message : String(err)
  await db
    .from('google_ads_feed_settings')
    .update({ last_sync_error: message.slice(0, 500), updated_at: new Date().toISOString() })
    .eq('feed_id', feedId)
}

// ── Settings guard ───────────────────────────────────────────────────────────

/**
 * What must be configured before a sync can run at all.
 *
 * The conversion actions are deliberately NOT listed: since migration 033 they
 * are a display preference, not a sync input. A feed with no action chosen still
 * syncs everything — the page just needs one picked before it can label a column
 * "ROAS".
 */
export function missingSetup(s: GoogleAdsFeedSettings | null): string[] {
  if (!s) return ['Google Ads is not set up for this feed.']
  const missing: string[] = []
  if (!s.connection_id) missing.push('No Google Ads connection.')
  if (!s.customer_id) missing.push('No Google Ads account selected.')
  return missing
}
