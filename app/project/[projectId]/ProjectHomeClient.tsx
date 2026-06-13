'use client'

import Link from 'next/link'
import { useState } from 'react'
import { FeedListClient } from '@/app/dashboard/FeedListClient'
import {
  ProjectConnectModal,
  projectStatusBadge,
  type ConnectResult,
} from '@/app/components/ProjectConnectModal'

export function ProjectHomeClient({
  projectId,
  projectName,
  shopUrl: initialShopUrl,
  connectionStatus: initialStatus,
  lastVerifiedAt: initialVerifiedAt,
}: {
  projectId: string
  projectName: string
  shopUrl: string | null
  connectionStatus: string
  lastVerifiedAt: string | null
}) {
  const [shopUrl, setShopUrl] = useState(initialShopUrl)
  const [status, setStatus] = useState(initialStatus)
  const [lastVerifiedAt, setLastVerifiedAt] = useState(initialVerifiedAt)
  const [connectOpen, setConnectOpen] = useState(false)
  const [readMarketsMissing, setReadMarketsMissing] = useState(false)

  const connected = status === 'connected'
  const badge = projectStatusBadge(status)

  function handleConnected(result: ConnectResult) {
    setStatus(result.connection_status)
    setLastVerifiedAt(result.last_verified_at)
    setShopUrl(result.shop)
    setReadMarketsMissing(result.readMarketsMissing)
  }

  return (
    <div className="min-h-screen">
      <header className="ff-topbar">
        <div className="flex items-center gap-3 min-w-0">
          <Link
            href="/"
            style={{ fontSize: '11px', color: 'var(--color-text-tertiary)', textDecoration: 'none' }}
          >
            Projects
          </Link>
          <span style={{ color: 'var(--color-text-tertiary)' }}>/</span>
          <h1 className="ff-topbar-title truncate">{projectName}</h1>
          <span className={badge.className}>{badge.label}</span>
        </div>
        <button onClick={() => setConnectOpen(true)} className="ff-btn-secondary">
          {connected ? 'Replace token' : 'Connect Shopify'}
        </button>
      </header>

      <main className="px-4 py-4 max-w-6xl space-y-3">
        {/* Connection panel */}
        <div className="ff-panel">
          <div className="ff-panel-header" style={{ textTransform: 'none', letterSpacing: 0, fontSize: '11px' }}>
            <span style={{ fontSize: '12px', fontWeight: 500, color: 'var(--color-text-primary)' }}>
              Shopify connection
            </span>
          </div>
          <div className="p-3.5">
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
              <ConnInfo label="Status" value={badge.label} />
              <ConnInfo label="Shop URL" value={shopUrl ?? '—'} mono />
              <ConnInfo
                label="Last verified"
                value={
                  lastVerifiedAt
                    ? new Date(lastVerifiedAt).toLocaleString('en-US', {
                        day: '2-digit',
                        month: '2-digit',
                        year: 'numeric',
                        hour: '2-digit',
                        minute: '2-digit',
                      })
                    : '—'
                }
              />
            </div>

            {!connected && (
              <div
                className="mt-3 flex items-start gap-2 p-2.5"
                style={{
                  background: 'var(--color-badge-warning-bg)',
                  border: '1px solid var(--color-badge-warning-text)',
                  borderRadius: '4px',
                }}
              >
                <p style={{ fontSize: '11px', color: 'var(--color-badge-warning-text)' }}>
                  Connect this project to Shopify before creating feeds — markets and product sync need a
                  verified access token.
                </p>
              </div>
            )}

            {connected && readMarketsMissing && (
              <div
                className="mt-3 flex items-start gap-2 p-2.5"
                style={{
                  background: 'var(--color-badge-warning-bg)',
                  border: '1px solid var(--color-badge-warning-text)',
                  borderRadius: '4px',
                }}
              >
                <p style={{ fontSize: '11px', color: 'var(--color-badge-warning-text)' }}>
                  Connected, but the app is missing the <strong>read_markets</strong> scope. Product sync
                  works, but markets won’t load in the feed wizard.
                </p>
              </div>
            )}
          </div>
        </div>

        {/* Feeds for this project */}
        <FeedListClient projectId={projectId} connected={connected} />
      </main>

      {connectOpen && (
        <ProjectConnectModal
          projectId={projectId}
          mode={connected ? 'rotate' : 'connect'}
          initialShopUrl={shopUrl}
          onClose={() => setConnectOpen(false)}
          onConnected={handleConnected}
        />
      )}
    </div>
  )
}

function ConnInfo({ label, value, mono }: { label: string; value: string; mono?: boolean }) {
  return (
    <div
      className="px-3 py-2"
      style={{
        background: 'var(--color-background-secondary)',
        border: '1px solid var(--color-border-tertiary)',
        borderRadius: '4px',
      }}
    >
      <p className="ff-label">{label}</p>
      <p
        className={`mt-0.5 truncate${mono ? ' ff-mono' : ''}`}
        style={{ fontSize: '12px', fontWeight: 500, color: 'var(--color-text-primary)' }}
      >
        {value}
      </p>
    </div>
  )
}
