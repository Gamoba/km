'use client'

import { useState } from 'react'
import Link from 'next/link'
import { setBucketMethod } from './actions'
import { BucketScopeTab } from './BucketScopeTab'
import { BucketRunTab } from './BucketRunTab'
import { BucketRulesTab } from './BucketRulesTab'
import type { FilterConfig } from '@/app/filters/actions'
import type { BucketMethod } from '@/lib/optimizationBuckets'

type Tab = 'scope' | 'run' | 'rules'

export function BucketEditorClient({
  feedId,
  feedName,
  bucketId,
  bucketName,
  initialMethod,
  initialInclude,
  initialExclude,
}: {
  feedId: string
  feedName: string
  bucketId: string
  bucketName: string
  initialMethod: BucketMethod
  initialInclude: FilterConfig
  initialExclude: FilterConfig
}) {
  const [method, setMethod] = useState<BucketMethod>(initialMethod)
  const [tab, setTab] = useState<Tab>('scope')
  const [methodError, setMethodError] = useState<string | null>(null)

  async function changeMethod(m: BucketMethod) {
    setMethod(m) // optimistic
    if (m === 'auto' && tab === 'rules') setTab('scope')
    const r = await setBucketMethod(feedId, bucketId, m)
    if (r.error) {
      setMethodError(r.error)
      setMethod((prev) => (prev === m ? initialMethod : prev))
    } else {
      setMethodError(null)
    }
  }

  const tabBtn = (value: Tab, label: string) => {
    const isActive = tab === value
    return (
      <button
        type="button"
        onClick={() => setTab(value)}
        style={{
          padding: '4px 12px',
          fontSize: '11px',
          fontWeight: 500,
          borderRadius: '5px',
          background: isActive ? 'var(--color-accent)' : 'transparent',
          color: isActive ? '#ffffff' : 'var(--color-text-tertiary)',
        }}
      >
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
          <div className="flex gap-1">
            {tabBtn('scope', 'Scope')}
            {tabBtn('run', 'Run')}
            {method === 'rule_based' && tabBtn('rules', 'Rules')}
          </div>
        </div>
        <div className="flex items-center gap-2">
          {methodError && <span style={{ fontSize: '11px', color: 'var(--color-badge-danger-text)' }}>{methodError}</span>}
          <label className="ff-label" style={{ margin: 0 }}>Method</label>
          <select value={method} onChange={(e) => changeMethod(e.target.value as BucketMethod)} className="ff-select w-40">
            <option value="auto">Automatic</option>
            <option value="rule_based">Rule-based</option>
          </select>
        </div>
      </header>

      <main className="px-4 py-4 max-w-4xl">
        {tab === 'scope' && (
          <BucketScopeTab feedId={feedId} bucketId={bucketId} initialInclude={initialInclude} initialExclude={initialExclude} />
        )}
        {tab === 'run' && <BucketRunTab feedId={feedId} bucketId={bucketId} />}
        {tab === 'rules' && method === 'rule_based' && <BucketRulesTab feedId={feedId} bucketId={bucketId} />}
      </main>
    </div>
  )
}
