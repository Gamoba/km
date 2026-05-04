'use client'

import Link from 'next/link'
import { useEffect, useState, useTransition } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import { runFeedValidation } from './actions'
import { FeedSection } from '../dashboard/FeedSection'
import { FeedValidation } from './FeedValidation'
import type { ValidationIssue, ValidationResult } from '@/lib/feedValidator'

type CacheInfo = {
  generated_at: string | null
  product_count: number | null
}

// Threshold below which the "Næste skridt" panel appears. Wizard-created
// feeds get 8 default mappings (the required Google fields) so they sit
// right at this line; anything less means the feed isn't usable yet.
const NEW_FEED_THRESHOLD = 8

const FULL_VALIDATION_ANCHOR = 'feed-validation-full'

export function FeedClient({
  feedId,
  feedName,
  initialCacheInfo,
  initialValidation,
  mappingCount,
  totalFields,
  lastSynced,
}: {
  feedId: string
  feedName: string
  initialCacheInfo: CacheInfo | null
  initialValidation: ValidationResult | null
  mappingCount: number
  totalFields: number
  lastSynced: string | null
}) {
  // LAG 2 — included / excluded product counts come from the slow paginated
  // countFilteredProducts call. Fetched client-side so the overview renders
  // without waiting on it; null = still loading.
  const [includedCount, setIncludedCount] = useState<number | null>(null)
  const [excludedCount, setExcludedCount] = useState<number | null>(null)
  useEffect(() => {
    let cancelled = false
    fetch(`/api/feeds/${encodeURIComponent(feedId)}/counts`)
      .then((r) => r.json())
      .then((data: { included?: number; excluded?: number }) => {
        if (cancelled) return
        setIncludedCount(data.included ?? 0)
        setExcludedCount(data.excluded ?? 0)
      })
      .catch(() => {
        if (cancelled) return
        setIncludedCount(0)
        setExcludedCount(0)
      })
    return () => {
      cancelled = true
    }
  }, [feedId])
  const searchParams = useSearchParams()
  const showSyncBanner = searchParams.get('syncing') === '1'

  // Lifted state — shared by FeedSection, NextSteps "Generer feed", the
  // status overview, the statistics grid, the validation mini and the full
  // validation panel. This keeps every section in sync after an action.
  const [cacheInfo, setCacheInfo] = useState<CacheInfo | null>(initialCacheInfo)
  const [validation, setValidation] = useState<ValidationResult | null>(initialValidation)

  const [isGenerating, setIsGenerating] = useState(false)
  const [generateError, setGenerateError] = useState<string | null>(null)

  const [isValidating, startValidating] = useTransition()
  const [validationError, setValidationError] = useState<string | null>(null)

  async function regenerate() {
    setIsGenerating(true)
    setGenerateError(null)
    try {
      const res = await fetch(`/api/feed/generate/${feedId}`, { method: 'POST' })
      if (!res.ok) {
        const j = await res.json().catch(() => ({}))
        throw new Error((j as { error?: string }).error ?? `HTTP ${res.status}`)
      }
      const info = (await res.json()) as {
        generated_at: string
        product_count: number
        validation_status: ValidationResult['status'] | null
        validation_errors: ValidationIssue[] | null
      }
      setCacheInfo({ generated_at: info.generated_at, product_count: info.product_count })
      if (info.validation_status && info.validation_errors) {
        setValidation({
          status: info.validation_status,
          issues: info.validation_errors,
          productsChecked: 0,
        })
      }
    } catch (err) {
      setGenerateError(err instanceof Error ? err.message : 'Unknown error')
    } finally {
      setIsGenerating(false)
    }
  }

  function runValidation() {
    startValidating(async () => {
      setValidationError(null)
      const res = await runFeedValidation(feedId)
      if ('error' in res) {
        setValidationError(res.error)
      } else {
        setValidation(res)
      }
    })
  }

  function scrollToFullValidation() {
    document
      .getElementById(FULL_VALIDATION_ANCHOR)
      ?.scrollIntoView({ behavior: 'smooth', block: 'start' })
  }

  return (
    <div className="min-h-screen">
      <header className="ff-topbar">
        <div className="flex items-center gap-3">
          <h1 className="ff-topbar-title">{feedName}</h1>
          <span style={{ fontSize: '11px', color: 'var(--color-text-tertiary)' }}>
            Manage your Google Shopping feed
          </span>
        </div>
      </header>

      <main className="px-4 py-4 max-w-4xl space-y-3">
        {showSyncBanner && <SyncStatusBanner feedId={feedId} />}

        <StatusOverview
          generated={!!cacheInfo?.generated_at}
          validationStatus={validation?.status ?? null}
          mappingCount={mappingCount}
          totalFields={totalFields}
        />

        <StatisticsSection
          feedItemCount={cacheInfo?.product_count ?? null}
          includedCount={includedCount}
          excludedCount={excludedCount}
          lastSynced={lastSynced}
          lastGenerated={cacheInfo?.generated_at ?? null}
        />

        {mappingCount < NEW_FEED_THRESHOLD && (
          <NextSteps
            feedId={feedId}
            onGenerate={regenerate}
            isGenerating={isGenerating}
          />
        )}

        <ValidationMini
          result={validation}
          isRunning={isValidating}
          onRun={runValidation}
          runError={validationError}
          onShowDetails={scrollToFullValidation}
        />

        <FeedSection
          feedId={feedId}
          cacheInfo={cacheInfo}
          onRegenerate={regenerate}
          isRegenerating={isGenerating}
          error={generateError}
        />

        <div id={FULL_VALIDATION_ANCHOR}>
          <FeedValidation
            result={validation}
            isRunning={isValidating}
            onRun={runValidation}
            runError={validationError}
          />
        </div>
      </main>
    </div>
  )
}

