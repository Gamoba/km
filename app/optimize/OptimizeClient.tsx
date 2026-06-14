'use client'

import { useState } from 'react'
import { RunPanel } from './RunPanel'
import { ScopePanel } from './ScopePanel'
import { SettingsPanel } from './SettingsPanel'
import type { OptimizationSettings, OptFilterConfig } from '@/lib/titleOptimizationService'

type Tab = 'run' | 'scope' | 'settings'

export function OptimizeClient({
  feedId,
  feedName,
  initialSettings,
  initialInclude,
  initialExclude,
}: {
  feedId: string
  feedName: string
  initialSettings: OptimizationSettings
  initialInclude: OptFilterConfig
  initialExclude: OptFilterConfig
}) {
  const [tab, setTab] = useState<Tab>('run')

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
            {tabBtn('run', 'Run')}
            {tabBtn('scope', 'Scope')}
            {tabBtn('settings', 'Settings')}
          </div>
        </div>
      </header>

      <main className="px-4 py-4 max-w-4xl">
        {tab === 'run' && <RunPanel feedId={feedId} />}
        {tab === 'scope' && (
          <ScopePanel feedId={feedId} initialInclude={initialInclude} initialExclude={initialExclude} />
        )}
        {tab === 'settings' && <SettingsPanel feedId={feedId} initialSettings={initialSettings} />}
      </main>
    </div>
  )
}
