'use client'

import { useRouter } from 'next/navigation'
import { Fragment, useMemo, useState } from 'react'
import {
  formatInt,
  formatMoney,
  formatRatio,
  type ActionChoice,
  type AvailableAction,
  type ProductRow,
  type Totals,
  type VariantRow,
  type Window,
} from '@/lib/googleAdsAnalytics'
import { GoogleAdsSetup } from './GoogleAdsSetup'

type SettingsView = {
  customerName: string | null
  customerId: string | null
  currency: string | null
  roasAction: string | null
  poasAction: string | null
  lastSyncedAt: string | null
  lastSyncError: string | null
  feedLabel: string | null
}

type Props = {
  feedId: string
  feedName: string
  days: Window
  windows: Window[]
  connected: boolean
  hasConnection: boolean
  setupIssues: string[]
  connectError: string | null
  justConnected: boolean
  settings: SettingsView | null
  /** Every conversion action with data in this window, largest value first. */
  availableActions: AvailableAction[]
  /** What the ROAS/POAS columns currently mean. */
  activeActions: ActionChoice
  rows: ProductRow[]
  totals: Totals | null
  from: string
  to: string
}

type SortKey = 'cost' | 'roas' | 'poas' | 'clicks' | 'impressions' | 'roas_value' | 'poas_value'

function compare(a: number | null, b: number | null, dir: 1 | -1): number {
  if (a === null && b === null) return 0
  if (a === null) return 1
  if (b === null) return -1
  return (a - b) * dir
}

