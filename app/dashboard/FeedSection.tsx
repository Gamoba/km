'use client'

import { useEffect, useState } from 'react'

type CacheInfo = {
  generated_at: string | null
  product_count: number | null
}

// Controlled component — cacheInfo, regenerate state and error live in the
// parent so they stay in sync with other dashboard sections (status overview,
// statistics, next-steps "Generer feed" button) that share the same data.
export function FeedSection({
  feedId,
  cacheInfo,
  onRegenerate,
  isRegenerating,
  error,
}: {
  feedId: string
  cacheInfo: CacheInfo | null
  onRegenerate: () => void
  isRegenerating: boolean
  error: string | null
}) {
  const [copied, setCopied] = useState(false)
  const [origin, setOrigin] = useState('')

  useEffect(() => {
    setOrigin(window.location.origin)
  }, [])

  const feedUrl = `${origin}/api/feed/generate/${feedId}`

  async function copyUrl() {
    await navigator.clipboard.writeText(feedUrl)
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }

  return (
    <div className="wl-card">
      <div style={{ padding: '14px 18px', borderBottom: '1px solid var(--hairline)' }}>
        <span style={{ fontSize: '15px', fontWeight: 500, color: 'var(--ink)' }}>Your feed</span>
      </div>

      <div className="p-4 space-y-2">
        <div className="flex gap-2">
          <code
            className="flex-1 min-w-0 px-2.5 py-1.5 truncate ff-mono"
            style={{
              fontSize: '11px',
              background: 'var(--bg-surface)',
              border: '1px solid var(--hairline)',
              borderRadius: '8px',
              color: 'var(--ink-muted)',
            }}
          >
            {origin ? feedUrl : `…/api/feed/generate/${feedId}`}
          </code>
          <button onClick={copyUrl} className="wl-btn-secondary shrink-0">
            {copied ? 'Copied' : 'Copy URL'}
          </button>
          <button onClick={onRegenerate} disabled={isRegenerating} className="wl-btn-primary shrink-0">
            {isRegenerating ? 'Generating…' : 'Generate feed'}
          </button>
        </div>

        {error && (
          <p style={{ fontSize: '11px', color: 'var(--color-badge-danger-text)' }}>{error}</p>
        )}

        {cacheInfo?.generated_at ? (
          <p style={{ fontSize: '11px', color: 'var(--ink-muted)' }}>
            Last generated:{' '}
            {new Date(cacheInfo.generated_at).toLocaleString('en-US')}
            {cacheInfo.product_count != null && (
              <> &middot; {cacheInfo.product_count} products</>
            )}
          </p>
        ) : (
          <p style={{ fontSize: '11px', fontStyle: 'italic', color: 'var(--ink-muted)' }}>
            Feed has not been generated yet
          </p>
        )}
      </div>
    </div>
  )
}
