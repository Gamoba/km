'use client'

import Link from 'next/link'
import { useEffect, useRef, useState } from 'react'
import type { ValidationIssue } from '@/lib/feedValidator'
import { FeedWizardModal } from './FeedWizardModal'

type ValidationStatus = 'ok' | 'warnings' | 'errors' | null

type FeedSummary = {
  id: string
  name: string
  description: string | null
  created_at: string
  updated_at: string
  productCount: number
  lastSynced: string | null
  feedGenerated: string | null
  feedProductCount: number | null
  includedCount: number
  excludedCount: number
  validationStatus: ValidationStatus
  validationErrors: ValidationIssue[] | null
}

type PatchedFeed = { id: string; name: string; description: string | null }

export function FeedListClient() {
  const [feeds, setFeeds] = useState<FeedSummary[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [showCreate, setShowCreate] = useState(false)

  async function load() {
    setError(null)
    try {
      const res = await fetch('/api/feeds')
      const data = (await res.json()) as { feeds?: FeedSummary[]; error?: string }
      if (data.error) throw new Error(data.error)
      setFeeds(data.feeds ?? [])
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unknown error')
    }
  }

  useEffect(() => {
    load()
  }, [])

  function handlePatched(updated: PatchedFeed) {
    setFeeds((prev) =>
      prev
        ? prev.map((f) =>
            f.id === updated.id ? { ...f, name: updated.name, description: updated.description } : f
          )
        : prev
    )
  }

  function handleDeleted(id: string) {
    setFeeds((prev) => (prev ? prev.filter((f) => f.id !== id) : prev))
  }

  return (
    <div className="min-h-screen">
      <header className="ff-topbar">
        <div className="flex items-center gap-3">
          <h1 className="ff-topbar-title">Feeds</h1>
          {feeds && (
            <span style={{ fontSize: '11px', color: 'var(--color-text-tertiary)' }}>
              {feeds.length} feed{feeds.length !== 1 ? 's' : ''}
            </span>
          )}
        </div>
        <button onClick={() => setShowCreate(true)} className="ff-btn-primary">
          Create new feed
        </button>
      </header>

      <main className="px-4 py-4 max-w-6xl">
        {error && (
          <div
            className="ff-panel p-4 mb-3"
            style={{
              background: 'var(--color-badge-danger-bg)',
              borderColor: 'var(--color-badge-danger-text)',
            }}
          >
            <p style={{ fontSize: '12px', color: 'var(--color-badge-danger-text)' }}>{error}</p>
          </div>
        )}

        {feeds === null ? (
          <div
            className="ff-panel py-16 text-center"
            style={{ fontSize: '12px', color: 'var(--color-text-tertiary)' }}
          >
            Loading feeds…
          </div>
        ) : feeds.length === 0 ? (
          <div className="ff-panel py-16 flex flex-col items-center gap-3">
            <p style={{ fontSize: '12px', color: 'var(--color-text-tertiary)' }}>
              No feeds yet
            </p>
            <button onClick={() => setShowCreate(true)} className="ff-btn-primary">
              Create your first feed
            </button>
          </div>
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
            {feeds.map((f) => (
              <FeedCard
                key={f.id}
                feed={f}
                onPatched={handlePatched}
                onDeleted={handleDeleted}
              />
            ))}
          </div>
        )}
      </main>

      {showCreate && <FeedWizardModal onClose={() => setShowCreate(false)} />}
    </div>
  )
}

function FeedCard({
  feed,
  onPatched,
  onDeleted,
}: {
  feed: FeedSummary
  onPatched: (updated: PatchedFeed) => void
  onDeleted: (id: string) => void
}) {
  const [openModal, setOpenModal] = useState<'rename' | 'description' | 'delete' | null>(null)

  return (
    <div className="ff-panel">
      <div
        className="ff-panel-header"
        style={{ textTransform: 'none', letterSpacing: 0, fontSize: '12px', alignItems: 'flex-start' }}
      >
        <div className="min-w-0">
          <div className="flex items-center gap-1.5 min-w-0">
            <div
              className="truncate"
              style={{ fontSize: '13px', fontWeight: 500, color: 'var(--color-text-primary)' }}
            >
              {feed.name}
            </div>
            <CopyLinkButton feedId={feed.id} />
          </div>
          {feed.description && (
            <div
              className="truncate mt-0.5"
              style={{ fontSize: '11px', color: 'var(--color-text-tertiary)', textTransform: 'none', letterSpacing: 0 }}
            >
              {feed.description}
            </div>
          )}
        </div>
        <div className="flex items-center gap-2 shrink-0">
          <StatusBadge feed={feed} />
          <CardMenu
            onRename={() => setOpenModal('rename')}
            onEditDescription={() => setOpenModal('description')}
            onDelete={() => setOpenModal('delete')}
          />
        </div>
      </div>

      <div className="px-3.5 py-3 space-y-2">
        <Stat label="Products" value={String(feed.productCount)} />
        <Stat label="Included products" value={String(feed.includedCount)} />
        <Stat label="Excluded products" value={String(feed.excludedCount)} />
        <Stat
          label="Products synced"
          value={
            feed.lastSynced
              ? new Date(feed.lastSynced).toLocaleString('en-US', {
                  day: '2-digit',
                  month: '2-digit',
                  year: 'numeric',
                  hour: '2-digit',
                  minute: '2-digit',
                })
              : '—'
          }
        />
        <Stat
          label="Feed updated"
          value={
            feed.feedGenerated
              ? `${new Date(feed.feedGenerated).toLocaleDateString('en-US')} · ${feed.feedProductCount ?? 0} items`
              : '—'
          }
        />
      </div>

      <div
        className="px-3.5 py-2.5 flex items-center gap-2"
        style={{ borderTop: '1px solid var(--color-border-tertiary)' }}
      >
        <Link href={`/feed/${feed.id}`} className="ff-btn-primary">
          Edit
        </Link>
      </div>

      {openModal === 'rename' && (
        <RenameModal
          feed={feed}
          onClose={() => setOpenModal(null)}
          onSaved={(updated) => {
            onPatched(updated)
            setOpenModal(null)
          }}
        />
      )}
      {openModal === 'description' && (
        <EditDescriptionModal
          feed={feed}
          onClose={() => setOpenModal(null)}
          onSaved={(updated) => {
            onPatched(updated)
            setOpenModal(null)
          }}
        />
      )}
      {openModal === 'delete' && (
        <DeleteFeedModal
          feed={feed}
          onClose={() => setOpenModal(null)}
          onDeleted={() => {
            onDeleted(feed.id)
            setOpenModal(null)
          }}
        />
      )}
    </div>
  )
}

function StatusBadge({ feed }: { feed: FeedSummary }) {
  const issues = feed.validationErrors ?? []
  const errorCount = issues.filter((i) => i.type === 'error').length
  const warningCount = issues.filter((i) => i.type === 'warning').length

  let className = 'ff-badge ff-badge-success'
  let label = 'Ready'

  if (!feed.feedGenerated) {
    className = 'ff-badge ff-badge-neutral'
    label = 'Not generated'
  } else if (feed.validationStatus === 'errors') {
    className = 'ff-badge ff-badge-danger'
    label = errorCount > 0 ? `${errorCount} ${errorCount === 1 ? 'error' : 'errors'}` : 'Errors'
  } else if (feed.validationStatus === 'warnings') {
    className = 'ff-badge ff-badge-warning'
    label =
      warningCount > 0
        ? `${warningCount} ${warningCount === 1 ? 'warning' : 'warnings'}`
        : 'Warnings'
  }

  return (
    <Link
      href={`/feed/${feed.id}`}
      className={className}
      style={{ textDecoration: 'none', cursor: 'pointer' }}
      title="View validation details"
    >
      {label}
    </Link>
  )
}

function CardMenu({
  onRename,
  onEditDescription,
  onDelete,
}: {
  onRename: () => void
  onEditDescription: () => void
  onDelete: () => void
}) {
  const [open, setOpen] = useState(false)
  const containerRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open) return
    function handle(e: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setOpen(false)
      }
    }
    function handleKey(e: KeyboardEvent) {
      if (e.key === 'Escape') setOpen(false)
    }
    document.addEventListener('mousedown', handle)
    document.addEventListener('keydown', handleKey)
    return () => {
      document.removeEventListener('mousedown', handle)
      document.removeEventListener('keydown', handleKey)
    }
  }, [open])

  return (
    <div ref={containerRef} style={{ position: 'relative' }}>
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        title="Settings"
        aria-label="Settings"
        aria-haspopup="menu"
        aria-expanded={open}
        className="shrink-0"
        style={{
          display: 'inline-flex',
          alignItems: 'center',
          justifyContent: 'center',
          width: '22px',
          height: '22px',
          borderRadius: '4px',
          background: open ? 'var(--color-background-secondary)' : 'transparent',
          color: 'var(--color-text-tertiary)',
          border: '1px solid var(--color-border-tertiary)',
          cursor: 'pointer',
          transition: 'background 0.12s ease',
        }}
      >
        <svg width="12" height="12" viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg">
          <path
            d="M8 5.5a2.5 2.5 0 1 0 0 5 2.5 2.5 0 0 0 0-5Z"
            stroke="currentColor"
            strokeWidth="1.3"
          />
          <path
            d="M13.3 9.4 14.5 10l-1 1.7-1.4-.4a4.7 4.7 0 0 1-1 .6l-.3 1.4H9l-.3-1.4a4.7 4.7 0 0 1-1-.6l-1.4.4-1-1.7 1.2-.6a4.6 4.6 0 0 1 0-1.2L4.3 7.4l1-1.7L6.7 6c.3-.2.6-.4 1-.6L8 4h1.8l.3 1.4c.3.2.7.3 1 .6l1.4-.4 1 1.7-1.2.6a4.6 4.6 0 0 1 0 1.2Z"
            stroke="currentColor"
            strokeWidth="1.1"
            strokeLinejoin="round"
          />
        </svg>
      </button>

      {open && (
        <div
          role="menu"
          className="ff-panel"
          style={{
            position: 'absolute',
            top: 'calc(100% + 4px)',
            right: 0,
            zIndex: 20,
            minWidth: '170px',
            padding: '4px',
            boxShadow: '0 4px 12px rgba(0,0,0,0.08)',
          }}
        >
          <MenuItem onClick={() => { setOpen(false); onRename() }}>Rename feed</MenuItem>
          <MenuItem onClick={() => { setOpen(false); onEditDescription() }}>Edit description</MenuItem>
          <MenuItem
            onClick={() => { setOpen(false); onDelete() }}
            danger
          >
            Delete feed
          </MenuItem>
        </div>
      )}
    </div>
  )
}

