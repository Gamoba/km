'use client'

import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { useMemo, useState } from 'react'
import {
  BUCKET_METRICS,
  type Bucket,
  type BucketLevel,
  type BucketMetric,
  type BucketOperator,
  type BucketRule,
} from '@/lib/googleAdsBuckets'

export type MemberRow = { ref: string; bucketId: string; title: string | null }

type Props = {
  feedId: string
  feedName: string
  connected: boolean
  level: BucketLevel
  windowDays: number
  computedAt: string | null
  currency: string | null
  roasAction: string | null
  poasAction: string | null
  buckets: Bucket[]
  counts: Record<string, number>
  members: MemberRow[]
  totalMembers: number
}

const METRIC_LABEL: Record<BucketMetric, string> = {
  roas: 'ROAS',
  poas: 'POAS',
  conversions: 'Conversions',
  conversions_value: 'Revenue',
  cost: 'Cost',
  clicks: 'Clicks',
  impressions: 'Impressions',
  profit_after_ad_spend: 'Profit − cost',
}

const OPERATORS: { value: BucketOperator; label: string; needsValue: boolean }[] = [
  { value: 'gt', label: '>', needsValue: true },
  { value: 'gte', label: '≥', needsValue: true },
  { value: 'lt', label: '<', needsValue: true },
  { value: 'lte', label: '≤', needsValue: true },
  { value: 'eq', label: '=', needsValue: true },
  { value: 'neq', label: '≠', needsValue: true },
  { value: 'is_empty', label: 'has no value', needsValue: false },
  { value: 'is_not_empty', label: 'has a value', needsValue: false },
]

const WINDOWS = [7, 14, 30, 90, 180, 365]