export function GoogleAdsClient({
  feedId,
  feedName,
  days,
  windows,
  connected,
  hasConnection,
  setupIssues,
  connectError,
  justConnected,
  settings,
  availableActions,
  activeActions,
  rows,
  totals,
  from,
  to,
}: Props) {
  const router = useRouter()
  const [showSetup, setShowSetup] = useState(!connected)
  const [sortKey, setSortKey] = useState<SortKey>('cost')
  const [sortDir, setSortDir] = useState<1 | -1>(-1)
  const [expanded, setExpanded] = useState<string | null>(null)
  const [variants, setVariants] = useState<Record<string, VariantRow[]>>({})
  const [loadingVariants, setLoadingVariants] = useState<string | null>(null)
  const [syncing, setSyncing] = useState(false)
  const [syncError, setSyncError] = useState<string | null>(null)
  const [syncNote, setSyncNote] = useState<string | null>(null)
  const [savingDefaults, setSavingDefaults] = useState(false)

  const currency = settings?.currency ?? 'DKK'

  // Window and metric definition both live in the URL, so a particular view is
  // shareable and survives a refresh. Changing one must preserve the others.
  const urlWith = (patch: Record<string, string | null>) => {
    const q = new URLSearchParams()
    q.set('days', String(days))
    if (activeActions.roas) q.set('roas', activeActions.roas)
    if (activeActions.poas) q.set('poas', activeActions.poas)
    for (const [k, v] of Object.entries(patch)) {
      if (v === null || v === '') q.delete(k)
      else q.set(k, v)
    }
    return `/feed/${feedId}/google-ads?${q.toString()}`
  }

  const sorted = useMemo(() => {
    const copy = [...rows]
    copy.sort((a, b) => compare(a[sortKey], b[sortKey], sortDir))
    return copy
  }, [rows, sortKey, sortDir])

  const unmatchedCost = useMemo(
    () => rows.filter((r) => r.unmatched).reduce((n, r) => n + r.cost, 0),
    [rows]
  )

  function setSort(key: SortKey) {
    if (key === sortKey) setSortDir((d) => (d === 1 ? -1 : 1))
    else {
      setSortKey(key)
      setSortDir(-1)
    }
  }

  async function toggle(productRef: string | null) {
    if (!productRef) return
    if (expanded === productRef) {
      setExpanded(null)
      return
    }
    setExpanded(productRef)
    if (variants[productRef]) return

    setLoadingVariants(productRef)
    try {
      const q = new URLSearchParams({ product: productRef, days: String(days) })
      if (activeActions.roas) q.set('roas', activeActions.roas)
      if (activeActions.poas) q.set('poas', activeActions.poas)
      const res = await fetch(`/api/google-ads/${feedId}/variants?${q.toString()}`)
      const json = await res.json()
      if (res.ok) setVariants((v) => ({ ...v, [productRef]: json.variants ?? [] }))
    } finally {
      setLoadingVariants(null)
    }
  }

  // Persists the current on-page choice as the feed's default, so a fresh visit
  // (and later the bucket engine) uses it. syncNow is false: the data is already
  // stored for every action, so changing the definition needs no re-fetch.
  async function saveDefaults() {
    if (!settings?.customerId) return
    setSavingDefaults(true)
    try {
      await fetch(`/api/google-ads/${feedId}/settings`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          customerId: settings.customerId,
          customerName: settings.customerName,
          currencyCode: settings.currency,
          feedLabel: settings.feedLabel,
          roasConversionAction: activeActions.roas,
          poasConversionAction: activeActions.poas,
          syncNow: false,
        }),
      })
      router.refresh()
    } finally {
      setSavingDefaults(false)
    }
  }

  async function refresh() {
    setSyncing(true)
    setSyncError(null)
    setSyncNote(null)
    try {
      const res = await fetch(`/api/google-ads/${feedId}/sync`, { method: 'POST' })
      const json = await res.json()
      if (!res.ok) {
        setSyncError(json.error ?? 'Sync failed')
        return
      }
      const warnings: string[] = json.result?.warnings ?? []
      if (warnings.length) setSyncNote(warnings.join(' '))
      setVariants({})
      router.refresh()
    } catch {
      setSyncError('Could not reach the server')
    } finally {
      setSyncing(false)
    }
  }

  return (
    <div className="min-h-screen" style={{ background: 'var(--bg-base)' }}>
      <main className="max-w-6xl mx-auto px-6 py-9 space-y-7">
        {/* ── Header ─────────────────────────────────────────────── */}
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
              Product performance
            </h1>
            {connected && settings && (
              <p style={{ fontSize: '13px', color: 'var(--ink-muted)' }}>
                {settings.customerName ?? settings.customerId}
                {settings.feedLabel ? ` · ${settings.feedLabel}` : ''}
                {from && ` · ${from} → ${to}`}
              </p>
            )}
          </div>

          {connected && (
            <div className="flex items-center gap-2">
              <div className="flex items-center gap-1">
                {windows.map((w) => (
                  <button
                    key={w}
                    onClick={() => router.push(urlWith({ days: String(w) }))}
                    className="wl-pill"
                    style={{
                      cursor: 'pointer',
                      background: w === days ? 'var(--accent-purple)' : 'transparent',
                      color: w === days ? '#fff' : 'var(--ink-muted)',
                      border: w === days ? 'none' : '1px solid var(--hairline)',
                    }}
                  >
                    {w}d
                  </button>
                ))}
              </div>
              <button
                onClick={() => setShowSetup((s) => !s)}
                className="wl-btn-secondary shrink-0"
              >
                Settings
              </button>
              <button onClick={refresh} disabled={syncing} className="wl-btn-primary shrink-0">
                {syncing ? 'Fetching…' : 'Refresh data'}
              </button>
            </div>
          )}
        </header>

        {/* Outcome of the OAuth redirect, which lands back here with a query flag. */}
        {connectError && (
          <div className="wl-card" style={{ padding: '16px' }}>
            <div className="flex items-start gap-2.5">
              <span className="wl-dot shrink-0" style={{ background: 'var(--accent-red)', marginTop: '5px' }} />
              <p style={{ fontSize: '13px', color: 'var(--ink-secondary)' }}>{connectError}</p>
            </div>
          </div>
        )}
        {justConnected && !connected && (
          <div className="wl-card" style={{ padding: '16px' }}>
            <div className="flex items-start gap-2.5">
              <span className="wl-dot shrink-0" style={{ background: 'var(--accent-green)', marginTop: '5px' }} />
              <p style={{ fontSize: '13px', color: 'var(--ink-secondary)' }}>
                Google Ads is authorised. Now choose the account.
              </p>
            </div>
          </div>
        )}

        {/* ── Setup ──────────────────────────────────────────────── */}
        {showSetup && (
          <GoogleAdsSetup
            feedId={feedId}
            hasConnection={hasConnection}
            current={{
              customerId: settings?.customerId ?? null,
              roasAction: settings?.roasAction ?? null,
              poasAction: settings?.poasAction ?? null,
              feedLabel: settings?.feedLabel ?? null,
            }}
            onDone={() => setShowSetup(false)}
          />
        )}

        {/* ── Setup warnings on a connected feed ─────────────────── */}
        {connected && setupIssues.length > 0 && (
          <div className="wl-card" style={{ padding: '16px' }}>
            <div className="flex items-start gap-2.5">
              <span
                className="wl-dot shrink-0"
                style={{ background: 'var(--accent-amber)', marginTop: '5px' }}
              />
              <div>
                <p style={{ fontSize: '13px', fontWeight: 500, color: 'var(--ink)' }}>
                  Setup is incomplete
                </p>
                {setupIssues.map((i) => (
                  <p key={i} style={{ fontSize: '12px', color: 'var(--ink-secondary)' }}>
                    {i}
                  </p>
                ))}
              </div>
            </div>
          </div>
        )}

        {(syncError || settings?.lastSyncError) && (
          <div className="wl-card" style={{ padding: '16px' }}>
            <div className="flex items-start gap-2.5">
              <span
                className="wl-dot shrink-0"
                style={{ background: 'var(--accent-red)', marginTop: '5px' }}
              />
              <p style={{ fontSize: '13px', color: 'var(--ink-secondary)' }}>
                {syncError ?? settings?.lastSyncError}
              </p>
            </div>
          </div>
        )}

        {syncNote && (
          <div className="wl-card" style={{ padding: '16px' }}>
            <p style={{ fontSize: '13px', color: 'var(--ink-secondary)' }}>{syncNote}</p>
          </div>
        )}

        {/* ── What the numbers mean ─────────────────────────────── */}
        {connected && availableActions.length > 0 && (
          <section className="wl-card" style={{ padding: '16px 18px' }}>
            <div className="flex flex-wrap items-end gap-4">
              <MetricPicker
                label="Revenue (ROAS)"
                value={activeActions.roas}
                actions={availableActions}
                currency={currency}
                onChange={(v) => router.push(urlWith({ roas: v }))}
              />
              <MetricPicker
                label="Gross profit (POAS)"
                value={activeActions.poas}
                actions={availableActions}
                currency={currency}
                onChange={(v) => router.push(urlWith({ poas: v }))}
              />
              {settings &&
                (activeActions.roas !== settings.roasAction ||
                  activeActions.poas !== settings.poasAction) && (
                  <button
                    onClick={saveDefaults}
                    disabled={savingDefaults}
                    className="wl-btn-secondary"
                  >
                    {savingDefaults ? 'Saving…' : 'Save as default'}
                  </button>
                )}
            </div>
            <p
              style={{
                fontSize: '12px',
                color: 'var(--ink-muted)',
                marginTop: '10px',
                lineHeight: 1.5,
                maxWidth: '62ch',
              }}
            >
              The same order is usually counted by several actions at once. The amount next
              to each action is what it reports over the period — an action reporting many
              times the real revenue is normally a &laquo;view item&raquo; tracker, not revenue.
              Switch freely: every action has already been fetched.
            </p>
          </section>
        )}

        {/* ── KPIs ───────────────────────────────────────────────── */}
        {connected && totals && (
          <section className="grid gap-3" style={{ gridTemplateColumns: 'repeat(auto-fit,minmax(150px,1fr))' }}>
            <Stat label="Cost" value={formatMoney(totals.cost, currency)} />
            <Stat label="Revenue" value={formatMoney(totals.roas_value, currency)} />
            <Stat
              label="ROAS"
              value={formatRatio(totals.roas)}
              tone={totals.roas === null ? undefined : totals.roas >= 1 ? 'good' : 'bad'}
            />
            <Stat label="Gross profit" value={formatMoney(totals.poas_value, currency)} />
            <Stat
              label="POAS"
              value={formatRatio(totals.poas)}
              tone={totals.poas === null ? undefined : totals.poas >= 1 ? 'good' : 'bad'}
              hint={
                totals.poas !== null && totals.poas < 1
                  ? 'Below 1 = ads cost more than the gross profit they return'
                  : undefined
              }
            />
            <Stat label="Clicks" value={formatInt(totals.clicks)} />
          </section>
        )}

        {/* ── Table ──────────────────────────────────────────────── */}
        {connected && rows.length === 0 && (
          <div className="wl-card py-16 flex flex-col items-center gap-3">
            <p style={{ fontSize: '15px', color: 'var(--ink-secondary)' }}>
              No data in this period.
            </p>
            <p style={{ fontSize: '13px', color: 'var(--ink-muted)' }}>
              {settings?.lastSyncedAt
                ? 'The account had no shopping impressions in this window.'
                : 'The feed is connected, but no data has been fetched yet.'}
            </p>
            <button onClick={refresh} disabled={syncing} className="wl-btn-secondary mt-1">
              {syncing ? 'Fetching…' : 'Fetch data now'}
            </button>
          </div>
        )}

        {connected && rows.length > 0 && (
          <section className="wl-card" style={{ padding: 0, overflow: 'hidden' }}>
            <div style={{ overflowX: 'auto' }}>
              <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '13px' }}>
                <thead>
                  <tr style={{ borderBottom: '1px solid var(--hairline)' }}>
                    <Th style={{ textAlign: 'left', paddingLeft: '18px' }}>Product</Th>
                    <Th sortable active={sortKey === 'impressions'} dir={sortDir} onClick={() => setSort('impressions')}>
                      Impressions
                    </Th>
                    <Th sortable active={sortKey === 'clicks'} dir={sortDir} onClick={() => setSort('clicks')}>
                      Clicks
                    </Th>
                    <Th sortable active={sortKey === 'cost'} dir={sortDir} onClick={() => setSort('cost')}>
                      Cost
                    </Th>
                    <Th sortable active={sortKey === 'roas_value'} dir={sortDir} onClick={() => setSort('roas_value')}>
                      Revenue
                    </Th>
                    <Th sortable active={sortKey === 'roas'} dir={sortDir} onClick={() => setSort('roas')}>
                      ROAS
                    </Th>
                    <Th sortable active={sortKey === 'poas_value'} dir={sortDir} onClick={() => setSort('poas_value')}>
                      Profit
                    </Th>
                    <Th sortable active={sortKey === 'poas'} dir={sortDir} onClick={() => setSort('poas')}>
                      POAS
                    </Th>
                    <Th style={{ paddingRight: '18px' }}>Profit − cost</Th>
                  </tr>
                </thead>
                <tbody>
                  {sorted.map((r, idx) => {
                    const key = r.productRef ?? `unmatched-${idx}`
                    const isOpen = expanded === r.productRef
                    return (
                      <Fragment key={key}>
                        <tr
                          onClick={() => toggle(r.productRef)}
                          style={{
                            borderBottom: '1px solid var(--hairline)',
                            cursor: r.productRef ? 'pointer' : 'default',
                            background: isOpen ? 'var(--bg-surface)' : undefined,
                          }}
                        >
                          <td style={{ padding: '11px 12px 11px 18px', maxWidth: '320px' }}>
                            <div className="flex items-center gap-2.5">
                              <span
                                style={{
                                  color: 'var(--ink-muted)',
                                  fontSize: '10px',
                                  width: '10px',
                                  display: 'inline-block',
                                }}
                              >
                                {r.productRef ? (isOpen ? '▾' : '▸') : ''}
                              </span>
                              <div className="min-w-0">
                                <div className="truncate" style={{ color: 'var(--ink)' }}>
                                  {r.title ?? r.productRef ?? 'Unknown item'}
                                </div>
                                <div style={{ fontSize: '11px', color: 'var(--ink-muted)' }}>
                                  {r.unmatched ? (
                                    <span style={{ color: 'var(--accent-amber)' }}>
                                      not found in the catalogue
                                    </span>
                                  ) : (
                                    `${r.variantCount} variant${r.variantCount === 1 ? '' : 's'}`
                                  )}
                                </div>
                              </div>
                            </div>
                          </td>
                          <Td>{formatInt(r.impressions)}</Td>
                          <Td>{formatInt(r.clicks)}</Td>
                          <Td>{formatMoney(r.cost, currency)}</Td>
                          <Td>{formatMoney(r.roas_value, currency)}</Td>
                          <Td>
                            <Ratio value={r.roas} />
                          </Td>
                          <Td>{formatMoney(r.poas_value, currency)}</Td>
                          <Td>
                            <Ratio value={r.poas} />
                          </Td>
                          <Td style={{ paddingRight: '18px' }}>
                            <span
                              style={{
                                color:
                                  r.profitAfterAdSpend === null
                                    ? 'var(--ink-muted)'
                                    : r.profitAfterAdSpend >= 0
                                      ? 'var(--ink)'
                                      : 'var(--accent-red)',
                              }}
                            >
                              {formatMoney(r.profitAfterAdSpend, currency)}
                            </span>
                          </Td>
                        </tr>

                        {isOpen && (
                          <tr>
                            <td colSpan={9} style={{ background: 'var(--bg-surface)', padding: '0 18px 14px 40px' }}>
                              {loadingVariants === r.productRef ? (
                                <p style={{ fontSize: '12px', color: 'var(--ink-muted)', padding: '10px 0' }}>
                                  Loading variants…
                                </p>
                              ) : (
                                <VariantTable
                                  rows={variants[r.productRef ?? ''] ?? []}
                                  currency={currency}
                                />
                              )}
                            </td>
                          </tr>
                        )}
                      </Fragment>
                    )
                  })}
                </tbody>
              </table>
            </div>
          </section>
        )}

        {/* ── Footnotes that stop the numbers being misread ──────── */}
        {connected && rows.length > 0 && (
          <div className="space-y-1.5" style={{ fontSize: '12px', color: 'var(--ink-muted)' }}>
            <p>
              Revenue = &laquo;{activeActions.roas ?? 'not selected'}&raquo; · Gross profit =
              &laquo;{activeActions.poas ?? 'not selected'}&raquo;
            </p>
            <p>
              Only cost Google can attribute to a product is included. Performance Max
              spend on non-shopping placements is not counted, so these figures are lower
              than the account&apos;s total cost.
            </p>
            {unmatchedCost > 0 && (
              <p style={{ color: 'var(--accent-amber)' }}>
                {formatMoney(unmatchedCost, currency)} could not be matched to a product in
                this feed.
              </p>
            )}
            {settings?.lastSyncedAt && (
              <p>Last fetched {new Date(settings.lastSyncedAt).toLocaleString('da-DK')}</p>
            )}
          </div>
        )}
      </main>
    </div>
  )
}

