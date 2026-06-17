'use client'

import { useEffect, useMemo, useState, useTransition } from 'react'
import {
  getBucketCandidates,
  getBucketOverlap,
  getFeedMetafields,
  saveBucketFilters,
  setBucketMembership,
  getBucketManualProducts,
  addManualBucketProducts,
  removeManualBucketProduct,
  searchFeedProducts,
} from './actions'
import { FilterSection, defaultRule, type MetafieldOption } from '@/app/components/FilterEditor'
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

  // Feed's actual metafields → the scope filter's metafield dropdown (pick from
  // what exists instead of typing namespace.key). Undefined until loaded; while
  // undefined the editor falls back to its free-text metafield input.
  const [metafields, setMetafields] = useState<MetafieldOption[] | undefined>(undefined)
  useEffect(() => {
    getFeedMetafields(feedId).then((r) => {
      if ('data' in r) setMetafields(r.data)
    })
  }, [feedId])

  const [candidates, setCandidates] = useState<string[] | null>(null)
  const [overlap, setOverlap] = useState<OverlapData | null>(null)
  const [pullIn, setPullIn] = useState<Set<string>>(new Set())

  // Manual additions (source='manual') — additive to the filter, surviving filter
  // changes. Committed immediately (with the same overlap warning the filter uses).
  const [manual, setManual] = useState<{ product_ref: string; title: string }[]>([])
  const [search, setSearch] = useState('')
  const [results, setResults] = useState<{ product_ref: string; title: string; vendor: string | null; image_url: string | null }[]>([])
  const [searching, setSearching] = useState(false)
  const [addBusy, setAddBusy] = useState<string | null>(null)
  const [pendingConflict, setPendingConflict] = useState<{ ref: string; title: string; bucketName: string } | null>(null)

  const manualRefs = useMemo(() => new Set(manual.map((m) => m.product_ref)), [manual])

  // Load the bucket's manual products on mount.
  useEffect(() => {
    getBucketManualProducts(feedId, bucketId).then((r) => {
      if ('data' in r) setManual(r.data)
    })
  }, [feedId, bucketId])

  // Debounced product search for the manual-add picker.
  useEffect(() => {
    const q = search.trim()
    if (!q) {
      setResults([])
      return
    }
    let cancelled = false
    setSearching(true)
    const t = setTimeout(async () => {
      const r = await searchFeedProducts(feedId, q)
      if (cancelled) return
      if ('data' in r) setResults(r.data)
      setSearching(false)
    }, 300)
    return () => {
      cancelled = true
      clearTimeout(t)
    }
  }, [search, feedId])

  async function refreshManual() {
    const r = await getBucketManualProducts(feedId, bucketId)
    if ('data' in r) setManual(r.data)
  }

  // Add flow: run the SAME overlap check the filter uses. If the product belongs
  // to another bucket, require a deliberate confirm (move) before committing.
  async function attemptAdd(ref: string, title: string) {
    setError(null)
    setAddBusy(ref)
    const ov = await getBucketOverlap(feedId, bucketId, [ref])
    if ('error' in ov) {
      setError(ov.error)
      setAddBusy(null)
      return
    }
    const conflict = ov.data.conflicts[0]
    if (conflict) {
      setPendingConflict({ ref, title, bucketName: conflict.bucketName })
      setAddBusy(null)
      return
    }
    await commitAdd(ref)
    setAddBusy(null)
  }
  async function commitAdd(ref: string) {
    const r = await addManualBucketProducts(feedId, bucketId, [ref])
    if (r.error) setError(r.error)
    else await refreshManual()
    setPendingConflict(null)
  }
  async function removeManual(ref: string) {
    setError(null)
    const r = await removeManualBucketProduct(feedId, bucketId, ref)
    if (r.error) setError(r.error)
    else setManual((prev) => prev.filter((m) => m.product_ref !== ref))
  }

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

  // One step: persist the bucket's scope (the include/exclude filter) AND show
  // the matching products. Membership isn't committed here — it depends on the
  // overlap pull-in choices below and is confirmed by the second button.
  async function handlePreview() {
    setError(null)
    setPreviewing(true)
    setSaved(false)
    const f = await saveBucketFilters(feedId, bucketId, include, exclude)
    if (f.error) {
      setError(f.error)
      setPreviewing(false)
      return
    }
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

  // Bulk pull-in toggle for the overlap list — every conflict at once, then the
  // user can still fine-tune individual rows.
  const allPulledIn = !!overlap && overlap.conflicts.length > 0 && overlap.conflicts.every((c) => pullIn.has(c.product_ref))
  function togglePullAll() {
    if (!overlap) return
    setPullIn(allPulledIn ? new Set() : new Set(overlap.conflicts.map((c) => c.product_ref)))
  }

  // Filter is already persisted by handlePreview (and `stale` forces a re-preview
  // after any edit), so this step only commits membership.
  function handleSave() {
    setError(null)
    startSave(async () => {
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
      {/* Self-contained sub-header: primary save sits top-right, consistent with
          the Settings/Mapping/Filters pages. Saving the scope also previews the
          matches below; membership is then confirmed separately. */}
      <div className="flex items-start justify-between gap-3">
        <p style={{ fontSize: '11px', color: 'var(--color-text-tertiary)' }}>
          Define which products this bucket targets. Save to preview the matches, decide what to do
          with any that already belong to another bucket, then confirm membership below.
        </p>
        <button onClick={handlePreview} disabled={previewing} className="ff-btn-primary shrink-0">
          {previewing ? 'Saving…' : 'Save scope'}
        </button>
      </div>

      {error && <div style={{ fontSize: '11px', color: 'var(--color-badge-danger-text)' }}>{error}</div>}

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
        metafieldOptions={metafields}
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
        metafieldOptions={metafields}
      />

      {/* Manual additions — added on top of the filter; survive filter changes. */}
      <div className="ff-panel">
        <div className="ff-panel-header" style={{ textTransform: 'none', letterSpacing: 0, fontSize: '12px', padding: '10px 14px' }}>
          Add products manually
        </div>
        <div className="p-3.5 space-y-2.5">
          <p style={{ fontSize: '11px', color: 'var(--color-text-tertiary)' }}>
            Add specific products on top of the filter. Manual additions stay in the bucket even when you change the
            filter. {manual.length} manually added.
          </p>

          {pendingConflict && (
            <div
              className="space-y-2"
              style={{ fontSize: '11px', padding: '8px 10px', borderRadius: '6px', background: 'var(--color-badge-warning-bg)', border: '1px solid var(--color-badge-warning-text)' }}
            >
              <div style={{ color: 'var(--color-badge-warning-text)' }}>
                “{pendingConflict.title}” already belongs to bucket “{pendingConflict.bucketName}”. Moving it here removes
                it from that bucket (one bucket per product).
              </div>
              <div className="flex items-center gap-2">
                <button onClick={() => commitAdd(pendingConflict.ref)} className="ff-btn-primary">
                  Move it here
                </button>
                <button onClick={() => setPendingConflict(null)} className="ff-btn-ghost" style={{ fontSize: '11px', padding: '0 8px' }}>
                  Cancel
                </button>
              </div>
            </div>
          )}

          <input
            type="search"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search products by title or vendor…"
            className="ff-input w-full"
          />

          {searching && <p style={{ fontSize: '11px', color: 'var(--color-text-tertiary)' }}>Searching…</p>}

          {results.length > 0 && (
            <div className="space-y-1" style={{ maxHeight: '260px', overflowY: 'auto' }}>
              {results.map((p) => {
                const added = manualRefs.has(p.product_ref)
                return (
                  <div key={p.product_ref} className="flex items-center gap-2">
                    {p.image_url ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img src={p.image_url} alt="" loading="lazy" className="w-8 h-8 object-cover shrink-0" style={{ borderRadius: '4px', border: '1px solid var(--color-border-tertiary)' }} />
                    ) : (
                      <div className="w-8 h-8 shrink-0" style={{ background: 'var(--color-background-secondary)', borderRadius: '4px' }} />
                    )}
                    <div className="flex-1 min-w-0">
                      <div className="truncate" style={{ fontSize: '11px', color: 'var(--color-text-primary)' }}>{p.title}</div>
                      {p.vendor && <div className="truncate" style={{ fontSize: '10px', color: 'var(--color-text-tertiary)' }}>{p.vendor}</div>}
                    </div>
                    <button
                      type="button"
                      onClick={() => attemptAdd(p.product_ref, p.title)}
                      disabled={added || addBusy === p.product_ref}
                      className="ff-btn-secondary shrink-0"
                    >
                      {added ? 'Added' : addBusy === p.product_ref ? 'Adding…' : 'Add'}
                    </button>
                  </div>
                )
              })}
            </div>
          )}

          {manual.length > 0 && (
            <div>
              <label className="ff-label">Manually added ({manual.length})</label>
              <div className="space-y-1">
                {manual.map((m) => (
                  <div
                    key={m.product_ref}
                    className="flex items-center gap-2"
                    style={{ fontSize: '11px', padding: '4px 8px', border: '1px solid var(--color-border-secondary)', borderRadius: '5px' }}
                  >
                    <span className="flex-1 min-w-0 truncate" style={{ color: 'var(--color-text-primary)' }} title={m.product_ref}>{m.title}</span>
                    <button type="button" onClick={() => removeManual(m.product_ref)} className="ff-btn-ghost shrink-0 w-5 h-5" aria-label="Remove manual product">×</button>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      </div>

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
              {manual.length > 0 && (
                <>
                  {' '}
                  <span style={{ color: 'var(--color-text-tertiary)' }}>
                    + {manual.length} manual →{' '}
                    <strong style={{ color: 'var(--color-text-primary)' }}>
                      {new Set([...candidates, ...manualRefs]).size}
                    </strong>{' '}
                    in scope.
                  </span>
                </>
              )}
            </div>

            {overlap.conflicts.length > 0 && (
              <div className="space-y-1.5">
                <div style={{ fontSize: '11px', color: 'var(--color-text-secondary)' }}>
                  These already belong to another bucket. Check to pull them into THIS bucket (they move,
                  enforcing one bucket per product); leave unchecked to keep them where they are:
                </div>
                <button
                  type="button"
                  onClick={togglePullAll}
                  className="ff-btn-ghost"
                  style={{ fontSize: '10px', fontWeight: 500, color: 'var(--color-accent)', padding: '2px 6px', alignSelf: 'flex-start' }}
                >
                  {allPulledIn ? 'Deselect all' : 'Select all'}
                </button>
                <div className="space-y-1" style={{ maxHeight: '280px', overflowY: 'auto' }}>
                  {overlap.conflicts.map((c) => (
                    <label key={c.product_ref} className="flex items-center gap-2" style={{ fontSize: '11px' }}>
                      <input type="checkbox" checked={pullIn.has(c.product_ref)} onChange={() => togglePull(c.product_ref)} />
                      <span style={{ color: 'var(--color-text-secondary)' }} title={c.product_ref}>{c.title}</span>
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
                {isSaving ? 'Saving…' : saved ? 'Saved' : `Confirm membership (${finalRefs.length} products)`}
              </button>
              <span style={{ fontSize: '10px', color: 'var(--color-text-tertiary)' }}>
                Sets this bucket&apos;s membership to the {finalRefs.length} products shown.
              </span>
            </div>
          </div>
        </div>
      )}

      {stale && candidates && (
        <p style={{ fontSize: '11px', color: 'var(--color-text-tertiary)' }}>
          Filter changed — “Save scope” again to refresh the matches before confirming membership.
        </p>
      )}
    </div>
  )
}
