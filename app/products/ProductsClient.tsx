'use client'

import { useEffect, useState } from 'react'
import type { ShopifyProduct } from '@/lib/shopify'
import type { SyncResult } from '@/lib/sync'
import { ProductsTable } from '../dashboard/ProductsTable'

type Phase = 'loading' | 'empty' | 'syncing' | 'ready' | 'error'

export type PaginatedProducts = {
  products: ShopifyProduct[]
  total: number
  page: number
  pageSize: number
  totalPages: number
}

const DEFAULT_PAGE_SIZE = 25

export function ProductsClient({
  feedId,
  feedName,
}: {
  feedId: string
  feedName: string
  userEmail: string
}) {
  const [phase, setPhase] = useState<Phase>('loading')
  const [data, setData] = useState<PaginatedProducts | null>(null)
  const [syncResult, setSyncResult] = useState<SyncResult | null>(null)
  const [error, setError] = useState<string | null>(null)

  // Paging + search state. Page resets to 1 whenever the search query or
  // page size changes (handled below).
  const [page, setPage] = useState(1)
  const [pageSize, setPageSize] = useState<number>(DEFAULT_PAGE_SIZE)
  const [searchInput, setSearchInput] = useState('')
  const [searchQuery, setSearchQuery] = useState('')
  const [paginating, setPaginating] = useState(false)

  // Debounce search input → committed search query (300ms).
  useEffect(() => {
    const t = setTimeout(() => setSearchQuery(searchInput), 300)
    return () => clearTimeout(t)
  }, [searchInput])

  // Reset to page 1 whenever the active search or page size changes, so the
  // user doesn't end up on an out-of-range page after narrowing the result.
  useEffect(() => {
    setPage(1)
  }, [searchQuery, pageSize])

  async function loadFromSupabase(opts: { initial?: boolean } = {}) {
    if (opts.initial) {
      setPhase('loading')
    } else {
      setPaginating(true)
    }
    setError(null)
    try {
      const params = new URLSearchParams({
        feedId,
        page: String(page),
        pageSize: String(pageSize),
      })
      if (searchQuery) params.set('search', searchQuery)
      const res = await fetch(`/api/products?${params.toString()}`)
      if (!res.ok) {
        const json = await res.json().catch(() => ({}))
        throw new Error((json as { error?: string }).error ?? `HTTP ${res.status}`)
      }
      const json = (await res.json()) as PaginatedProducts
      setData(json)
      // 'empty' UI is for the very first load only when the DB has 0 products
      // (no search applied). A search that filters everything away should keep
      // the table chrome visible so the user can clear / change the query.
      if (opts.initial && json.total === 0 && !searchQuery) {
        setPhase('empty')
      } else {
        setPhase('ready')
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unknown error')
      setPhase('error')
    } finally {
      setPaginating(false)
    }
  }

  async function runSync() {
    setPhase('syncing')
    setSyncResult(null)
    setError(null)
    try {
      const res = await fetch(`/api/shopify/sync?feedId=${encodeURIComponent(feedId)}`, {
        method: 'POST',
      })
      if (!res.ok) {
        const json = await res.json().catch(() => ({}))
        throw new Error((json as { error?: string }).error ?? `HTTP ${res.status}`)
      }
      const result: SyncResult = await res.json()
      setSyncResult(result)
      setPage(1)
      await loadFromSupabase({ initial: true })
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unknown error')
      setPhase('error')
    }
  }

  // Initial load.
  useEffect(() => {
    loadFromSupabase({ initial: true })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // Refetch whenever paging or committed search changes (after the first load).
  useEffect(() => {
    if (phase === 'loading' || phase === 'syncing' || phase === 'empty') return
    loadFromSupabase()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [page, pageSize, searchQuery])

  return (
    <div className="min-h-screen">
      <header className="ff-topbar">
        <div className="flex items-center gap-3">
          <h1 className="ff-topbar-title">{feedName} · Products</h1>
          {phase === 'ready' && data && (
            <span style={{ fontSize: '11px', color: 'var(--color-text-tertiary)' }}>
              {data.products.length} of {data.total} products
              {syncResult && ` · synced in ${(syncResult.durationMs / 1000).toFixed(1)}s`}
            </span>
          )}
          {phase === 'loading' && (
            <span style={{ fontSize: '11px', color: 'var(--color-text-tertiary)' }}>Loading…</span>
          )}
          {phase === 'syncing' && (
            <span style={{ fontSize: '11px', color: 'var(--color-text-tertiary)' }}>Syncing…</span>
          )}
        </div>
        <div className="flex items-center gap-2">
          {(phase === 'ready' || phase === 'empty') && (
            <button onClick={runSync} className="ff-btn-primary">
              Sync again
            </button>
          )}
        </div>
      </header>

      <main className="px-4 py-4 max-w-6xl">
        {phase === 'error' && (
          <div
            className="ff-panel p-4"
            style={{
              borderColor: 'var(--color-badge-danger-text)',
              background: 'var(--color-badge-danger-bg)',
            }}
          >
            <p style={{ fontSize: '12px', fontWeight: 500, color: 'var(--color-badge-danger-text)' }}>
              Error
            </p>
            <p
              className="mt-1 mb-3"
              style={{ fontSize: '11px', color: 'var(--color-badge-danger-text)' }}
            >
              {error}
            </p>
            <button onClick={() => loadFromSupabase({ initial: true })} className="ff-btn-secondary">
              Try again
            </button>
          </div>
        )}

        {(phase === 'loading' || phase === 'syncing') && (
          <div className="ff-panel py-16 flex flex-col items-center gap-2.5">
            <div
              className="w-6 h-6 rounded-full animate-spin"
              style={{
                border: '2px solid var(--color-accent)',
                borderTopColor: 'transparent',
              }}
            />
            <p style={{ fontSize: '11px', color: 'var(--color-text-tertiary)' }}>
              {phase === 'syncing' ? 'Fetching from Shopify and saving…' : 'Loading products…'}
            </p>
          </div>
        )}

        {phase === 'empty' && (
          <div className="ff-panel py-16 flex flex-col items-center gap-3">
            <p style={{ fontSize: '12px', color: 'var(--color-text-tertiary)' }}>
              No products yet
            </p>
            <button onClick={runSync} className="ff-btn-primary">
              Sync products
            </button>
          </div>
        )}

        {phase === 'ready' && data && (
          <ProductsTable
            products={data.products}
            total={data.total}
            page={data.page}
            pageSize={data.pageSize}
            totalPages={data.totalPages}
            search={searchInput}
            onSearchChange={setSearchInput}
            onPageChange={setPage}
            onPageSizeChange={setPageSize}
            loading={paginating}
          />
        )}
      </main>
    </div>
  )
}
