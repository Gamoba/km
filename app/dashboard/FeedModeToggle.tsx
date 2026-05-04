'use client'

import { useState, useTransition } from 'react'
import { saveFeedMode } from './actions'

export function FeedModeToggle({
  feedId,
  initialMode,
}: {
  feedId: string
  initialMode: 'product' | 'variant'
}) {
  const [mode, setMode] = useState<'product' | 'variant'>(initialMode)
  const [isPending, startTransition] = useTransition()

  function toggle(next: 'product' | 'variant') {
    if (next === mode || isPending) return
    setMode(next)
    startTransition(async () => {
      await saveFeedMode(feedId, next)
    })
  }

  return (
    <div className="flex items-center gap-2">
      <span className="ff-label">Feed mode</span>
      <div
        className="inline-flex overflow-hidden"
        style={{
          border: '1px solid var(--color-border-secondary)',
          borderRadius: '4px',
          opacity: isPending ? 0.5 : 1,
        }}
      >
        {(['product', 'variant'] as const).map((m, i) => (
          <button
            key={m}
            onClick={() => toggle(m)}
            disabled={isPending}
            style={{
              padding: '4px 10px',
              fontSize: '11px',
              fontWeight: 500,
              borderLeft: i > 0 ? '1px solid var(--color-border-secondary)' : 'none',
              background: mode === m ? '#6c5ce7' : 'transparent',
              color: mode === m ? '#ffffff' : 'var(--color-text-secondary)',
              cursor: isPending ? 'not-allowed' : 'pointer',
              transition: 'background 0.12s ease',
            }}
          >
            {m === 'product' ? 'Product' : 'Variant'}
          </button>
        ))}
      </div>
    </div>
  )
}