// ── Small pieces ─────────────────────────────────────────────────────────────

function Stat({
  label,
  value,
  tone,
  hint,
}: {
  label: string
  value: string
  tone?: 'good' | 'bad'
  hint?: string
}) {
  return (
    <div className="wl-card" style={{ padding: '16px 18px' }}>
      <div className="wl-eyebrow">{label}</div>
      <div
        style={{
          fontSize: '26px',
          fontWeight: 500,
          letterSpacing: '-0.01em',
          marginTop: '6px',
          color:
            tone === 'bad' ? 'var(--accent-red)' : tone === 'good' ? 'var(--ink)' : 'var(--ink)',
        }}
      >
        {value}
      </div>
      {hint && (
        <div style={{ fontSize: '11px', color: 'var(--ink-muted)', marginTop: '4px', lineHeight: 1.4 }}>
          {hint}
        </div>
      )}
    </div>
  )
}

function MetricPicker({
  label,
  value,
  actions,
  currency,
  onChange,
}: {
  label: string
  value: string | null
  actions: AvailableAction[]
  currency: string
  onChange: (v: string) => void
}) {
  return (
    <div className="space-y-1.5" style={{ minWidth: '260px', flex: '1 1 260px' }}>
      <div className="wl-eyebrow">{label}</div>
      <select
        value={value ?? ''}
        onChange={(e) => onChange(e.target.value)}
        style={{
          width: '100%',
          padding: '8px 10px',
          borderRadius: '10px',
          border: '1px solid var(--hairline)',
          background: 'var(--bg-base)',
          color: 'var(--ink)',
          fontSize: '13px',
        }}
      >
        <option value="">Not selected</option>
        {actions.map((a) => (
          <option key={a.name} value={a.name}>
            {a.name} — {formatMoney(a.value, currency)} · {a.items} items
          </option>
        ))}
      </select>
    </div>
  )
}

