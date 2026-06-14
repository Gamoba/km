'use client'

import { useState } from 'react'
import { BucketListPanel } from './BucketListPanel'
import { SettingsPanel } from './SettingsPanel'
import type { OptimizationSettings } from '@/lib/titleOptimizationService'
import type { BucketSummary } from '@/lib/optimizationBuckets'

type Tab = 'buckets' | 'settings'

export function OptimizeClient({
  feedId,
  feedName,
  initialSettings,
  initialBuckets,
}: {
  feedId: string
  feedName: string
  initialSettings: OptimizationSettings
  initialBuckets: BucketSummary[]
}) {
  const [tab, setTab] = useState<Tab>('buckets')

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
          <h1 className="ff-topbar-title">{feedName} · AI Titles</h1>
          <div className="flex gap-1">
            {tabBtn('buckets', 'Buckets')}
            {tabBtn('settings', 'Settings')}
          </div>
        </div>
      </header>

      <main className="px-4 py-4 max-w-4xl">
        {tab === 'buckets' && <BucketListPanel feedId={feedId} initialBuckets={initialBuckets} />}
        {tab === 'settings' && <SettingsPanel feedId={feedId} initialSettings={initialSettings} />}
      </main>
    </div>
  )
}
