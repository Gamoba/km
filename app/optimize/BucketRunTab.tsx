'use client'

import { useEffect, useState } from 'react'
import { planBucketRun, previewBucket, runBucketRefs } from './actions'
import { OutcomeList } from './OutcomeList'
import type { OptimizationOutcome } from '@/lib/titleOptimizer'
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

  const [previewSize, setPreviewSize] = useState('10')
  const [previewing, setPreviewing] = useState(false)
  const [previewResults, setPreviewResults] = useState<OptimizationOutcome[]>([])

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

  async function handlePreview() {
    setError(null)
    setPreviewing(true)
    setPreviewResults([])
    const n = parseInt(previewSize, 10) || 10
    const r = await previewBucket(feedId, bucketId, n)
    if ('data' in r) setPreviewResults(r.data)
    else setError(r.error)
    setPreviewing(false)
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
    <div className="space-y-3">
      {error && <div style={{ fontSize: '11px', color: 'var(--color-badge-danger-text)' }}>{error}</div>}

      {noMembers && (
        <p style={{ fontSize: '11px', color: 'var(--color-text-tertiary)' }}>
          This bucket has no products yet. Set its scope first (Scope tab).
        </p>
      )}

      {/* Preview */}
      <div className="ff-panel">
        <div className="ff-panel-header" style={{ textTransform: 'none', letterSpacing: 0, fontSize: '12px', padding: '10px 14px' }}>
          Preview — experiment without saving
        </div>
        <div className="p-3.5 space-y-2">
          <p style={{ fontSize: '11px', color: 'var(--color-text-tertiary)' }}>
            Generate titles for a sample of this bucket&apos;s products. Nothing is saved.
          </p>
          <div className="flex items-center gap-2">
            <label className="ff-label" style={{ margin: 0 }}>Sample size</label>
            <input type="number" min={1} max={50} value={previewSize} onChange={(e) => setPreviewSize(e.target.value)} className="ff-input w-20" />
            <button onClick={handlePreview} disabled={previewing || noMembers} className="ff-btn-secondary">
              {previewing ? 'Generating…' : 'Preview'}
            </button>
          </div>
        </div>
      </div>

      <OutcomeList title="Preview results" outcomes={previewResults} />

      {/* Run */}
      <div className="ff-panel">
        <div className="ff-panel-header" style={{ textTransform: 'none', letterSpacing: 0, fontSize: '12px', padding: '10px 14px' }}>
          Run &amp; save
        </div>
        <div className="p-3.5 space-y-3">
          {loadingSummary ? (
            <p style={{ fontSize: '11px', color: 'var(--color-text-tertiary)' }}>Loading…</p>
          ) : summary ? (
            <p style={{ fontSize: '11px', color: 'var(--color-text-secondary)' }}>
              <strong>{summary.inScope}</strong> products in this bucket.{' '}
              <strong>{summary.alreadyOptimized}</strong> already AI-optimized
              {summary.humanEdited > 0 ? <> (<strong>{summary.humanEdited}</strong> hand-edited)</> : null}
              {summary.needsReview > 0 ? <>, {summary.needsReview} awaiting review</> : null}.{' '}
              <strong>{summary.notYetOptimized}</strong> not yet optimized.
            </p>
          ) : null}

          <div className="space-y-1.5">
            <label className="flex items-center gap-2" style={{ fontSize: '11px', color: 'var(--color-text-secondary)' }}>
              <input type="checkbox" checked={rerun} onChange={(e) => setRerun(e.target.checked)} />
              Re-optimize products that already have an AI title
            </label>
            <label
              className="flex items-center gap-2"
              style={{ fontSize: '11px', color: rerun ? 'var(--color-text-secondary)' : 'var(--color-text-tertiary)', paddingLeft: '20px' }}
            >
              <input type="checkbox" checked={includeHumanEdited} disabled={!rerun} onChange={(e) => setIncludeHumanEdited(e.target.checked)} />
              Also overwrite hand-edited titles{summary && summary.humanEdited > 0 ? ` (${summary.humanEdited})` : ''} — destructive
            </label>
          </div>

          {running && (
            <div className="space-y-1">
              <div style={{ fontSize: '11px', color: 'var(--color-text-secondary)' }}>
                {progress.done} of {progress.total} optimized…
              </div>
              <div style={{ height: '4px', background: 'var(--color-border-tertiary)', borderRadius: '2px', overflow: 'hidden' }}>
                <div style={{ height: '100%', width: progress.total ? `${(progress.done / progress.total) * 100}%` : '0%', background: 'var(--color-accent)', transition: 'width 0.2s' }} />
              </div>
            </div>
          )}

          <button onClick={handleRun} disabled={running || loadingSummary || noMembers} className="ff-btn-primary">
            {running ? 'Running…' : 'Run optimization'}
          </button>
        </div>
      </div>
    </div>
  )
}
