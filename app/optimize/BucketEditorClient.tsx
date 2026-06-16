'use client'

// Bucket editor as a guided step-flow: Scope → Examples → Run. Steps are freely
// navigable (click the indicator, or Back/Next) — not a locked wizard — but the
// order communicates the intended path. Review is kept as a trailing step for
// now; the next phase merges Run + Review into a single "Run → Results" view,
// at which point the flow becomes the canonical three steps.

import { Fragment, useEffect, useState } from 'react'
import Link from 'next/link'
import { getBucketMembership } from './actions'
import { BucketScopeTab } from './BucketScopeTab'
import { BucketRunTab } from './BucketRunTab'
import { BucketWorkshopTab } from './BucketWorkshopTab'
import { BucketResultsPanel } from './BucketResultsPanel'
import { BucketCustomLabelPanel } from './BucketCustomLabelPanel'
import type { FilterConfig } from '@/app/filters/actions'

type Step = 'scope' | 'examples' | 'run'

// The three canonical steps. The Run step also hosts the Results view (run +
// review merged), so there is no separate Review step.
const FLOW: { id: Step; label: string }[] = [
  { id: 'scope', label: 'Scope' },
  { id: 'examples', label: 'Examples' },
  { id: 'run', label: 'Run' },
]
const ORDER: Step[] = ['scope', 'examples', 'run']

export function BucketEditorClient({
  feedId,
  feedName,
  bucketId,
  bucketName,
  initialInclude,
  initialExclude,
}: {
  feedId: string
  feedName: string
  bucketId: string
  bucketName: string
  initialInclude: FilterConfig
  initialExclude: FilterConfig
}) {
  const [step, setStep] = useState<Step>('scope')
  // Membership count drives the soft "set scope first" gate. null = still loading.
  const [memberCount, setMemberCount] = useState<number | null>(null)
  // Bumped after a run so the Results panel reloads with the new titles.
  const [resultsKey, setResultsKey] = useState(0)

  useEffect(() => {
    let cancelled = false
    getBucketMembership(feedId, bucketId).then((r) => {
      if (!cancelled && 'data' in r) setMemberCount(r.data.length)
    })
    return () => {
      cancelled = true
    }
  }, [feedId, bucketId])

  const noMembers = memberCount === 0
  const activeIndex = FLOW.findIndex((s) => s.id === step) // -1 while on Review
  const orderIndex = ORDER.indexOf(step)
  const prev = orderIndex > 0 ? ORDER[orderIndex - 1] : null
  const next = orderIndex < ORDER.length - 1 ? ORDER[orderIndex + 1] : null

  const stepChip = (id: Step, label: string, n: number | null, done: boolean) => {
    const isActive = step === id
    return (
      <button
        type="button"
        onClick={() => setStep(id)}
        className="flex items-center gap-1.5"
        style={{
          padding: '4px 12px',
          fontSize: '11px',
          fontWeight: 500,
          borderRadius: '5px',
          background: isActive ? 'var(--color-accent)' : 'transparent',
          color: isActive ? '#ffffff' : 'var(--color-text-tertiary)',
        }}
      >
        {n !== null && (
          <span
            className="flex items-center justify-center"
            style={{
              width: '16px',
              height: '16px',
              borderRadius: '50%',
              fontSize: '9px',
              fontWeight: 700,
              background: isActive ? 'rgba(255,255,255,0.25)' : done ? 'var(--color-accent)' : 'var(--color-border-tertiary)',
              color: isActive || done ? '#ffffff' : 'var(--color-text-tertiary)',
            }}
          >
            {done && !isActive ? '✓' : n}
          </span>
        )}
        {label}
      </button>
    )
  }

  return (
    <div className="min-h-screen">
      <header className="ff-topbar">
        <div className="flex items-center gap-3">
          <Link href={`/feed/${feedId}/optimize`} style={{ fontSize: '12px', color: 'var(--color-accent)' }}>
            ← Buckets
          </Link>
          <h1 className="ff-topbar-title">
            {feedName} · {bucketName}
          </h1>
          <div className="flex items-center gap-1">
            {FLOW.map((s, i) => (
              <Fragment key={s.id}>
                {i > 0 && <span style={{ fontSize: '11px', color: 'var(--color-text-tertiary)' }}>›</span>}
                {stepChip(s.id, s.label, i + 1, activeIndex > i)}
              </Fragment>
            ))}
          </div>
        </div>
        {memberCount !== null && (
          <div style={{ fontSize: '11px', color: 'var(--color-text-tertiary)' }}>
            {memberCount} {memberCount === 1 ? 'product' : 'products'}
          </div>
        )}
      </header>

      <main className="px-4 py-4 max-w-6xl">
        {/* Soft gate: a gentle nudge, never a hard block. Run shows its own too. */}
        {noMembers && step === 'examples' && (
          <p className="mb-3" style={{ fontSize: '11px', color: 'var(--color-text-tertiary)' }}>
            This bucket has no products yet — set its scope first (step 1) so the workshop has products to draw from.
          </p>
        )}

        {step === 'scope' && (
          <BucketScopeTab feedId={feedId} bucketId={bucketId} initialInclude={initialInclude} initialExclude={initialExclude} />
        )}
        {step === 'examples' && <BucketWorkshopTab feedId={feedId} bucketId={bucketId} />}
        {step === 'run' && (
          <div className="space-y-3">
            <BucketRunTab feedId={feedId} bucketId={bucketId} onRunComplete={() => setResultsKey((k) => k + 1)} />
            <BucketCustomLabelPanel feedId={feedId} bucketId={bucketId} />
            <BucketResultsPanel feedId={feedId} bucketId={bucketId} reloadKey={resultsKey} />
          </div>
        )}

        {/* Guided back/next — free movement, order is just a suggestion. */}
        <div className="flex items-center justify-between pt-4">
          <button
            type="button"
            onClick={() => prev && setStep(prev)}
            disabled={!prev}
            className="ff-btn-secondary"
            style={{ opacity: prev ? 1 : 0.4 }}
          >
            ← Back
          </button>
          {next && (
            <button type="button" onClick={() => setStep(next)} className="ff-btn-secondary">
              Next: {FLOW.find((s) => s.id === next)?.label} →
            </button>
          )}
        </div>
      </main>
    </div>
  )
}
