'use client'

import { useMemo, useState, useTransition } from 'react'
import {
  getBucketCandidates,
  getBucketOverlap,
  saveBucketFilters,
  setBucketMembership,
} from './actions'
import { FilterSection, defaultRule } from '@/app/components/FilterEditor'
import type { FilterRule, FilterConfig } from '@/app/filters/actions'
import type { BucketConflict } from '@/lib/optimizationBuckets'

type OverlapData = { conflicts: BucketConflict[]; inThisBucket: number; unassigned: number }

export function BucketScopeTab({
  feedId,
  bucketId,
  initialInclude,
  initialExclude,
}: {
  feedId: string
  bucketId: string
  initialInclude: FilterConfig
  initialExclude: FilterConfig
}) {
  const [include, setInclude] = useState<FilterConfig>(initialInclude)
  const [exclude, setExclude] = useState<FilterConfig>(initialExclude)

  const [candidates, setCandidates] = useState<string[] | null>(null)
  const [overlap, setOverlap] = useState<OverlapData | null>(null)
  const [pullIn, setPullIn] = useState<Set<string>>(new Set())

  const [previewing, setPreviewing] = useState(false)
  const [saved, setSaved] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [isSaving, startSave] = useTransition()

  // dirty if the filter changed since the last preview — forces a re-preview
  // before saving so membership matches what's shown.
  const [stale, setStale] = useState(false)
  function touch() {
    setStale(true)
    setSaved(false)
  }

  function addRule(t: 'include' | 'exclude') {
    ;(t === 'include' ? setInclude : setExclude)((p) => ({ ...p, rules: [...p.rules, defaultRule()] }))
    touch()
  }
  function removeRule(t: 'include' | 'exclude', i: number) {
    ;(t === 'include' ? setInclude : setExclude)((p) => ({ ...p, rules: p.rules.filter((_, j) => j !== i) }))
    touch()
  }
  function updateRule(t: 'include' | 'exclude', i: number, patch: Partial<FilterRule>) {
    ;(t === 'include' ? setInclude : setExclude)((p) => ({ ...p, rules: p.rules.map((r, j) => (j === i ? { ...r, ...patch } : r)) }))
    touch()
  }
  function setOp(t: 'include' | 'exclude', op: 'AND' | 'OR') {
    ;(t === 'include' ? setInclude : setExclude)((p) => ({ ...p, operator: op }))
    touch()
  }

  async function handlePreview() {
    setError(null)
    setPreviewing(true)
    setSaved(false)
    const c = await getBucketCandidates(feedId, include, exclude)
    if ('error' in c) {
      setError(c.error)
      setPreviewing(false)
      return
    }
    setCandidates(c.data)
    const ov = await getBucketOverlap(feedId, bucketId, c.data)
    if ('error' in ov) setError(ov.error)
    else {
      setOverlap(ov.data)
      setPullIn(new Set()) // default: leave conflicts in their current bucket
    }
    setStale(false)
    setPreviewing(false)
  }

  // Final membership = all candidates except conflicts the user chose to LEAVE.
  const finalRefs = useMemo(() => {
    if (!candidates || !overlap) return []
    const leave = new Set(overlap.conflicts.filter((c) => !pullIn.has(c.product_ref)).map((c) => c.product_ref))
    return candidates.filter((r) => !leave.has(r))
  }, [candidates, overlap, pullIn])

  function togglePull(ref: string) {
    setPullIn((prev) => {
      const next = new Set(prev)
      if (next.has(ref)) next.delete(ref)
      else next.add(ref)
      return next
    })
  }

  function handleSave() {
    setError(null)
    startSave(async () => {
      const f = await saveBucketFilters(feedId, bucketId, include, exclude)
      if (f.error) {
        setError(f.error)
        return
      }
      const m = await setBucketMembership(feedId, bucketId, finalRefs)
      if (m.error) setError(m.error)
      else {
        setSaved(true)
        setTimeout(() => setSaved(false), 3000)
      }
    })
  }

  return (
    <div className="space-y-3">
      {error && <div style={{ fontSize: '11px', color: 'var(--color-badge-danger-text)' }}>{error}</div>}

      <p style={{ fontSize: '11px', color: 'var(--color-text-tertiary)' }}>
        Define which products this bucket targets. Preview the matches, decide what to do with any
        that already belong to another bucket, then save the membership.
      </p>

      <FilterSection
        title="Include products"
        description="Only products matching these rules are candidates. No rules = all feed products."
        badge="INCLUDE"
        badgeCls="ff-badge ff-badge-success"
        config={include}
        onAddRule={() => addRule('include')}
        onRemoveRule={(i) => removeRule('include', i)}
        onUpdateRule={(i, p) => updateRule('include', i, p)}
        onSetOperator={(op) => setOp('include', op)}
      />
      <FilterSection
        title="Exclude products"
        description="Products matching these rules are removed from the candidates."
        badge="EXCLUDE"
        badgeCls="ff-badge ff-badge-danger"
        config={exclude}
        onAddRule={() => addRule('exclude')}
        onRemoveRule={(i) => removeRule('exclude', i)}
        onUpdateRule={(i, p) => updateRule('exclude', i, p)}
        onSetOperator={(op) => setOp('exclude', op)}
      />

      <button onClick={handlePreview} disabled={previewing} className="ff-btn-secondary">
        {previewing ? 'Finding…' : 'Preview matches'}
      </button>

      {candidates && overlap && !stale && (
        <div className="ff-panel">
          <div className="ff-panel-header" style={{ textTransform: 'none', letterSpacing: 0, fontSize: '12px', padding: '10px 14px' }}>
            Matches
          </div>
          <div className="p-3.5 space-y-3">
            <div style={{ fontSize: '12px', color: 'var(--color-text-secondary)' }}>
              <strong style={{ color: 'var(--color-text-primary)' }}>{candidates.length}</strong> products match.{' '}
              {overlap.inThisBucket} already in this bucket · {overlap.unassigned} unassigned ·{' '}
              <strong style={{ color: overlap.conflicts.length ? 'var(--color-badge-warning-text)' : 'inherit' }}>
                {overlap.conflicts.length}
              </strong>{' '}
              in other buckets.
            </div>

            {overlap.conflicts.length > 0 && (
              <div className="space-y-1.5">
                <div style={{ fontSize: '11px', color: 'var(--color-text-secondary)' }}>
                  These already belong to another bucket. Check to pull them into THIS bucket (they move,
                  enforcing one bucket per product); leave unchecked to keep them where they are:
                </div>
                <div className="space-y-1" style={{ maxHeight: '280px', overflowY: 'auto' }}>
                  {overlap.conflicts.map((c) => (
                    <label key={c.product_ref} className="flex items-center gap-2" style={{ fontSize: '11px' }}>
                      <input type="checkbox" checked={pullIn.has(c.product_ref)} onChange={() => togglePull(c.product_ref)} />
                      <span style={{ color: 'var(--color-text-secondary)' }}>{c.product_ref}</span>
                      <span style={{ color: 'var(--color-text-tertiary)' }}>in “{c.bucketName}”</span>
                      {c.status && (
                        <span className={`ff-badge ${c.status === 'human_edited' ? 'ff-badge-warning' : 'ff-badge-neutral'}`}>
                          {c.status}
                        </span>
                      )}
                    </label>
                  ))}
                </div>
              </div>
            )}

            <div className="flex items-center gap-2">
              <button onClick={handleSave} disabled={isSaving} className="ff-btn-primary">
                {isSaving ? 'Saving…' : saved ? 'Saved' : `Save scope (${finalRefs.length} products)`}
              </button>
              <span style={{ fontSize: '10px', color: 'var(--color-text-tertiary)' }}>
                Saving sets this bucket&apos;s membership to the {finalRefs.length} products shown.
              </span>
            </div>
          </div>
        </div>
      )}

      {stale && candidates && (
        <p style={{ fontSize: '11px', color: 'var(--color-text-tertiary)' }}>
          Filter changed — preview again to refresh matches before saving.
        </p>
      )}
    </div>
  )
}
