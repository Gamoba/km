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
import { BucketRunTab, type RunControl } from './BucketRunTab'
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
  // Run trigger + state, reported up by BucketRunTab so the bottom bar can host the
  // "Run optimization" button on the Run step.
  const [runControl, setRunControl] = useState<RunControl | null>(null)

  // Header member count — re-read on every step change too, so it doesn't show a
  // stale page-load snapshot after Scope commits membership (the editor never
  // remounts).
  useEffect(() => {
    let cancelled = false
    getBucketMembership(feedId, bucketId).then((r) => {
      if (!cancelled && 'data' in r) setMemberCount(r.data.length)
    })
    return () => {
      cancelled = true
    }
  }, [feedId, bucketId, step])

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
          background: isActive ? 'var(--accent-purple)' : 'transparent',
          color: isActive ? '#ffffff' : 'var(--ink-muted)',
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
              background: isActive ? 'rgba(255,255,255,0.25)' : done ? 'var(--accent-purple)' : 'var(--hairline)',
              color: isActive || done ? '#ffffff' : 'var(--ink-muted)',
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
    <div className="flex flex-col min-h-screen">
      <header className="ff-topbar">
        <div className="flex items-center gap-3">
          <Link href={`/feed/${feedId}/optimize`} style={{ fontSize: '12px', color: 'var(--accent-purple)' }}>
            ← Buckets
          </Link>
          <h1 className="ff-topbar-title">
            {feedName} · {bucketName}
          </h1>
          <div className="flex items-center gap-1">
            {FLOW.map((s, i) => (
              <Fragment key={s.id}>
                {i > 0 && <span style={{ fontSize: '11px', color: 'var(--ink-muted)' }}>›</span>}
                {stepChip(s.id, s.label, i + 1, activeIndex > i)}
              </Fragment>
            ))}
          </div>
        </div>
        {memberCount !== null && (
          <div style={{ fontSize: '11px', color: 'var(--ink-muted)' }}>
            {memberCount} {memberCount === 1 ? 'product' : 'products'}
          </div>
        )}
      </header>

      {/* Width was capped by max-w-6xl (1152px) here — the AppShell content area is
          flex-1 (no cap), so this <main> was the sole constraint. Inline maxWidth so
          it can't be silently dropped by class generation. */}
      {/* flex-1 so main fills the column and pushes the bar to the viewport bottom
          even when content is short. Extra bottom padding so the last rows clear the
          sticky bar that floats over the bottom while scrolling. */}
      <main className="px-4 pt-4 flex-1" style={{ maxWidth: '1800px', paddingBottom: '32px' }}>
        {/* Soft gate: a gentle nudge, never a hard block. Run shows its own too. */}
        {noMembers && step === 'examples' && (
          <p className="mb-3" style={{ fontSize: '11px', color: 'var(--ink-muted)' }}>
            This bucket has no products yet — set its scope first (step 1) so the workshop has products to draw from.
          </p>
        )}

        {/* All steps stay MOUNTED — only their visibility toggles. Switching steps
            used to unmount the active one (conditional render), which destroyed its
            in-memory state (Scope's inspected product, Examples' unsaved
            instructions/fields, etc.). Keeping them mounted preserves that state, so
            returning to a step shows exactly what you left. */}
        <div className="space-y-3" style={{ display: step === 'scope' ? undefined : 'none' }}>
          <BucketScopeTab feedId={feedId} bucketId={bucketId} initialInclude={initialInclude} initialExclude={initialExclude} />
          <BucketCustomLabelPanel feedId={feedId} bucketId={bucketId} />
        </div>
        <div style={{ display: step === 'examples' ? undefined : 'none' }}>
          <BucketWorkshopTab feedId={feedId} bucketId={bucketId} />
        </div>
        <div className="space-y-3" style={{ display: step === 'run' ? undefined : 'none' }}>
          <BucketRunTab feedId={feedId} bucketId={bucketId} onRunComplete={() => setResultsKey((k) => k + 1)} onRunControlChange={setRunControl} isActive={step === 'run'} />
          <BucketResultsPanel feedId={feedId} bucketId={bucketId} reloadKey={resultsKey} isActive={step === 'run'} />
        </div>

      </main>

      {/* Frozen step nav — sticky to the bottom of the scroll area so Back/Next are
          always reachable without scrolling. It lives INSIDE the content column, so
          it spans the content area and never overlaps the (dark) sidebar; the inner
          wrapper matches the 1800px content width so the buttons align with it. A
          slightly darker surface + top hairline + soft upward shadow make it read as
          a distinct frozen element. Inline-styled (no new CSS class) per the
          served-CSS lesson. */}
      <div
        style={{
          position: 'sticky',
          bottom: 0,
          zIndex: 30,
          background: '#182051',
          borderTop: '1px solid rgba(255, 255, 255, 0.10)',
          boxShadow: '0 -2px 12px rgba(0, 0, 0, 0.18)',
        }}
      >
        <div className="px-4" style={{ maxWidth: '1800px' }}>
          <div className="flex items-center justify-between" style={{ paddingTop: '24px', paddingBottom: '24px' }}>
            {/* Back: keep ff-btn-secondary geometry, override colours inline for the
                dark bar — a subtle light outline button (transparent fill). */}
            <button
              type="button"
              onClick={() => prev && setStep(prev)}
              disabled={!prev}
              className="ff-btn-secondary"
              style={{
                background: 'transparent',
                borderColor: 'rgba(255, 255, 255, 0.30)',
                color: 'var(--bg-base)',
                opacity: prev ? 1 : 0.4,
                fontSize: '14px',
                padding: '9px 18px',
              }}
            >
              ← Back
            </button>
            {step === 'run' ? (
              // Final action on the Run step: the "Run optimization" button itself,
              // same size as before (wl-btn-primary + these overrides), driven by the
              // run control BucketRunTab reports up.
              <button
                type="button"
                onClick={() => runControl?.run()}
                disabled={!runControl || runControl.disabled}
                className="wl-btn-primary"
                style={{ fontSize: '14px', padding: '9px 18px' }}
              >
                {runControl?.running ? 'Running…' : 'Run optimization'}
              </button>
            ) : next ? (
              // Next: brand-purple primary — already readable on dark.
              <button type="button" onClick={() => setStep(next)} className="ff-btn-primary" style={{ fontSize: '14px', padding: '9px 18px' }}>
                Next: {FLOW.find((s) => s.id === next)?.label} →
              </button>
            ) : null}
          </div>
        </div>
      </div>
    </div>
  )
}
