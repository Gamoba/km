'use client'

import { useEffect, useState } from 'react'
import { getBucketRules, saveBucketRule, deleteBucketRule } from './actions'
import type { TitleRule } from '@/lib/titleOptimizer'

const toList = (s: string) => s.split(',').map((t) => t.trim()).filter(Boolean)
const fromList = (a: string[]) => a.join(', ')

export function BucketRulesTab({ feedId, bucketId }: { feedId: string; bucketId: string }) {
  const [rules, setRules] = useState<TitleRule[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  // form
  const [productType, setProductType] = useState('')
  const [priority, setPriority] = useState('')
  const [required, setRequired] = useState('')
  const [excluded, setExcluded] = useState('')

  useEffect(() => {
    let cancelled = false
    getBucketRules(feedId, bucketId).then((r) => {
      if (cancelled) return
      if ('data' in r) setRules(r.data)
      else setError(r.error)
      setLoading(false)
    })
    return () => {
      cancelled = true
    }
  }, [feedId, bucketId])

  async function reload() {
    const r = await getBucketRules(feedId, bucketId)
    if ('data' in r) setRules(r.data)
  }

  function loadIntoForm(rule: TitleRule) {
    setProductType(rule.product_type)
    setPriority(fromList(rule.priority_attributes))
    setRequired(fromList(rule.required_attributes))
    setExcluded(fromList(rule.excluded_attributes))
  }

  function clearForm() {
    setProductType('')
    setPriority('')
    setRequired('')
    setExcluded('')
  }

  async function handleSave() {
    setError(null)
    if (!productType.trim()) {
      setError('Product type er påkrævet')
      return
    }
    setBusy(true)
    const r = await saveBucketRule(feedId, bucketId, {
      product_type: productType.trim(),
      priority_attributes: toList(priority),
      required_attributes: toList(required),
      excluded_attributes: toList(excluded),
    })
    if (r.error) setError(r.error)
    else {
      await reload()
      clearForm()
    }
    setBusy(false)
  }

  async function handleDelete(pt: string) {
    setError(null)
    setBusy(true)
    const r = await deleteBucketRule(feedId, bucketId, pt)
    if (r.error) setError(r.error)
    else await reload()
    setBusy(false)
  }

  return (
    <div className="space-y-3">
      {error && <div style={{ fontSize: '11px', color: 'var(--color-badge-danger-text)' }}>{error}</div>}

      <p style={{ fontSize: '11px', color: 'var(--color-text-tertiary)' }}>
        Rule-based buckets order title attributes per product type. Attributes are source-field
        tokens, comma-separated (e.g. <code>vendor, metafield:custom.region, metafield:custom.drue</code>).
      </p>

      {/* Editor form */}
      <div className="ff-panel">
        <div className="ff-panel-header" style={{ textTransform: 'none', letterSpacing: 0, fontSize: '12px', padding: '10px 14px' }}>
          Add / edit rule
        </div>
        <div className="p-3.5 space-y-2">
          <div>
            <label className="ff-label">Product type</label>
            <input type="text" value={productType} onChange={(e) => setProductType(e.target.value)} placeholder="e.g. Rødvin" className="ff-input w-56" />
          </div>
          <div>
            <label className="ff-label">Priority attributes (order matters)</label>
            <input type="text" value={priority} onChange={(e) => setPriority(e.target.value)} placeholder="vendor, metafield:custom.region, …" className="ff-input w-full" style={{ fontFamily: 'var(--font-mono)', fontSize: '11px' }} />
          </div>
          <div>
            <label className="ff-label">Always include if present</label>
            <input type="text" value={required} onChange={(e) => setRequired(e.target.value)} placeholder="metafield:custom.drue" className="ff-input w-full" style={{ fontFamily: 'var(--font-mono)', fontSize: '11px' }} />
          </div>
          <div>
            <label className="ff-label">Never include</label>
            <input type="text" value={excluded} onChange={(e) => setExcluded(e.target.value)} placeholder="metafield:custom.intern" className="ff-input w-full" style={{ fontFamily: 'var(--font-mono)', fontSize: '11px' }} />
          </div>
          <div className="flex items-center gap-2">
            <button onClick={handleSave} disabled={busy} className="ff-btn-primary">Save rule</button>
            <button onClick={clearForm} className="ff-btn-ghost" style={{ fontSize: '11px', padding: '0 8px' }}>Clear</button>
          </div>
        </div>
      </div>

      {/* Existing rules */}
      {loading ? (
        <p style={{ fontSize: '11px', color: 'var(--color-text-tertiary)' }}>Loading…</p>
      ) : rules.length === 0 ? (
        <p style={{ fontSize: '11px', color: 'var(--color-text-tertiary)' }}>No rules yet — add one above.</p>
      ) : (
        <div className="space-y-2">
          {rules.map((rule) => (
            <div key={rule.product_type} className="ff-panel">
              <div className="p-3.5 flex items-start gap-3">
                <div className="min-w-0 flex-1">
                  <div style={{ fontSize: '12px', fontWeight: 600, color: 'var(--color-text-primary)' }}>{rule.product_type}</div>
                  <div className="mt-1" style={{ fontSize: '10px', color: 'var(--color-text-tertiary)', fontFamily: 'var(--font-mono)' }}>
                    <div>priority: {fromList(rule.priority_attributes) || '—'}</div>
                    <div>required: {fromList(rule.required_attributes) || '—'}</div>
                    <div>excluded: {fromList(rule.excluded_attributes) || '—'}</div>
                  </div>
                </div>
                <div className="flex items-center gap-2 shrink-0">
                  <button onClick={() => loadIntoForm(rule)} className="ff-btn-ghost" style={{ fontSize: '11px', padding: '0 8px' }}>Edit</button>
                  <button onClick={() => handleDelete(rule.product_type)} disabled={busy} className="ff-btn-ghost" style={{ fontSize: '11px', padding: '0 8px', color: 'var(--color-badge-danger-text)' }}>Delete</button>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