// ── Status overview ────────────────────────────────────────────────────────

type StatusKind = 'ready' | 'warnings' | 'errors' | 'not-generated'

function deriveStatus(
  generated: boolean,
  validationStatus: ValidationResult['status'] | null
): StatusKind {
  if (!generated) return 'not-generated'
  if (validationStatus === 'errors') return 'errors'
  if (validationStatus === 'warnings') return 'warnings'
  return 'ready'
}

function StatusOverview({
  generated,
  validationStatus,
  mappingCount,
  totalFields,
}: {
  generated: boolean
  validationStatus: ValidationResult['status'] | null
  mappingCount: number
  totalFields: number
}) {
  const status = deriveStatus(generated, validationStatus)
  const meta = STATUS_META[status]
  const pct = totalFields > 0 ? Math.min(100, (mappingCount / totalFields) * 100) : 0

  return (
    <div className="ff-panel" style={{ padding: '16px' }}>
      <div className="flex items-center gap-3">
        <div
          className="shrink-0 inline-flex items-center justify-center"
          style={{
            width: '40px',
            height: '40px',
            borderRadius: '50%',
            background: meta.iconBg,
            color: meta.iconColor,
          }}
        >
          {meta.icon}
        </div>
        <div className="min-w-0">
          <p
            style={{
              fontSize: '15px',
              fontWeight: 600,
              color: meta.titleColor,
            }}
          >
            {meta.label}
          </p>
          <p style={{ fontSize: '11px', color: 'var(--color-text-tertiary)' }}>
            {meta.subtitle}
          </p>
        </div>
      </div>

      <div className="mt-4">
        <div className="flex items-center justify-between mb-1.5">
          <span className="ff-label">Mapping progress</span>
          <span style={{ fontSize: '11px', color: 'var(--color-text-secondary)' }}>
            {mappingCount} of {totalFields} fields mapped
          </span>
        </div>
        <div
          style={{
            height: '6px',
            background: 'var(--color-background-secondary)',
            borderRadius: '999px',
            overflow: 'hidden',
          }}
        >
          <div
            style={{
              width: `${pct}%`,
              height: '100%',
              background: 'var(--color-accent)',
              transition: 'width 0.2s ease',
            }}
          />
        </div>
      </div>
    </div>
  )
}

const STATUS_META: Record<
  StatusKind,
  {
    label: string
    subtitle: string
    iconBg: string
    iconColor: string
    titleColor: string
    icon: React.ReactNode
  }
