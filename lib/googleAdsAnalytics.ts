import type { SupabaseClient } from '@supabase/supabase-js'
import { dbError } from '@/lib/errors'

export type Window = 7 | 14 | 30 | 90 | 180 | 365

// Raw sums as the SQL functions return them.
type RawTotals = {
  impressions: number
  clicks: number
  cost: number
  conversions: number
  conversions_value: number
  roas_conversions: number
  roas_value: number
  poas_conversions: number
  poas_value: number
}

// Derived, all nullable where a denominator can be absent.
export type Derived = {
  /** conversions_value of the chosen revenue action ÷ cost */
  roas: number | null
  /** conversions_value of the chosen profit action ÷ cost */
  poas: number | null
  /** clicks ÷ impressions */
  ctr: number | null
  /** cost ÷ clicks */
  cpc: number | null
  /** revenue ÷ conversions */
  aov: number | null
  /** profit ÷ revenue — the margin implied by the two chosen actions */
  margin: number | null
  /** gross profit minus ad cost. Negative = this product loses money on ads. */
  profitAfterAdSpend: number | null
}

export type ProductRow = RawTotals &
  Derived & {
    productRef: string | null
    title: string | null
    handle: string | null
    imageUrl: string | null
    productType: string | null
    vendor: string | null
    variantCount: number
    unmatched: boolean
  }

export type VariantRow = RawTotals &
  Derived & {
    itemId: string
    productRef: string | null
    variantRef: string | null
    productTitle: string | null
    variantTitle: string | null
    sku: string | null
    options: string[]
    price: string | null
  }

export type Totals = RawTotals & Derived & { products: number; items: number }


const ratio = (numerator: number, denominator: number): number | null =>
  denominator > 0 ? numerator / denominator : null

export function derive(t: RawTotals): Derived {
  return {
    roas: ratio(t.roas_value, t.cost),
    poas: ratio(t.poas_value, t.cost),
    ctr: ratio(t.clicks, t.impressions),
    cpc: ratio(t.cost, t.clicks),
    aov: ratio(t.roas_value, t.roas_conversions),
    margin: ratio(t.poas_value, t.roas_value),
    profitAfterAdSpend: t.poas_value > 0 || t.poas_conversions > 0 ? t.poas_value - t.cost : null,
  }
}

const num = (v: unknown): number => {
  const n = Number(v ?? 0)
  return Number.isFinite(n) ? n : 0
}

function rawFrom(r: Record<string, unknown>): RawTotals {
  return {
    impressions: num(r.impressions),
    clicks: num(r.clicks),
    cost: num(r.cost),
    conversions: num(r.conversions),
    conversions_value: num(r.conversions_value),
    roas_conversions: num(r.roas_conversions),
    roas_value: num(r.roas_value),
    poas_conversions: num(r.poas_conversions),
    poas_value: num(r.poas_value),
  }
}

export function windowRange(days: number, now = new Date()): { from: string; to: string } {
  const DAY = 86_400_000
  const to = new Date(now.getTime() - DAY)
  const from = new Date(to.getTime() - (Math.max(1, days) - 1) * DAY)
  const f = (d: Date) => d.toISOString().slice(0, 10)
  return { from: f(from), to: f(to) }
}

/** Which conversion action stands for revenue and which for gross profit. */
export type ActionChoice = { roas: string | null; poas: string | null }

export type AvailableAction = {
  name: string
  conversions: number
  value: number
  items: number
}

/**
 * Every conversion action with data in the window, largest value first.
 *
 * The magnitudes are the point, not decoration: an action reporting ten times
 * the account's real revenue is self-evidently a view tracker, and showing that
 * next to the name is what stops someone picking it.
 */
export async function getAvailableActions(
  db: SupabaseClient,
  feedId: string,
  days: number
): Promise<AvailableAction[]> {
  const { from, to } = windowRange(days)
  const { data, error } = await db.rpc('google_ads_conversion_actions', {
    p_feed_id: feedId,
    p_from: from,
    p_to: to,
  })
  if (error) dbError('getAvailableActions', error)

  return ((data ?? []) as Record<string, unknown>[]).map((r) => ({
    name: String(r.conversion_action ?? ''),
    conversions: num(r.conversions),
    value: num(r.conversions_value),
    items: num(r.items),
  }))
}

