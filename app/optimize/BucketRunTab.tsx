'use client'

import { useEffect, useState } from 'react'
import { planBucketRun, runBucketRefs } from './actions'
import type { OverlapSummary } from '@/lib/titleOptimizationScope'

const CHUNK = 10

export function BucketRunTab({
  feedId,
  bucketId,
  onRunComplete,
}: {
  feedId: string
  bucketId: string
  onRunComplete?: () => void
}) {
  const [error, setError] = useState<string | null>(null)

  const [summary, setSummary] = useState<OverlapSummary | null>(null)
  const [loadingSummary, setLoadingSummary] = useState(true)

  const [rerun, setRerun] = useState(false)
  const [includeHumanEdited, setIncludeHumanEdited] = useState(false)
  const [running, setRunning] = useState(false)
  const [progress, setProgress] = useState({ done: 0, total: 0 })

  // Membership summary on mount — setState only in the async callback.
  useEffect(() => {
    let cancelled = false
    planBucketRun(feedId, bucketId, { rerun: false, includeHumanEdited: false }).then((r) => {
      if (cancelled) return
      if ('data' in r) setSummary(r.data.summary)
      else setError(r.error)
      setLoadingSummary(false)
    })
    return () => {
      cancelled = true
    }
  }, [feedId, bucketId])

  async function refreshSummary() {
    const r = await planBucketRun(feedId, bucketId, { rerun: false, includeHumanEdited: false })
    if ('data' in r) setSummary(r.data.summary)
  }

  async function handleRun() {
    setError(null)
    setRunning(true)
    setProgress({ done: 0, total: 0 })

    const plan = await planBucketRun(feedId, bucketId, { rerun, includeHumanEdited })
    if ('error' in plan) {
      setError(plan.error)
      setRunning(false)
      return
    }
    const targets = plan.data.targets
    setProgress({ done: 0, total: targets.length })
    if (targets.length === 0) {
      setRunning(false)
      return
    }

    for (let i = 0; i < targets.length; i += CHUNK) {
      const res = await runBucketRefs(feedId, bucketId, targets.slice(i, i + CHUNK))
      if ('error' in res) {
        setError(res.error)
        break
      }
      setProgress({ done: Math.min(i + CHUNK, targets.length), total: targets.length })
    }

    setRunning(false)
    refreshSummary()
    onRunComplete?.() // let the Results panel reload with the freshly persisted titles
  }

  const noMembers = !loadingSummary && summary !== null && summary.inScope === 0

  return (
    <div className="space-y-5">
      {error && (
        <div
          className="flex items-start gap-2.5"
          style={{ padding: '10px 12px', border: '1px solid var(--hairline)', borderRadius: '10px' }}
        >
          <span className="wl-dot shrink-0" style={{ background: 'var(--accent-red)', marginTop: '5px' }} />
          <p style={{ fontSize: '12px', color: 'var(--ink-secondary)' }}>{error}</p>
        </div>
      )}

      {noMembers && (
        <p style={{ fontSize: '13px', color: 'var(--ink-muted)' }}>
          This bucket has no products yet. Set its scope first on the Scope tab.
        </p>
      )}

      {/* Hero — the run is the single clear action */}
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div className="space-y-1.5">
          <h2 style={{ fontSize: '26px', fontWeight: 500, letterSpacing: '-0.02em', lineHeight: 1.1, color: 'var(--ink)' }}>
            Run optimization
          </h2>
          <p style={{ fontSize: '13px', color: 'var(--ink-muted)' }}>
            Generate and save AI titles for this bucket&apos;s products.
          </p>
        </div>
        <button
          onClick={handleRun}
          disabled={running || loadingSummary || noMembers}
          className="wl-btn-primary"
          style={{ fontSize: '14px', padding: '9px 18px' }}
        >
          {running ? 'Running…' : 'Run optimization'}
        </button>
      </div>

      {/* Numbers as context */}
      {loadingSummary ? (
        <p style={{ fontSize: '13px', color: 'var(--ink-muted)' }}>Loading…</p>
      ) : summary ? (
        <div className="wl-card" style={{ overflow: 'hidden' }}>
          <div className="grid grid-cols-3">
            <Stat first label="In bucket" value={summary.inScope} />
            <Stat label="Optimized" value={summary.alreadyOptimized} />
            <Stat label="Not yet" value={summary.notYetOptimized} />
          </div>
          {(summary.humanEdited > 0 || summary.needsReview > 0) && (
            <div
              className="flex flex-wrap gap-x-6 gap-y-1"
              style={{ padding: '12px 18px', borderTop: '1px solid var(--hairline)', fontSize: '12px', color: 'var(--ink-muted)' }}
            >
              {summary.humanEdited > 0 && <span>{summary.humanEdited} hand-edited</span>}
              {summary.needsReview > 0 && <span>{summary.needsReview} awaiting review</span>}
            </div>
          )}
        </div>
      ) : null}

      {/* Progress while running */}
      {running && (
        <div className="space-y-1.5">
          <div style={{ fontSize: '12px', color: 'var(--ink-secondary)' }}>
            {progress.done} of {progress.total} optimized…
          </div>
          <div style={{ height: '6px', background: 'var(--bg-surface)', border: '1px solid var(--hairline)', borderRadius: '999px', overflow: 'hidden' }}>
            <div style={{ height: '100%', width: progress.total ? `${(progress.done / progress.total) * 100}%` : '0%', background: 'var(--accent-purple)', transition: 'width 0.2s' }} />
          </div>
        </div>
      )}

      {/* Options */}
      <div className="wl-card" style={{ padding: '16px' }}>
        <div className="wl-eyebrow" style={{ marginBottom: '12px' }}>Options</div>
        <div className="space-y-3">
          <label className="flex items-center gap-2.5" style={{ fontSize: '13px', color: 'var(--ink-secondary)' }}>
            <input type="checkbox" checked={rerun} onChange={(e) => setRerun(e.target.checked)} />
            Re-optimize products that already have an AI title
          </label>
          <label
            className="flex items-center gap-2.5"
            style={{ fontSize: '13px', color: rerun ? 'var(--ink-secondary)' : 'var(--ink-muted)', paddingLeft: '22px' }}
          >
            <input type="checkbox" checked={includeHumanEdited} disabled={!rerun} onChange={(e) => setIncludeHumanEdited(e.target.checked)} />
            Also overwrite hand-edited titles{summary && summary.humanEdited > 0 ? ` (${summary.humanEdited})` : ''} — destructive
          </label>
        </div>
      </div>
    </div>
  )
}

function Stat({ label, value, first }: { label: string; value: number; first?: boolean }) {
  return (
    <div style={{ padding: '16px 18px', borderLeft: first ? 'none' : '1px solid var(--hairline)' }}>
      <p className="wl-eyebrow">{label}</p>
      <p
        className="mt-2"
        style={{ fontSize: '26px', fontWeight: 500, letterSpacing: '-0.02em', lineHeight: 1.05, color: 'var(--ink)' }}
      >
        {value}
      </p>
    </div>
  )
}