> = {
  ready: {
    label: 'Feed ready',
    subtitle: 'Ready for Google Merchant Center',
    iconBg: 'var(--color-badge-success-bg)',
    iconColor: 'var(--color-badge-success-text)',
    titleColor: 'var(--color-badge-success-text)',
    icon: (
      <svg width="20" height="20" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
        <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
      </svg>
    ),
  },
  warnings: {
    label: 'Warnings',
    subtitle: 'Feed works but can be improved',
    iconBg: 'var(--color-badge-warning-bg)',
    iconColor: 'var(--color-badge-warning-text)',
    titleColor: 'var(--color-badge-warning-text)',
    icon: (
      <svg width="20" height="20" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
        <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v3m0 3.5h.01M10.29 3.86L1.82 18a2 2 0 001.71 3h16.94a2 2 0 001.71-3L13.71 3.86a2 2 0 00-3.42 0z" />
      </svg>
    ),
  },
  errors: {
    label: 'Errors',
    subtitle: 'Feed will be rejected by Google — fix before uploading',
    iconBg: 'var(--color-badge-danger-bg)',
    iconColor: 'var(--color-badge-danger-text)',
    titleColor: 'var(--color-badge-danger-text)',
    icon: (
      <svg width="20" height="20" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
        <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
      </svg>
    ),
  },
  'not-generated': {
    label: 'Not generated yet',
    subtitle: 'Generate the feed to see its status',
    iconBg: 'var(--color-background-secondary)',
    iconColor: 'var(--color-text-tertiary)',
    titleColor: 'var(--color-text-primary)',
    icon: (
      <svg width="20" height="20" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
        <circle cx="12" cy="12" r="9" />
        <path strokeLinecap="round" d="M12 8v4M12 16h.01" />
      </svg>
    ),
  },
}

// ── Statistics ─────────────────────────────────────────────────────────────

function StatisticsSection({
  feedItemCount,
  includedCount,
  excludedCount,
  lastSynced,
  lastGenerated,
}: {
  feedItemCount: number | null
  includedCount: number | null
  excludedCount: number | null
  lastSynced: string | null
  lastGenerated: string | null
}) {
  return (
    <div className="ff-panel">
      <div className="ff-panel-header">Statistics</div>
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3 p-3.5">
        <StatCard label="Items in feed" value={feedItemCount != null ? String(feedItemCount) : '—'} />
        <StatCard label="Included products" value={includedCount != null ? String(includedCount) : '—'} />
        <StatCard label="Excluded products" value={excludedCount != null ? String(excludedCount) : '—'} />
        <StatCard label="Last synced" value={formatDateTime(lastSynced)} />
        <StatCard label="Last generated" value={formatDateTime(lastGenerated)} />
      </div>
    </div>
  )
}

function StatCard({ label, value }: { label: string; value: string }) {
  return (
    <div
      style={{
        padding: '10px 12px',
        background: 'var(--color-background-tertiary)',
        border: '1px solid var(--color-border-tertiary)',
        borderRadius: '4px',
      }}
    >
      <p className="ff-label">{label}</p>
      <p
        className="mt-1"
        style={{ fontSize: '13px', fontWeight: 500, color: 'var(--color-text-primary)' }}
      >
        {value}
      </p>
    </div>
  )
}

function formatDateTime(iso: string | null): string {
  if (!iso) return '—'
  try {
    return new Date(iso).toLocaleString('en-US', {
      day: '2-digit',
      month: '2-digit',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    })
  } catch {
    return iso
  }
}

// ── Next steps ─────────────────────────────────────────────────────────────

function NextSteps({
  feedId,
  onGenerate,
  isGenerating,
}: {
  feedId: string
  onGenerate: () => void
  isGenerating: boolean
}) {
  return (
    <div className="ff-panel">
      <div className="ff-panel-header">Next steps</div>
      <div className="p-3.5 space-y-2">
        <NextStepRow n={1}>
          <Link href={`/feed/${feedId}/mapping`} className="ff-btn-secondary">
            Set up mapping
          </Link>
        </NextStepRow>
        <NextStepRow n={2}>
          <Link href={`/feed/${feedId}/filters`} className="ff-btn-secondary">
            Configure filters
          </Link>
        </NextStepRow>
        <NextStepRow n={3}>
          <button
            type="button"
            onClick={onGenerate}
            disabled={isGenerating}
            className="ff-btn-primary"
          >
            {isGenerating ? 'Generating…' : 'Generate feed'}
          </button>
        </NextStepRow>
      </div>
    </div>
  )
}

function NextStepRow({ n, children }: { n: number; children: React.ReactNode }) {
  const labels = ['Set up mapping', 'Configure filters', 'Generate feed']
  return (
    <div className="flex items-center gap-3">
      <div
        className="shrink-0 inline-flex items-center justify-center"
        style={{
          width: '24px',
          height: '24px',
          borderRadius: '50%',
          background: 'var(--color-badge-accent-bg)',
          color: 'var(--color-accent)',
          fontSize: '11px',
          fontWeight: 600,
        }}
      >
        {n}
      </div>
      <span
        className="flex-1"
        style={{ fontSize: '12px', color: 'var(--color-text-primary)' }}
      >
        Step {n}: {labels[n - 1]}
      </span>
      {children}
    </div>
  )
}

// ── Validation mini ────────────────────────────────────────────────────────