function MenuItem({
  onClick,
  danger,
  children,
}: {
  onClick: () => void
  danger?: boolean
  children: React.ReactNode
}) {
  return (
    <button
      type="button"
      role="menuitem"
      onClick={onClick}
      style={{
        display: 'block',
        width: '100%',
        textAlign: 'left',
        padding: '6px 10px',
        fontSize: '12px',
        background: 'transparent',
        border: 'none',
        borderRadius: '4px',
        color: danger ? 'var(--color-badge-danger-text)' : 'var(--color-text-primary)',
        cursor: 'pointer',
      }}
      onMouseEnter={(e) => {
        e.currentTarget.style.background = 'var(--color-background-secondary)'
      }}
      onMouseLeave={(e) => {
        e.currentTarget.style.background = 'transparent'
      }}
    >
      {children}
    </button>
  )
}

function CopyLinkButton({ feedId }: { feedId: string }) {
  const [copied, setCopied] = useState(false)

  async function copy(e: React.MouseEvent) {
    e.preventDefault()
    e.stopPropagation()
    const url = `${window.location.origin}/api/feed/generate/${feedId}`
    try {
      await navigator.clipboard.writeText(url)
      setCopied(true)
      setTimeout(() => setCopied(false), 1500)
    } catch {
      // clipboard blocked — silently no-op
    }
  }

  return (
    <button
      type="button"
      onClick={copy}
      title="Copy feed URL"
      aria-label="Copy feed URL"
      className="shrink-0"
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        justifyContent: 'center',
        width: '22px',
        height: '22px',
        borderRadius: '4px',
        background: copied ? 'var(--color-badge-success-bg)' : 'transparent',
        color: copied ? 'var(--color-badge-success-text)' : 'var(--color-text-tertiary)',
        border: '1px solid var(--color-border-tertiary)',
        cursor: 'pointer',
        transition: 'background 0.12s ease, color 0.12s ease',
      }}
    >
      {copied ? (
        <svg width="11" height="11" viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg">
          <path d="M3 8.5l3.5 3.5L13 5" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      ) : (
        <svg width="11" height="11" viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg">
          <rect x="5" y="5" width="9" height="9" rx="1.5" stroke="currentColor" strokeWidth="1.4" />
          <path d="M11 5V3.5A1.5 1.5 0 0 0 9.5 2h-6A1.5 1.5 0 0 0 2 3.5v6A1.5 1.5 0 0 0 3.5 11H5" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
        </svg>
      )}
    </button>
  )
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between gap-2">
      <span className="ff-label">{label}</span>
      <span style={{ fontSize: '11px', color: 'var(--color-text-primary)' }}>{value}</span>
    </div>
  )
}

