import Link from 'next/link'
import { redirect, notFound } from 'next/navigation'
import { createSupabaseServerClient } from '@/lib/supabase-server'
import { adminDb, getOwnedFeed } from '@/lib/feeds'
import { getFeedSettings } from '@/lib/feedGoogleAds'
import {
  formatInt,
  formatMoney,
  formatPercent,
  getProductPerformance,
  resolveActions,
  type Window,
} from '@/lib/googleAdsAnalytics'

// Deliberately a server component: this is a report, not a tool. The window and
// the metric definition already live in the URL, so there is no state left for
// the client to hold and nothing here needs to re-render without a navigation.

const WINDOWS: Window[] = [7, 14, 30, 90, 180, 365]
const DEFAULT_WINDOW: Window = 30

// Enough rows to argue with, not so many that a large catalogue ships a novel to
// the browser. The totals above the table are computed over ALL rows, so the cap
// never changes the headline number — only how much of the tail is listed.
const ROW_LIMIT = 200

export default async function WastedSpendPage({
  params,
  searchParams,
}: {
  params: Promise<{ feedId: string }>
  searchParams: Promise<{ days?: string; roas?: string | string[]; poas?: string | string[] }>
}) {
  const { feedId } = await params
  const { days: daysParam, roas: roasParam, poas: poasParam } = await searchParams

  const supabase = await createSupabaseServerClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  const feed = await getOwnedFeed(user.id, feedId)
  if (!feed) notFound()

  const parsed = Number(daysParam)
  const days: Window = WINDOWS.includes(parsed as Window) ? (parsed as Window) : DEFAULT_WINDOW

  const db = adminDb()
  const settings = await getFeedSettings(db, feedId)
  const currency = settings?.currency_code ?? 'DKK'

  if (!settings?.customer_id) {
    return (
      <Shell feedName={feed.name} feedId={feedId} days={days}>
        <Empty
          title="Not connected to Google Ads"
          body="This report reads spend that Google has already attributed to your products, so the feed needs a connection and at least one sync first."
          action={{ href: `/feed/${feedId}/google-ads`, label: 'Go to Performance →' }}
        />
      </Shell>
    )
  }

  const actions = resolveActions({ roas: roasParam, poas: poasParam }, settings)

  // Without a revenue action every product reports zero conversions, so the whole
  // catalogue would be listed as waste. Refusing to draw the table is the honest
  // response — a confident list of wrong answers is worse than no list.
  if (!actions.roas.length) {
    return (
      <Shell feedName={feed.name} feedId={feedId} days={days}>
        <Empty
          title="No revenue conversion action is selected"
          body="Waste is spend that produced no revenue, so this report needs to know which conversion action counts as revenue. Without one, every product looks like it converted nothing."
          action={{ href: `/feed/${feedId}/google-ads?days=${days}`, label: 'Choose one on Performance →' }}
        />
      </Shell>
    )
  }

  const { rows, totals, from, to } = await getProductPerformance(db, feedId, days, actions)

  // Unmatched rows are spend whose item id could not be traced back to a product.
  // It is not waste — we simply cannot say what it bought — so it is reported
  // separately rather than padding the total.
  const matched = rows.filter((r) => !r.unmatched)
  const unmatchedCost = rows.filter((r) => r.unmatched).reduce((n, r) => n + r.cost, 0)

  // Counts are genuinely zero for an untrafficked product, so `=== 0` is a fact
  // here and not the null-vs-zero trap that shapes the bucket engine.
  const wasted = matched
    .filter((r) => r.cost > 0 && r.roas_conversions === 0)
    .sort((a, b) => b.cost - a.cost)

  const wastedCost = wasted.reduce((n, r) => n + r.cost, 0)

  // Converts, but the gross profit does not cover the ad spend. profitAfterAdSpend
  // is null when no profit action reported on the product, which keeps "we cannot
  // judge this" out of a list headed "losing money".
  const losing = matched
    .filter((r) => r.roas_conversions > 0 && r.profitAfterAdSpend !== null && r.profitAfterAdSpend < 0)
    .sort((a, b) => (a.profitAfterAdSpend ?? 0) - (b.profitAfterAdSpend ?? 0))

  const losingCost = losing.reduce((n, r) => n + (r.profitAfterAdSpend ?? 0), 0)

  return (
    <Shell feedName={feed.name} feedId={feedId} days={days}>
      {/* ── What the numbers mean ─────────────────────────────────── */}
      <div className="wl-card" style={{ padding: '14px 18px' }}>
        <div className="flex items-start justify-between gap-4 flex-wrap">
          <p style={{ fontSize: '12px', color: 'var(--ink-secondary)', lineHeight: 1.5 }}>
            Revenue = {actions.roas.map((a) => `«${a}»`).join(' + ')}
            {actions.poas.length > 0 && (
              <> · Gross profit = {actions.poas.map((a) => `«${a}»`).join(' + ')}</>
            )}
          </p>
          <Link
            href={`/feed/${feedId}/google-ads?days=${days}`}
            style={{ fontSize: '12px', color: 'var(--accent-purple)' }}
          >
            Change →
          </Link>
        </div>
      </div>

      {/* ── Headline ──────────────────────────────────────────────── */}
      <section className="grid gap-3" style={{ gridTemplateColumns: 'repeat(auto-fit,minmax(150px,1fr))' }}>
        <Stat
          label="Spend with no revenue"
          value={formatMoney(wastedCost, currency)}
          tone={wastedCost > 0 ? 'bad' : undefined}
        />
        <Stat label="Products" value={formatInt(wasted.length)} />
        <Stat
          label="Share of all spend"
          value={totals.cost > 0 ? formatPercent(wastedCost / totals.cost) : '—'}
        />
        <Stat label="Total spend" value={formatMoney(totals.cost, currency)} />
      </section>

      {/* ── Spend with nothing to show ────────────────────────────── */}
      {wasted.length === 0 ? (
        <Empty
          title="Every product with spend produced revenue"
          body={`Nothing in the last ${days} days took budget without returning anything. Widen the window if you want to look further back.`}
        />
      ) : (
        <Table
          title="Spend with no revenue"
          note={`${days} days · sorted by spend`}
          head={['Product', 'Impressions', 'Clicks', 'Cost', 'Share']}
          shown={Math.min(wasted.length, ROW_LIMIT)}
          total={wasted.length}
        >
          {wasted.slice(0, ROW_LIMIT).map((r) => (
            <tr key={r.productRef} style={{ borderBottom: '0.5px solid var(--hairline)' }}>
              <Td left>{r.title ?? r.productRef}</Td>
              <Td>{formatInt(r.impressions)}</Td>
              <Td>{formatInt(r.clicks)}</Td>
              <Td strong>{formatMoney(r.cost, currency)}</Td>
              <Td muted>{wastedCost > 0 ? formatPercent(r.cost / wastedCost, 0) : '—'}</Td>
            </tr>
          ))}
        </Table>
      )}

      {/* ── Converting, and still underwater ──────────────────────── */}
      {actions.poas.length > 0 && losing.length > 0 && (
        <Table
          title="Converting, but losing money"
          note={`Gross profit below ad spend · ${formatMoney(losingCost, currency)} in total`}
          head={['Product', 'Cost', 'Gross profit', 'Profit − cost']}
          shown={Math.min(losing.length, ROW_LIMIT)}
          total={losing.length}
        >
          {losing.slice(0, ROW_LIMIT).map((r) => (
            <tr key={r.productRef} style={{ borderBottom: '0.5px solid var(--hairline)' }}>
              <Td left>{r.title ?? r.productRef}</Td>
              <Td>{formatMoney(r.cost, currency)}</Td>
              <Td>{formatMoney(r.poas_value, currency)}</Td>
              <Td strong tone="bad">{formatMoney(r.profitAfterAdSpend, currency)}</Td>
            </tr>
          ))}
        </Table>
      )}

      {/* ── Footnotes that stop the numbers being misread ─────────── */}
      <div className="space-y-1.5" style={{ fontSize: '12px', color: 'var(--ink-muted)' }}>
        <p>
          {from} — {to}. Only cost Google can attribute to a product is included.
          Performance Max spend on non-shopping placements is not counted, so these
          figures are lower than the account&apos;s total cost.
        </p>
        {actions.poas.length === 0 && (
          <p>
            No gross profit action is selected, so products that convert at a loss cannot
            be identified — only ones that produced no revenue at all.
          </p>
        )}
        {unmatchedCost > 0 && (
          <p style={{ color: 'var(--accent-amber)' }}>
            {formatMoney(unmatchedCost, currency)} could not be matched to a product in this
            feed and is excluded from the figures above.
          </p>
        )}
        <p>
          A product with no conversions is not automatically a mistake — it may be new, or
          seasonal, or serving a query that converts elsewhere. This is a list to look at,
          not a list to act on blindly.
        </p>
      </div>
    </Shell>
  )
}