function Th({
  children,
  sortable,
  active,
  dir,
  onClick,
  style,
}: {
  children: React.ReactNode
  sortable?: boolean
  active?: boolean
  dir?: 1 | -1
  onClick?: () => void
  style?: React.CSSProperties
}) {
  return (
    <th
      onClick={onClick}
      style={{
        padding: '10px 12px',
        textAlign: 'right',
        fontSize: '10px',
        fontWeight: 500,
        textTransform: 'uppercase',
        letterSpacing: '0.08em',
        color: active ? 'var(--ink)' : 'var(--ink-muted)',
        cursor: sortable ? 'pointer' : 'default',
        whiteSpace: 'nowrap',
        ...style,
      }}
    >
      {children}
      {active && <span style={{ marginLeft: '4px' }}>{dir === 1 ? '↑' : '↓'}</span>}
    </th>
  )
}

function Td({ children, style }: { children: React.ReactNode; style?: React.CSSProperties }) {
  return (
    <td
      style={{
        padding: '11px 12px',
        textAlign: 'right',
        color: 'var(--ink-secondary)',
        whiteSpace: 'nowrap',
        fontVariantNumeric: 'tabular-nums',
        ...style,
      }}
    >
      {children}
    </td>
  )
}

function Ratio({ value }: { value: number | null }) {
  if (value === null) return <span style={{ color: 'var(--ink-muted)' }}>—</span>
  return (
    <span
      className="wl-pill"
      style={{
        background: value >= 1 ? 'rgba(31,180,106,0.12)' : 'rgba(224,82,76,0.12)',
        color: value >= 1 ? 'var(--accent-green)' : 'var(--accent-red)',
      }}
    >
      {formatRatio(value)}
    </span>
  )
}