// ── Modals ────────────────────────────────────────────────────────────────

function ModalShell({
  title,
  onClose,
  children,
}: {
  title: string
  onClose: () => void
  children: React.ReactNode
}) {
  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center pt-20 px-4" onClick={onClose}>
      <div className="absolute inset-0" style={{ background: 'rgba(0,0,0,0.3)' }} />
      <div className="relative ff-panel w-full max-w-md" onClick={(e) => e.stopPropagation()}>
        <div className="ff-panel-header" style={{ textTransform: 'none', letterSpacing: 0, fontSize: '12px' }}>
          <span style={{ fontSize: '13px', fontWeight: 500, color: 'var(--color-text-primary)' }}>
            {title}
          </span>
        </div>
        {children}
      </div>
    </div>
  )
}

async function patchFeed(
  feedId: string,
  body: { name?: string; description?: string }
): Promise<PatchedFeed> {
  const res = await fetch(`/api/feeds/${feedId}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
  const data = (await res.json()) as { feed?: PatchedFeed; error?: string }
  if (!res.ok || data.error || !data.feed) {
    throw new Error(data.error ?? `HTTP ${res.status}`)
  }
  return data.feed
}

function RenameModal({
  feed,
  onClose,
  onSaved,
}: {
  feed: FeedSummary
  onClose: () => void
  onSaved: (updated: PatchedFeed) => void
}) {
  const [name, setName] = useState(feed.name)
  const [submitting, setSubmitting] = useState(false)
  const [err, setErr] = useState<string | null>(null)

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    const trimmed = name.trim()
    if (!trimmed) return
    setSubmitting(true)
    setErr(null)
    try {
      const updated = await patchFeed(feed.id, { name: trimmed })
      onSaved(updated)
    } catch (e2) {
      setErr(e2 instanceof Error ? e2.message : 'Could not save')
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <ModalShell title="Rename feed" onClose={onClose}>
      <form onSubmit={submit}>
        <div className="p-3.5 space-y-3">
          <div>
            <label className="ff-label block mb-1.5">Name</label>
            <input
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              autoFocus
              className="ff-input"
              required
            />
          </div>
          {err && (
            <p style={{ fontSize: '11px', color: 'var(--color-badge-danger-text)' }}>{err}</p>
          )}
        </div>
        <div
          className="px-3.5 py-3 flex items-center justify-end gap-2"
          style={{ borderTop: '1px solid var(--color-border-tertiary)' }}
        >
          <button type="button" onClick={onClose} className="ff-btn-secondary">
            Cancel
          </button>
          <button
            type="submit"
            disabled={submitting || !name.trim() || name.trim() === feed.name}
            className="ff-btn-primary"
          >
            {submitting ? 'Saving…' : 'Save'}
          </button>
        </div>
      </form>
    </ModalShell>
  )
}

function EditDescriptionModal({
  feed,
  onClose,
  onSaved,
}: {
  feed: FeedSummary
  onClose: () => void
  onSaved: (updated: PatchedFeed) => void
}) {
  const [description, setDescription] = useState(feed.description ?? '')
  const [submitting, setSubmitting] = useState(false)
  const [err, setErr] = useState<string | null>(null)

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    setSubmitting(true)
    setErr(null)
    try {
      const updated = await patchFeed(feed.id, { description })
      onSaved(updated)
    } catch (e2) {
      setErr(e2 instanceof Error ? e2.message : 'Could not save')
    } finally {
      setSubmitting(false)
    }
  }

  const original = feed.description ?? ''
  const dirty = description.trim() !== original.trim()

  return (
    <ModalShell title="Edit description" onClose={onClose}>
      <form onSubmit={submit}>
        <div className="p-3.5 space-y-3">
          <div>
            <label className="ff-label block mb-1.5">Description</label>
            <textarea
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="Short description"
              rows={3}
              autoFocus
              className="ff-input"
              style={{ resize: 'none' }}
            />
          </div>
          {err && (
            <p style={{ fontSize: '11px', color: 'var(--color-badge-danger-text)' }}>{err}</p>
          )}
        </div>
        <div
          className="px-3.5 py-3 flex items-center justify-end gap-2"
          style={{ borderTop: '1px solid var(--color-border-tertiary)' }}
        >
          <button type="button" onClick={onClose} className="ff-btn-secondary">
            Cancel
          </button>
          <button type="submit" disabled={submitting || !dirty} className="ff-btn-primary">
            {submitting ? 'Saving…' : 'Save'}
          </button>
        </div>
      </form>
    </ModalShell>
  )
}

function DeleteFeedModal({
  feed,
  onClose,
  onDeleted,
}: {
  feed: FeedSummary
  onClose: () => void
  onDeleted: () => void
}) {
  const [submitting, setSubmitting] = useState(false)
  const [err, setErr] = useState<string | null>(null)

  async function submit() {
    setSubmitting(true)
    setErr(null)
    try {
      const res = await fetch(`/api/feeds/${feed.id}`, { method: 'DELETE' })
      if (!res.ok) {
        const j = (await res.json().catch(() => ({}))) as { error?: string }
        throw new Error(j.error ?? `HTTP ${res.status}`)
      }
      onDeleted()
    } catch (e2) {
      setErr(e2 instanceof Error ? e2.message : 'Could not delete feed')
      setSubmitting(false)
    }
  }

  return (
    <ModalShell title="Delete feed" onClose={onClose}>
      <div className="p-3.5 space-y-3">
        <p style={{ fontSize: '12px', color: 'var(--color-text-primary)' }}>
          Are you sure you want to delete <strong>{feed.name}</strong>? This cannot be undone.
        </p>
        {err && (
          <p style={{ fontSize: '11px', color: 'var(--color-badge-danger-text)' }}>{err}</p>
        )}
      </div>
      <div
        className="px-3.5 py-3 flex items-center justify-end gap-2"
        style={{ borderTop: '1px solid var(--color-border-tertiary)' }}
      >
        <button type="button" onClick={onClose} className="ff-btn-secondary" disabled={submitting}>
          Cancel
        </button>
        <button
          type="button"
          onClick={submit}
          disabled={submitting}
          className="ff-btn-primary"
          style={{
            background: 'var(--color-badge-danger-text)',
            borderColor: 'var(--color-badge-danger-text)',
          }}
        >
          {submitting ? 'Deleting…' : 'Delete feed'}
        </button>
      </div>
    </ModalShell>
  )
}

