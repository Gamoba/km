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

/**
 * @param poasTracked Whether the feed actually has a gross-profit conversion
 * action selected.
 *
 * It decides what a gross profit of ZERO means. With an action chosen, a
 * product that took spend and returned no profit has a MEASURED profit of
 * −cost: that is the single most actionable number in the account, and leaving
 * it null hid it from every rule and every sort. With no action chosen, the
 * same zero says nothing about the product — it says the account has not been
 * told what profit is — so it stays null rather than painting the whole
 * catalogue as pure loss.
 */
export function derive(t: RawTotals, poasTracked = false): Derived {
  return {
    roas: ratio(t.roas_value, t.cost),
    poas: ratio(t.poas_value, t.cost),
    ctr: ratio(t.clicks, t.impressions),
    cpc: ratio(t.cost, t.clicks),
    aov: ratio(t.roas_value, t.roas_conversions),
    margin: ratio(t.poas_value, t.roas_value),
    profitAfterAdSpend:
      poasTracked || t.poas_value > 0 || t.poas_conversions > 0 ? t.poas_value - t.cost : null,
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

/**
 * Which conversion actions stand for revenue and which for gross profit.
 *
 * Sets, not single names: revenue is sometimes split across actions that each
 * cover part of the account (new vs returning, one per market) and only mean
 * something added together. The values are SUMMED, and overlapping actions
 * therefore double-count — that is the operator's call to make, not something
 * the data can rule out, since the same order is normally counted by several
 * actions at once.
 *
 * Empty array = nothing chosen, which yields null ratios rather than zeroes.
 */
export type ActionChoice = { roas: string[]; poas: string[] }

export const NO_ACTIONS: ActionChoice = { roas: [], poas: [] }

/**
 * What a page should measure with: the URL when someone is exploring a
 * definition, otherwise the feed's saved default.
 *
 * ABSENT and EMPTY are different. No param means "not chosen on this page" and
 * falls back to the default; `?roas=` means everything was unticked and must not
 * be quietly refilled. Shared so that following a link from one Google Ads page
 * to another cannot silently change what the numbers mean.
 */
export function resolveActions(
  params: { roas?: string | string[]; poas?: string | string[] },
  settings: {
    roas_conversion_actions?: string[] | null
    poas_conversion_actions?: string[] | null
  } | null
): ActionChoice {
  const fromParam = (v: string | string[] | undefined): string[] | null =>
    v === undefined ? null : (Array.isArray(v) ? v : [v]).filter(Boolean)

  return {
    roas: fromParam(params.roas) ?? settings?.roas_conversion_actions ?? [],
    poas: fromParam(params.poas) ?? settings?.poas_conversion_actions ?? [],
  }
}

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
  actions: ActionChoice = NO_ACTIONS
): Promise<{ rows: ProductRow[]; totals: Totals; from: string; to: string }> {
  const { from, to } = windowRange(days)

  const { data, error } = await db.rpc('google_ads_product_summary', {
    p_feed_id: feedId,
    p_from: from,
    p_to: to,
    p_roas_actions: actions.roas,
    p_poas_actions: actions.poas,
  })
  if (error) dbError('getProductPerformance', error)

  const poasTracked = actions.poas.length > 0

  const rows: ProductRow[] = ((data ?? []) as Record<string, unknown>[]).map((r) => {
    const raw = rawFrom(r)
    return {
      ...raw,
      ...derive(raw, poasTracked),
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
      ...derive(summed, poasTracked),
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
  actions: ActionChoice = NO_ACTIONS
): Promise<VariantRow[]> {
  const { from, to } = windowRange(days)

  const { data, error } = await db.rpc('google_ads_variant_summary', {
    p_feed_id: feedId,
    p_from: from,
    p_to: to,
    p_product_ref: productRef ?? null,
    p_roas_actions: actions.roas,
    p_poas_actions: actions.poas,
  })
  if (error) dbError('getVariantPerformance', error)

  const poasTracked = actions.poas.length > 0

  return ((data ?? []) as Record<string, unknown>[]).map((r) => {
    const raw = rawFrom(r)
    return {
      ...raw,
      ...derive(raw, poasTracked),
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

// ── Break-even ───────────────────────────────────────────────────────────────

/**
 * How much larger a REPORTED conversion value is than the net revenue behind it.
 *
 * 1 when the value is already net, 1 + rate/100 when it carries VAT. Null when
 * nobody has answered — deliberately not defaulted here, because the caller is
 * the only one that can decide whether to assume and warn or to show nothing at
 * all. See migration 043.
 */
export function vatUplift(includesVat: boolean | null, rate: number | null): number | null {
  if (includesVat === null || includesVat === undefined) return null
  if (!includesVat) return 1
  const n = Number(rate)
  if (!Number.isFinite(n) || n < 0 || n >= 100) return null
  return 1 + n / 100
}

/**
 * The ROAS at which gross profit exactly covers ad cost.
 *
 * Gross profit is revenue × margin, so break-even is where revenue ÷ cost —
 * ROAS — equals 1 ÷ margin. The uplift corrects for the two halves being quoted
 * on different bases: the margin is net of VAT, while the ROAS numerator is
 * whatever Google was told, which for a standard Shopify tracking setup is the
 * gross order total.
 *
 * @param margin Net catalogue margin as a fraction. Must be the AUTHORITATIVE
 * basis, never the as-entered one a display toggle might be showing: this
 * number is compared against a real ROAS, so it cannot depend on how someone is
 * currently looking at the table.
 *
 * Null for an unknown margin, and equally for a margin of zero or less — where
 * no revenue multiple ever repays the spend, so no finite threshold exists.
 * Callers that need to tell those apart should check the margin themselves.
 */
export function breakEvenRoas(margin: number | null, uplift = 1): number | null {
  if (margin === null || margin <= 0) return null
  return uplift / margin
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