// ── pieces ───────────────────────────────────────────────────────────────────

function Shell({
  feedName,
  feedId,
  days,
  children,
}: {
  feedName: string
  feedId: string
  days: Window
  children: React.ReactNode
}) {
  return (
    <div className="min-h-screen" style={{ background: 'var(--bg-base)' }}>
      <main className="max-w-6xl mx-auto px-6 py-9 space-y-6">
        <header className="flex items-end justify-between gap-4 flex-wrap">
          <div className="space-y-1.5">
            <div className="wl-eyebrow truncate">{feedName}</div>
            <h1
              style={{
                fontSize: '34px',
                fontWeight: 500,
                lineHeight: 1.1,
                letterSpacing: '-0.02em',
                color: 'var(--ink)',
              }}
            >
              Wasted spend
            </h1>
          </div>
          <div className="flex gap-1">
            {WINDOWS.map((w) => (
              <Link
                key={w}
                href={`/feed/${feedId}/google-ads/waste?days=${w}`}
                className="wl-pill"
                style={{
                  background: w === days ? 'var(--accent-purple)' : 'transparent',
                  color: w === days ? '#fff' : 'var(--ink-muted)',
                  border: w === days ? 'none' : '1px solid var(--hairline)',
                }}
              >
                {w}d
              </Link>
            ))}
          </div>
        </header>
        {children}
      </main>
    </div>
  )
}