function VariantTable({ rows, currency }: { rows: VariantRow[]; currency: string }) {
  if (!rows.length) {
    return (
      <p style={{ fontSize: '12px', color: 'var(--ink-muted)', padding: '10px 0' }}>
        No variant data in this period.
      </p>
    )
  }
  return (
    <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '12px' }}>
      <tbody>
        {rows
          .slice()
          .sort((a, b) => b.cost - a.cost)
          .map((v) => (
            <tr key={v.itemId} style={{ borderBottom: '0.5px solid var(--hairline)' }}>
              <td style={{ padding: '8px 12px 8px 0', color: 'var(--ink-secondary)' }}>
                {v.options.length ? v.options.join(' · ') : (v.variantTitle ?? v.itemId)}
                {v.sku && (
                  <span style={{ color: 'var(--ink-muted)', marginLeft: '8px' }}>{v.sku}</span>
                )}
              </td>
              <Td>{formatInt(v.impressions)}</Td>
              <Td>{formatInt(v.clicks)}</Td>
              <Td>{formatMoney(v.cost, currency)}</Td>
              <Td>{formatMoney(v.roas_value, currency)}</Td>
              <Td>
                <Ratio value={v.roas} />
              </Td>
              <Td>{formatMoney(v.poas_value, currency)}</Td>
              <Td style={{ paddingRight: 0 }}>
                <Ratio value={v.poas} />
              </Td>
            </tr>
          ))}
      </tbody>
    </table>
  )
}