export function BucketsClient(props: Props) {
  const {
    feedId,
    feedName,
    connected,
    level,
    windowDays,
    computedAt,
    roasAction,
    poasAction,
    buckets,
    counts,
    members,
    totalMembers,
  } = props

  const router = useRouter()
  const [busy, setBusy] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [note, setNote] = useState<string | null>(null)
  const [draft, setDraft] = useState<Record<string, Bucket>>({})
  const [filter, setFilter] = useState<string>('')

  const bucketName = useMemo(
    () => new Map(buckets.map((b) => [b.id, b])),
    [buckets]
  )
  const assigned = Object.values(counts).reduce((a, b) => a + b, 0)

  const shown = filter ? members.filter((m) => m.bucketId === filter) : members

  // Local edits are held until saved, so typing a threshold doesn't fire a
  // request per keystroke — and an abandoned edit leaves nothing behind.
  const edited = (b: Bucket) => draft[b.id] ?? b
  const isDirty = (b: Bucket) => !!draft[b.id]

  function patch(b: Bucket, change: Partial<Bucket>) {
    setDraft((d) => ({ ...d, [b.id]: { ...edited(b), ...change } }))
  }

  async function call(url: string, init?: RequestInit): Promise<Record<string, unknown> | null> {
    const res = await fetch(url, init)
    const json = await res.json().catch(() => ({}))
    if (!res.ok) {
      setError((json as { error?: string }).error ?? 'Something went wrong')
      return null
    }
    return json as Record<string, unknown>
  }

  async function save(b: Bucket) {
    setBusy(b.id)
    setError(null)
    const body = edited(b)
    const ok = await call(`/api/google-ads/${feedId}/buckets`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'save', bucket: body }),
    })
    setBusy(null)
    if (ok) {
      setDraft((d) => {
        const next = { ...d }
        delete next[b.id]
        return next
      })
      await recompute(false)
    }
  }

  async function addBucket() {
    setBusy('add')
    setError(null)
    const nextPriority = Math.max(0, ...buckets.filter((b) => !b.is_fallback).map((b) => b.priority)) + 10
    const ok = await call(`/api/google-ads/${feedId}/buckets`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        action: 'save',
        bucket: {
          name: `Bucket ${buckets.length + 1}`,
          priority: nextPriority,
          match_type: 'ALL',
          rules: [{ metric: 'poas', operator: 'lt', value: 1 }],
        },
      }),
    })
    setBusy(null)
    if (ok) router.refresh()
  }

  async function seed() {
    setBusy('seed')
    setError(null)
    const ok = await call(`/api/google-ads/${feedId}/buckets`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'seed' }),
    })
    setBusy(null)
    if (ok) await recompute(true)
  }

  async function remove(b: Bucket) {
    setBusy(b.id)
    setError(null)
    const ok = await call(`/api/google-ads/${feedId}/buckets?id=${b.id}`, { method: 'DELETE' })
    setBusy(null)
    if (ok) await recompute(false)
  }

  async function setSettings(change: { level?: BucketLevel; windowDays?: number }) {
    setBusy('settings')
    setError(null)
    const ok = await call(`/api/google-ads/${feedId}/buckets`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'settings', ...change }),
    })
    setBusy(null)
    if (ok) await recompute(false)
  }

  async function recompute(refreshFirst: boolean) {
    setBusy('recompute')
    setError(null)
    const json = await call(`/api/google-ads/${feedId}/buckets/recompute`, { method: 'POST' })
    setBusy(null)
    if (json) {
      const r = json.result as {
        entities: number
        withData: number
        assigned: number
        unassigned: number
        moved: number
        warnings: string[]
      }
      setNote(
        `${r.assigned} of ${r.entities} assigned · ${r.moved} changed bucket · ` +
          `${r.entities - r.withData} have no Google data` +
          (r.unassigned ? ` · ${r.unassigned} matched nothing` : '')
      )
      if (r.warnings?.length) setError(r.warnings.join(' '))
    }
    if (refreshFirst || json) router.refresh()
  }

  if (!connected) {
    return (
      <Shell feedName={feedName}>
        <div className="wl-card" style={{ padding: '40px' }}>
          <div className="max-w-xl space-y-3">
            <h2 style={{ fontSize: '20px', fontWeight: 500, color: 'var(--ink)' }}>
              Not connected to Google Ads
            </h2>
            <p style={{ fontSize: '15px', lineHeight: 1.6, color: 'var(--ink-secondary)' }}>
              Buckets label products by how they perform, so this feed needs a Google Ads
              connection and at least one sync first.
            </p>
            <Link href={`/feed/${feedId}/google-ads`} className="wl-btn-primary inline-block">
              Go to Performance →
            </Link>
          </div>
        </div>
      </Shell>
    )
  }

  const sameAction = roasAction && roasAction === poasAction

  return (
    <Shell feedName={feedName}>
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
            Buckets
          </h1>
          <p style={{ fontSize: '13px', color: 'var(--ink-muted)' }}>
            {assigned} of {totalMembers || assigned} labelled
            {computedAt && ` · last computed ${new Date(computedAt).toLocaleString('da-DK')}`}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Link href={`/feed/${feedId}/google-ads`} className="wl-btn-secondary">
            Performance
          </Link>
          <button
            onClick={() => recompute(false)}
            disabled={busy === 'recompute'}
            className="wl-btn-primary"
          >
            {busy === 'recompute' ? 'Computing…' : 'Recompute'}
          </button>
        </div>
      </header>

      {/* Nothing published, stated plainly rather than assumed. */}
      <div className="wl-card" style={{ padding: '14px 18px' }}>
        <div className="flex items-start gap-2.5">
          <span className="wl-dot shrink-0" style={{ background: 'var(--accent-green)', marginTop: '5px' }} />
          <p style={{ fontSize: '12px', color: 'var(--ink-secondary)', lineHeight: 1.5 }}>
            Labels are computed and shown here only. Nothing is written to the product feed
            and nothing is sent to Merchant Center.
          </p>
        </div>
      </div>

      {error && <Banner tone="red">{error}</Banner>}
      {note && !error && <Banner tone="green">{note}</Banner>}
      {sameAction && (
        <Banner tone="amber">
          Revenue and gross profit both point at «{roasAction}», so POAS equals ROAS and any
          POAS rule is really a ROAS rule. Fix it on the Performance page.
        </Banner>
      )}

      {/* ── Set-level configuration ─────────────────────────────── */}
      <section className="wl-card" style={{ padding: '16px 18px' }}>
        <div className="flex flex-wrap items-end gap-6">
          <div className="space-y-1.5">
            <div className="wl-eyebrow">Level</div>
            <div className="flex gap-1">
              {(['product', 'variant'] as BucketLevel[]).map((l) => (
                <button
                  key={l}
                  onClick={() => l !== level && setSettings({ level: l })}
                  disabled={busy === 'settings'}
                  className="wl-pill"
                  style={{
                    cursor: 'pointer',
                    background: l === level ? 'var(--accent-purple)' : 'transparent',
                    color: l === level ? '#fff' : 'var(--ink-muted)',
                    border: l === level ? 'none' : '1px solid var(--hairline)',
                  }}
                >
                  {l === 'product' ? 'Per product' : 'Per variant'}
                </button>
              ))}
            </div>
          </div>

          <div className="space-y-1.5">
            <div className="wl-eyebrow">Rule window</div>
            <div className="flex gap-1">
              {WINDOWS.map((w) => (
                <button
                  key={w}
                  onClick={() => w !== windowDays && setSettings({ windowDays: w })}
                  disabled={busy === 'settings'}
                  className="wl-pill"
                  style={{
                    cursor: 'pointer',
                    background: w === windowDays ? 'var(--accent-purple)' : 'transparent',
                    color: w === windowDays ? '#fff' : 'var(--ink-muted)',
                    border: w === windowDays ? 'none' : '1px solid var(--hairline)',
                  }}
                >
                  {w}d
                </button>
              ))}
            </div>
          </div>
        </div>
        <p style={{ fontSize: '12px', color: 'var(--ink-muted)', marginTop: '10px', maxWidth: '64ch', lineHeight: 1.5 }}>
          Rules are evaluated over this window, independently of the window you browse on
          the Performance page — so labels don&apos;t shift because someone changed the view.
        </p>
      </section>

      {/* ── Buckets ─────────────────────────────────────────────── */}
      {buckets.length === 0 ? (
        <div className="wl-card py-16 flex flex-col items-center gap-3">
          <p style={{ fontSize: '15px', color: 'var(--ink-secondary)' }}>No buckets yet.</p>
          <p style={{ fontSize: '13px', color: 'var(--ink-muted)', maxWidth: '46ch', textAlign: 'center', lineHeight: 1.5 }}>
            Start from a suggested set — no traffic, too little data, zombies, losing money,
            heroes — then adjust the thresholds to the client.
          </p>
          <div className="flex gap-2 mt-1">
            <button onClick={seed} disabled={busy === 'seed'} className="wl-btn-primary">
              {busy === 'seed' ? 'Creating…' : 'Use suggested set'}
            </button>
            <button onClick={addBucket} disabled={busy === 'add'} className="wl-btn-secondary">
              Start empty
            </button>
          </div>
        </div>
      ) : (
        <section className="space-y-3">
          {buckets.map((b) => {
            const e = edited(b)
            const count = counts[b.id] ?? 0
            const share = assigned ? Math.round((count / assigned) * 100) : 0
            return (
              <div key={b.id} className="wl-card" style={{ padding: '16px 18px' }}>
                <div className="flex items-start justify-between gap-4 flex-wrap">
                  <div className="flex items-center gap-3 min-w-0">
                    <span
                      className="wl-pill"
                      style={{ background: 'var(--bg-surface)', color: 'var(--ink-muted)' }}
                      title="Evaluation order — first match wins"
                    >
                      {b.is_fallback ? 'last' : e.priority}
                    </span>
                    <input
                      value={e.name}
                      onChange={(ev) => patch(b, { name: ev.target.value })}
                      style={{
                        fontSize: '15px',
                        fontWeight: 500,
                        color: 'var(--ink)',
                        background: 'transparent',
                        border: 'none',
                        outline: 'none',
                        minWidth: '10ch',
                      }}
                    />
                  </div>
                  <div className="flex items-center gap-3">
                    <span style={{ fontSize: '13px', color: 'var(--ink)' }}>
                      {count} <span style={{ color: 'var(--ink-muted)' }}>({share}%)</span>
                    </span>
                    <div
                      style={{
                        width: '90px',
                        height: '6px',
                        borderRadius: '3px',
                        background: 'var(--bg-surface)',
                        overflow: 'hidden',
                      }}
                    >
                      <div
                        style={{
                          width: `${share}%`,
                          height: '100%',
                          background: 'var(--accent-purple)',
                        }}
                      />
                    </div>
                  </div>
                </div>

                {b.is_fallback ? (
                  <p style={{ fontSize: '12px', color: 'var(--ink-muted)', marginTop: '10px' }}>
                    Catch-all — everything no earlier bucket matched.
                  </p>
                ) : (
                  <div className="space-y-2" style={{ marginTop: '12px' }}>
                    {(e.rules ?? []).map((rule, i) => (
                      <RuleRow
                        key={i}
                        rule={rule}
                        matchType={e.match_type}
                        showJoin={i > 0}
                        onJoinChange={(m) => patch(b, { match_type: m })}
                        onChange={(next) =>
                          patch(b, { rules: e.rules.map((r, j) => (j === i ? next : r)) })
                        }
                        onRemove={() => patch(b, { rules: e.rules.filter((_, j) => j !== i) })}
                      />
                    ))}
                    <button
                      onClick={() =>
                        patch(b, {
                          rules: [...(e.rules ?? []), { metric: 'clicks', operator: 'gte', value: 25 }],
                        })
                      }
                      style={{
                        fontSize: '12px',
                        color: 'var(--accent-purple)',
                        background: 'none',
                        border: 'none',
                        cursor: 'pointer',
                        padding: 0,
                      }}
                    >
                      + Add condition
                    </button>
                  </div>
                )}

                <div className="flex items-center justify-between gap-3 flex-wrap" style={{ marginTop: '14px' }}>
                  <div className="flex items-center gap-2">
                    <span className="wl-eyebrow">Custom label</span>
                    <select
                      value={e.custom_label_index ?? ''}
                      onChange={(ev) =>
                        patch(b, {
                          custom_label_index: ev.target.value === '' ? null : Number(ev.target.value),
                          custom_label_value:
                            ev.target.value === '' ? null : (e.custom_label_value || e.name),
                        })
                      }
                      style={miniInput}
                    >
                      <option value="">none</option>
                      {[0, 1, 2, 3, 4].map((n) => (
                        <option key={n} value={n}>
                          custom_label_{n}
                        </option>
                      ))}
                    </select>
                    {e.custom_label_index !== null && (
                      <input
                        value={e.custom_label_value ?? ''}
                        onChange={(ev) => patch(b, { custom_label_value: ev.target.value })}
                        placeholder="value"
                        style={{ ...miniInput, width: '140px' }}
                      />
                    )}
                  </div>

                  <div className="flex items-center gap-2">
                    {isDirty(b) && (
                      <button onClick={() => save(b)} disabled={busy === b.id} className="wl-btn-primary">
                        {busy === b.id ? 'Saving…' : 'Save'}
                      </button>
                    )}
                    <button
                      onClick={() => remove(b)}
                      disabled={busy === b.id}
                      className="wl-btn-secondary"
                      style={{ color: 'var(--accent-red)' }}
                    >
                      Delete
                    </button>
                  </div>
                </div>
              </div>
            )
          })}

          <button onClick={addBucket} disabled={busy === 'add'} className="wl-btn-secondary">
            + Add bucket
          </button>
        </section>
      )}

      {/* ── ID | label table ────────────────────────────────────── */}
      {members.length > 0 && (
        <section className="wl-card" style={{ padding: 0, overflow: 'hidden' }}>
          <div
            className="flex items-center justify-between gap-3 flex-wrap"
            style={{ padding: '14px 18px', borderBottom: '1px solid var(--hairline)' }}
          >
            <span className="wl-eyebrow">
              {level === 'product' ? 'Product ID' : 'Item ID'} · Bucket · Custom label
            </span>
            <select value={filter} onChange={(e) => setFilter(e.target.value)} style={miniInput}>
              <option value="">All buckets</option>
              {buckets.map((b) => (
                <option key={b.id} value={b.id}>
                  {b.name} ({counts[b.id] ?? 0})
                </option>
              ))}
            </select>
          </div>
          <div style={{ overflowX: 'auto', maxHeight: '480px', overflowY: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '12px' }}>
              <tbody>
                {shown.map((m) => {
                  const b = bucketName.get(m.bucketId)
                  return (
                    <tr key={m.ref} style={{ borderBottom: '0.5px solid var(--hairline)' }}>
                      <td
                        style={{
                          padding: '8px 12px 8px 18px',
                          fontVariantNumeric: 'tabular-nums',
                          color: 'var(--ink-secondary)',
                          whiteSpace: 'nowrap',
                        }}
                      >
                        {m.ref}
                      </td>
                      <td style={{ padding: '8px 12px', color: 'var(--ink)', maxWidth: '320px' }}>
                        <span className="truncate block">{m.title ?? '—'}</span>
                      </td>
                      <td style={{ padding: '8px 12px', whiteSpace: 'nowrap' }}>
                        <span className="wl-pill" style={{ background: 'var(--bg-surface)', color: 'var(--ink)' }}>
                          {b?.name ?? '—'}
                        </span>
                      </td>
                      <td
                        style={{
                          padding: '8px 18px 8px 12px',
                          color: 'var(--ink-muted)',
                          whiteSpace: 'nowrap',
                        }}
                      >
                        {b?.custom_label_index !== null && b?.custom_label_index !== undefined
                          ? `custom_label_${b.custom_label_index} = ${b.custom_label_value}`
                          : '—'}
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
          {totalMembers > members.length && (
            <p style={{ fontSize: '11px', color: 'var(--ink-muted)', padding: '10px 18px' }}>
              Showing {members.length} of {totalMembers}.
            </p>
          )}
        </section>
      )}
    </Shell>
  )
}

// ── pieces ───────────────────────────────────────────────────────────────────

const miniInput: React.CSSProperties = {
  padding: '5px 8px',
  borderRadius: '8px',
  border: '1px solid var(--hairline)',
  background: 'var(--bg-base)',
  color: 'var(--ink)',
  fontSize: '12px',
}

function Shell({ feedName, children }: { feedName: string; children: React.ReactNode }) {
  return (
    <div className="min-h-screen" style={{ background: 'var(--bg-base)' }}>
      <main className="max-w-6xl mx-auto px-6 py-9 space-y-6">
        <span className="sr-only">{feedName}</span>
        {children}
      </main>
    </div>
  )
}

function Banner({ tone, children }: { tone: 'red' | 'green' | 'amber'; children: React.ReactNode }) {
  const colour =
    tone === 'red' ? 'var(--accent-red)' : tone === 'amber' ? 'var(--accent-amber)' : 'var(--accent-green)'
  return (
    <div className="wl-card" style={{ padding: '14px 18px' }}>
      <div className="flex items-start gap-2.5">
        <span className="wl-dot shrink-0" style={{ background: colour, marginTop: '5px' }} />
        <p style={{ fontSize: '13px', color: 'var(--ink-secondary)', lineHeight: 1.5 }}>{children}</p>
      </div>
    </div>
  )
}

function RuleRow({
  rule,
  matchType,
  showJoin,
  onJoinChange,
  onChange,
  onRemove,
}: {
  rule: BucketRule
  matchType: 'ALL' | 'ANY'
  showJoin: boolean
  onJoinChange: (m: 'ALL' | 'ANY') => void
  onChange: (r: BucketRule) => void
  onRemove: () => void
}) {
  const op = OPERATORS.find((o) => o.value === rule.operator)
  return (
    <div className="flex items-center gap-2 flex-wrap">
      <div style={{ width: '48px' }}>
        {showJoin ? (
          <select
            value={matchType}
            onChange={(e) => onJoinChange(e.target.value as 'ALL' | 'ANY')}
            style={{ ...miniInput, width: '100%' }}
          >
            <option value="ALL">and</option>
            <option value="ANY">or</option>
          </select>
        ) : (
          <span style={{ fontSize: '12px', color: 'var(--ink-muted)' }}>if</span>
        )}
      </div>

      <select
        value={rule.metric}
        onChange={(e) => onChange({ ...rule, metric: e.target.value as BucketMetric })}
        style={{ ...miniInput, minWidth: '130px' }}
      >
        {BUCKET_METRICS.map((m) => (
          <option key={m} value={m}>
            {METRIC_LABEL[m]}
          </option>
        ))}
      </select>

      <select
        value={rule.operator}
        onChange={(e) => onChange({ ...rule, operator: e.target.value as BucketOperator })}
        style={{ ...miniInput, minWidth: '110px' }}
      >
        {OPERATORS.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </select>

      {op?.needsValue && (
        <input
          type="number"
          step="any"
          value={rule.value ?? ''}
          onChange={(e) =>
            onChange({ ...rule, value: e.target.value === '' ? undefined : Number(e.target.value) })
          }
          style={{ ...miniInput, width: '90px' }}
        />
      )}

      <button
        onClick={onRemove}
        title="Remove condition"
        style={{
          background: 'none',
          border: 'none',
          color: 'var(--ink-muted)',
          cursor: 'pointer',
          fontSize: '14px',
          lineHeight: 1,
        }}
      >
        ×
      </button>
    </div>
  )
}
