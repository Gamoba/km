'use client'

import { useState, useTransition } from 'react'
import Link from 'next/link'
import { createBucket, renameBucket, deleteBucket } from './actions'
import type { BucketSummary, BucketMethod } from '@/lib/optimizationBuckets'

function methodLabel(m: BucketMethod) {
  return m === 'auto' ? 'Automatic' : 'Rule-based'
}

export function BucketListPanel({
  feedId,
  initialBuckets,
}: {
  feedId: string
  initialBuckets: BucketSummary[]
}) {
  const [list, setList] = useState<BucketSummary[]>(initialBuckets)
  const [name, setName] = useState('')
  const [method, setMethod] = useState<BucketMethod>('auto')
  const [editingId, setEditingId] = useState<string | null>(null)
  const [editName, setEditName] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [isPending, startTransition] = useTransition()

  function handleCreate() {
    setError(null)
    if (!name.trim()) return
    startTransition(async () => {
      const r = await createBucket(feedId, name.trim(), method)
      if ('error' in r) setError(r.error)
      else {
        setList((prev) => [
          ...prev,
          { ...r.data, memberCount: 0, aiGenerated: 0, humanEdited: 0, needsReview: 0 },
        ])
        setName('')
      }
    })
  }

  function handleRename(id: string) {
    setError(null)
    if (!editName.trim()) {
      setEditingId(null)
      return
    }
    startTransition(async () => {
      const r = await renameBucket(feedId, id, editName.trim())
      if (r.error) setError(r.error)
      else {
        setList((prev) => prev.map((b) => (b.id === id ? { ...b, name: editName.trim() } : b)))
        setEditingId(null)
      }
    })
  }

  function handleDelete(id: string, bname: string) {
    setError(null)
    if (!confirm(`Delete bucket “${bname}”? Its membership is removed, but any titles it already produced stay in the feed.`)) return
    startTransition(async () => {
      const r = await deleteBucket(feedId, id)
      if (r.error) setError(r.error)
      else setList((prev) => prev.filter((b) => b.id !== id))
    })
  }

  return (
    <div className="space-y-3">
      {error && (
        <div style={{ fontSize: '11px', color: 'var(--color-badge-danger-text)' }}>{error}</div>
      )}

      {/* Create */}
      <div className="ff-panel">
        <div
          className="ff-panel-header"
          style={{ textTransform: 'none', letterSpacing: 0, fontSize: '12px', padding: '10px 14px' }}
        >
          New bucket
        </div>
        <div className="p-3.5 flex items-end gap-2 flex-wrap">
          <div>
            <label className="ff-label">Name</label>
            <input
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && handleCreate()}
              placeholder="e.g. Vintage reds"
              className="ff-input w-56"
            />
          </div>
          <div>
            <label className="ff-label">Method</label>
            <select value={method} onChange={(e) => setMethod(e.target.value as BucketMethod)} className="ff-select w-40">
              <option value="auto">Automatic</option>
              <option value="rule_based">Rule-based</option>
            </select>
          </div>
          <button onClick={handleCreate} disabled={isPending || !name.trim()} className="ff-btn-primary">
            Create bucket
          </button>
        </div>
      </div>

      {/* List */}
      {list.length === 0 ? (
        <p className="text-center py-6" style={{ fontSize: '12px', color: 'var(--color-text-tertiary)' }}>
          No buckets yet. Create one above to group products for optimization.
        </p>
      ) : (
        <div className="space-y-2">
          {list.map((b) => (
            <div key={b.id} className="ff-panel">
              <div className="p-3.5 flex items-center gap-3">
                <div className="min-w-0 flex-1">
                  {editingId === b.id ? (
                    <div className="flex items-center gap-2">
                      <input
                        type="text"
                        value={editName}
                        onChange={(e) => setEditName(e.target.value)}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter') handleRename(b.id)
                          if (e.key === 'Escape') setEditingId(null)
                        }}
                        autoFocus
                        className="ff-input w-56"
                      />
                      <button onClick={() => handleRename(b.id)} disabled={isPending} className="ff-btn-secondary">Save</button>
                      <button onClick={() => setEditingId(null)} className="ff-btn-ghost" style={{ fontSize: '11px', padding: '0 8px' }}>Cancel</button>
                    </div>
                  ) : (
                    <div className="flex items-center gap-2">
                      <Link
                        href={`/feed/${feedId}/optimize/${b.id}`}
                        style={{ fontSize: '13px', fontWeight: 600, color: 'var(--color-text-primary)' }}
                      >
                        {b.name}
                      </Link>
                      <span className="ff-badge ff-badge-neutral">{methodLabel(b.method)}</span>
                    </div>
                  )}
                  <div className="mt-1" style={{ fontSize: '11px', color: 'var(--color-text-tertiary)' }}>
                    {b.memberCount} {b.memberCount === 1 ? 'product' : 'products'}
                    {b.aiGenerated > 0 ? ` · ${b.aiGenerated} optimized` : ''}
                    {b.humanEdited > 0 ? ` · ${b.humanEdited} hand-edited` : ''}
                    {b.needsReview > 0 ? ` · ${b.needsReview} to review` : ''}
                  </div>
                </div>
                {editingId !== b.id && (
                  <div className="flex items-center gap-2 shrink-0">
                    <Link href={`/feed/${feedId}/optimize/${b.id}`} className="ff-btn-secondary">Open</Link>
                    <button
                      onClick={() => {
                        setEditingId(b.id)
                        setEditName(b.name)
                      }}
                      className="ff-btn-ghost"
                      style={{ fontSize: '11px', padding: '0 8px' }}
                    >
                      Rename
                    </button>
                    <button
                      onClick={() => handleDelete(b.id, b.name)}
                      disabled={isPending}
                      className="ff-btn-ghost"
                      style={{ fontSize: '11px', padding: '0 8px', color: 'var(--color-badge-danger-text)' }}
                    >
                      Delete
                    </button>
                  </div>
                )}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