function ValidationMini({
  result,
  isRunning,
  onRun,
  runError,
  onShowDetails,
}: {
  result: ValidationResult | null
  isRunning: boolean
  onRun: () => void
  runError: string | null
  onShowDetails: () => void
}) {
  const errors = result?.issues.filter((i) => i.type === 'error') ?? []
  const warnings = result?.issues.filter((i) => i.type === 'warning') ?? []
  const issuesPreview = [...errors, ...warnings].slice(0, 3)
  const remaining = (errors.length + warnings.length) - issuesPreview.length

  let badgeClass = 'ff-badge ff-badge-neutral'
  let badgeLabel = 'Not run'
  if (result) {
    if (result.status === 'errors') {
      badgeClass = 'ff-badge ff-badge-danger'
      badgeLabel = `${errors.length} ${errors.length === 1 ? 'error' : 'errors'}${warnings.length > 0 ? ` · ${warnings.length} ${warnings.length === 1 ? 'warning' : 'warnings'}` : ''}`
    } else if (result.status === 'warnings') {
      badgeClass = 'ff-badge ff-badge-warning'
      badgeLabel = `${warnings.length} ${warnings.length === 1 ? 'warning' : 'warnings'}`
    } else {
      badgeClass = 'ff-badge ff-badge-success'
      badgeLabel = 'No issues'
    }
  }

  return (
    <div className="ff-panel">
      <div className="ff-panel-header">
        <span>Validation</span>
        <span className={badgeClass}>{badgeLabel}</span>
      </div>
      <div className="p-3.5 space-y-2.5">
        {runError && (
          <p style={{ fontSize: '11px', color: 'var(--color-badge-danger-text)' }}>{runError}</p>
        )}

        {!result && (
          <p style={{ fontSize: '11px', color: 'var(--color-text-tertiary)' }}>
            No validation run yet — click &quot;Run validation&quot; to check the feed.
          </p>
        )}

        {result && issuesPreview.length === 0 && result.status === 'ok' && (
          <p style={{ fontSize: '11px', color: 'var(--color-text-tertiary)' }}>
            Feed meets Google&apos;s requirements.
          </p>
        )}

        {issuesPreview.length > 0 && (
          <ul className="space-y-1">
            {issuesPreview.map((issue, i) => (
              <li key={i} className="flex items-start gap-2" style={{ fontSize: '11px' }}>
                <span
                  className={`ff-badge ${issue.type === 'error' ? 'ff-badge-danger' : 'ff-badge-warning'} shrink-0`}
                >
                  {issue.type === 'error' ? 'Error' : 'Warning'}
                </span>
                <code
                  className="ff-mono shrink-0"
                  style={{ color: 'var(--color-text-secondary)' }}
                >
                  {issue.field}
                </code>
                <span
                  className="flex-1 min-w-0 truncate"
                  style={{ color: 'var(--color-text-primary)' }}
                >
                  {issue.message}
                </span>
              </li>
            ))}
            {remaining > 0 && (
              <li
                style={{ fontSize: '11px', color: 'var(--color-text-tertiary)', paddingLeft: '4px' }}
              >
                +{remaining} more…
              </li>
            )}
          </ul>
        )}

        <div className="flex gap-2 pt-1">
          <button
            type="button"
            onClick={onRun}
            disabled={isRunning}
            className="ff-btn-primary"
          >
            {isRunning ? 'Validating…' : 'Run validation'}
          </button>
          {result && (
            <button
              type="button"
              onClick={onShowDetails}
              className="ff-btn-secondary"
            >
              See all details
            </button>
          )}
        </div>
      </div>
    </div>
  )
}

// ── Sync banner (existing — unchanged) ─────────────────────────────────────

// Polls /api/products until the new feed has products (sync wrote them),
// then auto-regenerates the feed so feed_cache.xml_content reflects the new
// rows. Triggered by the wizard navigating with ?syncing=1. Existing feeds
// (no query param) never see this.
//
// Phase machine:
//   syncing    → polling /api/products until total > 0 (or timeout)
//   sync-done  → brief acknowledgement: "Synkronisering færdig"
//   generating → POST /api/feed/generate/[feedId] in flight
//   ready      → generation finished; ?syncing=1 is stripped after a moment
//   timeout    → no products detected within 90 s
//   error      → generation request failed
type Phase = 'syncing' | 'sync-done' | 'generating' | 'ready' | 'timeout' | 'error'

const SYNC_POLL_MAX_MS = 90_000
const SYNC_POLL_INTERVAL_MS = 3_000
const SYNC_DONE_DISPLAY_MS = 1_200
const READY_DISPLAY_MS = 3_000