export async function getProductPerformance(
  db: SupabaseClient,
  feedId: string,
  days: number,
  actions: ActionChoice = { roas: null, poas: null }
): Promise<{ rows: ProductRow[]; totals: Totals; from: string; to: string }> {
  const { from, to } = windowRange(days)

  const { data, error } = await db.rpc('google_ads_product_summary', {
    p_feed_id: feedId,
    p_from: from,
    p_to: to,
    p_roas_action: actions.roas,
    p_poas_action: actions.poas,
  })
  if (error) dbError('getProductPerformance', error)

  const rows: ProductRow[] = ((data ?? []) as Record<string, unknown>[]).map((r) => {
    const raw = rawFrom(r)
    return {
      ...raw,
      ...derive(raw),
      productRef: (r.product_ref as string | null) ?? null,
      title: (r.title as string | null) ?? null,
      handle: (r.handle as string | null) ?? null,
      imageUrl: (r.image_url as string | null) ?? null,
      productType: (r.product_type as string | null) ?? null,
      vendor: (r.vendor as string | null) ?? null,
      variantCount: num(r.variant_count),
      unmatched: !r.product_ref || !r.title,
    }
  })

  const summed = rows.reduce<RawTotals>(
    (acc, r) => ({
      impressions: acc.impressions + r.impressions,
      clicks: acc.clicks + r.clicks,
      cost: acc.cost + r.cost,
      conversions: acc.conversions + r.conversions,
      conversions_value: acc.conversions_value + r.conversions_value,
      roas_conversions: acc.roas_conversions + r.roas_conversions,
      roas_value: acc.roas_value + r.roas_value,
      poas_conversions: acc.poas_conversions + r.poas_conversions,
      poas_value: acc.poas_value + r.poas_value,
    }),
    rawFrom({})
  )

  return {
    rows,
    totals: {
      ...summed,
      ...derive(summed),
      products: rows.filter((r) => r.productRef).length,
      items: rows.reduce((n, r) => n + r.variantCount, 0),
    },
    from,
    to,
  }
}

export async function getVariantPerformance(
  db: SupabaseClient,
  feedId: string,
  days: number,
  productRef?: string | null,
  actions: ActionChoice = { roas: null, poas: null }
): Promise<VariantRow[]> {
  const { from, to } = windowRange(days)

  const { data, error } = await db.rpc('google_ads_variant_summary', {
    p_feed_id: feedId,
    p_from: from,
    p_to: to,
    p_product_ref: productRef ?? null,
    p_roas_action: actions.roas,
    p_poas_action: actions.poas,
  })
  if (error) dbError('getVariantPerformance', error)

  return ((data ?? []) as Record<string, unknown>[]).map((r) => {
    const raw = rawFrom(r)
    return {
      ...raw,
      ...derive(raw),
      itemId: String(r.item_id ?? ''),
      productRef: (r.product_ref as string | null) ?? null,
      variantRef: (r.variant_ref as string | null) ?? null,
      productTitle: (r.product_title as string | null) ?? null,
      variantTitle: (r.variant_title as string | null) ?? null,
      sku: (r.sku as string | null) ?? null,
      options: [r.option1, r.option2, r.option3]
        .map((o) => (typeof o === 'string' ? o.trim() : ''))
        .filter((o) => o && o !== 'Default Title'),
      price: (r.price as string | null) ?? null,
    }
  })
}

export function formatMoney(v: number | null, currency: string | null): string {
  if (v === null) return '—'
  return new Intl.NumberFormat('da-DK', {
    style: 'currency',
    currency: currency || 'DKK',
    maximumFractionDigits: 0,
  }).format(v)
}

export function formatRatio(v: number | null, digits = 2): string {
  return v === null ? '—' : v.toLocaleString('da-DK', {
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  })
}

export function formatPercent(v: number | null, digits = 1): string {
  return v === null ? '—' : `${(v * 100).toLocaleString('da-DK', {
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  })} %`
}

export function formatInt(v: number): string {
  return v.toLocaleString('da-DK', { maximumFractionDigits: 0 })
}