function Stat({
  label,
  value,
  tone,
}: {
  label: string
  value: string
  tone?: 'bad'
}) {
  return (
    <div className="wl-card" style={{ padding: '16px 18px' }}>
      <div className="wl-eyebrow">{label}</div>
      <div
        style={{
          fontSize: '26px',
          fontWeight: 500,
          letterSpacing: '-0.02em',
          marginTop: '6px',
          color: tone === 'bad' ? 'var(--accent-red)' : 'var(--ink)',
          fontVariantNumeric: 'tabular-nums',
        }}
      >
        {value}
      </div>
    </div>
  )
}

function Table({
  title,
  note,
  head,
  shown,
  total,
  children,
}: {
  title: string
  note: string
  head: string[]
  shown: number
  total: number
  children: React.ReactNode
}) {
  return (
    <section className="wl-card" style={{ padding: 0, overflow: 'hidden' }}>
      <div
        className="flex items-baseline justify-between gap-3 flex-wrap"
        style={{ padding: '14px 18px', borderBottom: '1px solid var(--hairline)' }}
      >
        <h2 style={{ fontSize: '18px', fontWeight: 500, color: 'var(--ink)' }}>{title}</h2>
        <span style={{ fontSize: '12px', color: 'var(--ink-muted)' }}>{note}</span>
      </div>
      <div style={{ overflowX: 'auto' }}>
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '13px' }}>
          <thead>
            <tr style={{ borderBottom: '1px solid var(--hairline)' }}>
              {head.map((h, i) => (
                <th
                  key={h}
                  style={{
                    padding: '9px 12px',
                    textAlign: i === 0 ? 'left' : 'right',
                    paddingLeft: i === 0 ? '18px' : '12px',
                    paddingRight: i === head.length - 1 ? '18px' : '12px',
                    fontSize: '11px',
                    fontWeight: 400,
                    textTransform: 'uppercase',
                    letterSpacing: '0.08em',
                    color: 'var(--ink-muted)',
                    whiteSpace: 'nowrap',
                  }}
                >
                  {h}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>{children}</tbody>
        </table>
      </div>
      {total > shown && (
        <p style={{ fontSize: '11px', color: 'var(--ink-muted)', padding: '10px 18px' }}>
          Showing the {shown} largest of {total}. The totals above cover all of them.
        </p>
      )}
    </section>
  )
}

function Td({
  children,
  left,
  strong,
  muted,
  tone,
}: {
  children: React.ReactNode
  left?: boolean
  strong?: boolean
  muted?: boolean
  tone?: 'bad'
}) {
  return (
    <td
      style={{
        padding: '9px 12px',
        paddingLeft: left ? '18px' : '12px',
        textAlign: left ? 'left' : 'right',
        whiteSpace: left ? 'normal' : 'nowrap',
        fontVariantNumeric: left ? undefined : 'tabular-nums',
        fontWeight: strong ? 500 : 400,
        color: tone === 'bad' ? 'var(--accent-red)' : muted ? 'var(--ink-muted)' : 'var(--ink)',
        maxWidth: left ? '340px' : undefined,
      }}
    >
      {children}
    </td>
  )
}

function Empty({
  title,
  body,
  action,
}: {
  title: string
  body: string
  action?: { href: string; label: string }
}) {
  return (
    <div className="wl-card" style={{ padding: '40px' }}>
      <div className="max-w-xl space-y-3">
        <h2 style={{ fontSize: '20px', fontWeight: 500, color: 'var(--ink)' }}>{title}</h2>
        <p style={{ fontSize: '15px', lineHeight: 1.6, color: 'var(--ink-secondary)' }}>{body}</p>
        {action && (
          <Link href={action.href} className="wl-btn-primary inline-block">
            {action.label}
          </Link>
        )}
      </div>
    </div>
  )
}