function SyncStatusBanner({ feedId }: { feedId: string }) {
  const router = useRouter()
  const [phase, setPhase] = useState<Phase>('syncing')
  const [syncedCount, setSyncedCount] = useState<number | null>(null)
  const [feedItemCount, setFeedItemCount] = useState<number | null>(null)

  useEffect(() => {
    if (phase !== 'syncing') return
    const startedAt = Date.now()
    let cancelled = false

    async function tick() {
      try {
        const res = await fetch(
          `/api/products?feedId=${encodeURIComponent(feedId)}&pageSize=1&page=1`,
          { cache: 'no-store' }
        )
        if (res.ok) {
          const data = (await res.json()) as { total?: number }
          if (!cancelled && (data.total ?? 0) > 0) {
            setSyncedCount(data.total ?? 0)
            setPhase('sync-done')
            return
          }
        }
      } catch {
        // Next tick retries.
      }
      if (!cancelled && Date.now() - startedAt > SYNC_POLL_MAX_MS) {
        setPhase('timeout')
      }
    }

    void tick()
    const id = setInterval(tick, SYNC_POLL_INTERVAL_MS)
    return () => {
      cancelled = true
      clearInterval(id)
    }
  }, [feedId, phase])

  useEffect(() => {
    if (phase !== 'sync-done') return
    const t = setTimeout(() => setPhase('generating'), SYNC_DONE_DISPLAY_MS)
    return () => clearTimeout(t)
  }, [phase])

  useEffect(() => {
    if (phase !== 'generating') return
    let cancelled = false

    fetch(`/api/feed/generate/${encodeURIComponent(feedId)}`, { method: 'POST' })
      .then(async (res) => {
        if (cancelled) return
        if (!res.ok) {
          setPhase('error')
          return
        }
        const data = (await res.json()) as { product_count?: number }
        setFeedItemCount(data.product_count ?? syncedCount ?? null)
        setPhase('ready')
      })
      .catch(() => {
        if (!cancelled) setPhase('error')
      })

    return () => {
      cancelled = true
    }
  }, [phase, feedId, syncedCount])

  useEffect(() => {
    if (phase === 'syncing' || phase === 'sync-done' || phase === 'generating') return
    if (phase === 'ready') {
      const t = setTimeout(() => router.replace(`/feed/${feedId}`), READY_DISPLAY_MS)
      return () => clearTimeout(t)
    }
    router.replace(`/feed/${feedId}`)
  }, [phase, feedId, router])

  if (phase === 'syncing') {
    return (
      <PendingBanner
        title="Syncing products from Shopify…"
        subtitle="You can navigate away — the sync continues in the background."
      />
    )
  }

  if (phase === 'sync-done') {
    return (
      <SuccessBanner
        text={`Sync complete — ${syncedCount} ${syncedCount === 1 ? 'product' : 'products'} fetched`}
      />
    )
  }

  if (phase === 'generating') {
    return (
      <PendingBanner
        title="Generating feed…"
        subtitle="Building XML from the synced products."
      />
    )
  }

  if (phase === 'ready') {
    const count = feedItemCount ?? syncedCount ?? 0
    return (
      <SuccessBanner text={`Feed ready — ${count} ${count === 1 ? 'product' : 'products'}`} />
    )
  }

  return null
}

function PendingBanner({ title, subtitle }: { title: string; subtitle?: string }) {
  return (
    <div
      className="ff-panel p-3 flex items-center gap-2.5"
      style={{
        background: 'var(--color-badge-accent-bg)',
        borderColor: 'var(--color-accent)',
      }}
    >
      <svg
        className="w-4 h-4 animate-spin shrink-0"
        fill="none"
        viewBox="0 0 24 24"
        style={{ color: 'var(--color-accent)' }}
      >
        <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
        <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8H4z" />
      </svg>
      <div className="flex-1 min-w-0">
        <p style={{ fontSize: '12px', fontWeight: 500, color: 'var(--color-text-primary)' }}>
          {title}
        </p>
        {subtitle && (
          <p
            className="mt-0.5"
            style={{ fontSize: '11px', color: 'var(--color-text-tertiary)' }}
          >
            {subtitle}
          </p>
        )}
      </div>
    </div>
  )
}

function SuccessBanner({ text }: { text: string }) {
  return (
    <div
      className="ff-panel p-3"
      style={{
        background: 'var(--color-badge-success-bg)',
        borderColor: 'var(--color-badge-success-text)',
      }}
    >
      <p style={{ fontSize: '12px', fontWeight: 500, color: 'var(--color-badge-success-text)' }}>
        {text}
      </p>
    </div>
  )
}
