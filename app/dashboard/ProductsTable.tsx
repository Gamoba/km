'use client'

import { useState } from 'react'
import type { ShopifyProduct } from '@/lib/shopify'

const PAGE_SIZE_OPTIONS = [25, 50, 100, 200] as const

function StatusBadge({ status }: { status: string }) {
  const cls: Record<string, string> = {
    active: 'ff-badge ff-badge-success',
    draft: 'ff-badge ff-badge-neutral',
    archived: 'ff-badge ff-badge-danger',
  }
  const labels: Record<string, string> = { active: 'Aktiv', draft: 'Kladde', archived: 'Arkiveret' }
  return (
    <span className={cls[status] ?? 'ff-badge ff-badge-neutral'}>
      {labels[status] ?? status}
    </span>
  )
}

function ProductRow({ product }: { product: ShopifyProduct }) {
  const [open, setOpen] = useState(false)

  return (
    <div className="ff-panel">
      <button
        onClick={() => setOpen((v) => !v)}
        className="w-full flex items-center gap-3 px-3.5 py-2 text-left transition-colors"
        style={{ background: open ? 'var(--color-background-secondary)' : 'transparent' }}
      >
        {product.images[0]?.src ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={product.images[0].src}
            alt={product.images[0].alt ?? product.title}
            className="w-9 h-9 object-cover shrink-0"
            style={{ borderRadius: '4px', border: '1px solid var(--color-border-tertiary)' }}
          />
        ) : (
          <div
            className="w-9 h-9 shrink-0"
            style={{ background: 'var(--color-background-secondary)', borderRadius: '4px' }}
          />
        )}

        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <span style={{ fontSize: '12px', fontWeight: 500, color: 'var(--color-text-primary)' }}>
              {product.title}
            </span>
            <StatusBadge status={product.status} />
          </div>
          <div
            className="mt-0.5"
            style={{ fontSize: '10px', color: 'var(--color-text-tertiary)' }}
          >
            {[product.vendor, product.product_type].filter(Boolean).join(' · ')}
            {' · '}
            <span className="ff-mono">{product.handle}</span>
            {' · '}
            {product.variants.length} variant{product.variants.length !== 1 ? 'er' : ''}
            {' · '}
            {product.metafields.length} metafield{product.metafields.length !== 1 ? 's' : ''}
          </div>
        </div>

        <div
          className="ff-mono shrink-0"
          style={{ fontSize: '11px', color: 'var(--color-text-secondary)' }}
        >
          {product.variants[0]?.price ?? '—'}
        </div>

        <svg
          className={`w-3.5 h-3.5 shrink-0 transition-transform ${open ? 'rotate-180' : ''}`}
          style={{ color: 'var(--color-text-tertiary)' }}
          fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}
        >
          <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
        </svg>
      </button>

      {open && <ExpandedProduct product={product} />}
    </div>
  )
}

// ── Expanded product detail ────────────────────────────────────────────────

function stripAndTruncate(html: string | null | undefined, max: number): string {
  if (!html) return ''
  const stripped = html.replace(/<[^>]*>/g, '').replace(/\s+/g, ' ').trim()
  if (stripped.length <= max) return stripped
  return stripped.slice(0, max) + '...'
}

function formatDate(iso: string | null): string {
  if (!iso) return '—'
  try {
    return new Date(iso).toLocaleString('da-DK', {
      day: '2-digit',
      month: '2-digit',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    })
  } catch {
    return iso
  }
}

function SectionHeader({ children }: { children: React.ReactNode }) {
  return (
    <h4
      className="ff-label"
      style={{
        marginBottom: '6px',
        fontWeight: 600,
        color: 'var(--color-text-primary)',
      }}
    >
      {children}
    </h4>
  )
}

function InfoRow({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex gap-3 items-start">
      <span
        style={{
          fontSize: '11px',
          color: 'var(--color-text-tertiary)',
          width: '110px',
          flexShrink: 0,
        }}
      >
        {label}
      </span>
      <span
        style={{ fontSize: '11px', color: 'var(--color-text-primary)', flex: 1, minWidth: 0 }}
        className="break-words"
      >
        {children}
      </span>
    </div>
  )
}

function ExpandedProduct({ product }: { product: ShopifyProduct }) {
  const description = stripAndTruncate(product.body_html, 200)
  const tags = product.tags
    .split(',')
    .map((t) => t.trim())
    .filter(Boolean)
  const collections = product.collections ?? []

  return (
    <div
      className="px-3.5 py-3 space-y-4"
      style={{ borderTop: '1px solid var(--color-border-tertiary)' }}
    >
      {/* Produkt info */}
      <section>
        <SectionHeader>Produkt info</SectionHeader>
        <div className="space-y-1.5">
          <InfoRow label="Title">{product.title || '—'}</InfoRow>
          <InfoRow label="Description">{description || '—'}</InfoRow>
          <InfoRow label="Vendor">{product.vendor || '—'}</InfoRow>
          <InfoRow label="Product type">{product.product_type || '—'}</InfoRow>
          <InfoRow label="Status">
            <StatusBadge status={product.status} />
          </InfoRow>
          <InfoRow label="Collections">
            {collections.length === 0 ? (
              '—'
            ) : (
              <span className="inline-flex flex-wrap gap-1">
                {collections.map((c) => (
                  <span key={c} className="ff-badge ff-badge-neutral">
                    {c}
                  </span>
                ))}
              </span>
            )}
          </InfoRow>
          <InfoRow label="Tags">
            {tags.length === 0 ? (
              '—'
            ) : (
              <span className="inline-flex flex-wrap gap-1">
                {tags.map((t) => (
                  <span key={t} className="ff-badge ff-badge-neutral">
                    {t}
                  </span>
                ))}
              </span>
            )}
          </InfoRow>
          <InfoRow label="Handle">
            <span className="ff-mono">{product.handle || '—'}</span>
          </InfoRow>
          <InfoRow label="Published at">{formatDate(product.published_at)}</InfoRow>
        </div>
      </section>

      {/* Varianter */}
      {product.variants.length > 0 && (
        <section>
          <SectionHeader>Varianter ({product.variants.length})</SectionHeader>
          <table className="ff-table">
            <thead>
              <tr>
                <th>Titel</th>
                <th>Pris</th>
                <th>Compare at</th>
                <th>SKU</th>
                <th>Barcode</th>
                <th>Lager</th>
                <th>Vægt</th>
              </tr>
            </thead>
            <tbody>
              {product.variants.map((v) => (
                <tr key={v.id}>
                  <td>{v.title || '—'}</td>
                  <td className="ff-mono">
                    {v.price ? `${v.price}${v.currency ? ` ${v.currency}` : ''}` : '—'}
                  </td>
                  <td className="ff-mono">{v.compare_at_price ?? '—'}</td>
                  <td className="ff-mono">{v.sku || '—'}</td>
                  <td className="ff-mono">{v.barcode || '—'}</td>
                  <td>{v.inventory_quantity ?? '—'}</td>
                  <td>
                    {v.weight ? `${v.weight}${v.weight_unit ? ` ${v.weight_unit}` : ''}` : '—'}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
      )}

      {/* Metafields */}
      <section>
        <SectionHeader>Metafields ({product.metafields.length})</SectionHeader>
        {product.metafields.length === 0 ? (
          <span style={{ fontSize: '11px', color: 'var(--color-text-tertiary)' }}>
            Ingen metafields
          </span>
        ) : (
          <table className="ff-table">
            <thead>
              <tr>
                <th style={{ width: '34%' }}>Namespace · Key</th>
                <th style={{ width: '90px' }}>Type</th>
                <th>Værdi</th>
              </tr>
            </thead>
            <tbody>
              {product.metafields.map((mf) => (
                <tr key={`${mf.namespace}.${mf.key}`}>
                  <td
                    className="ff-mono"
                    style={{ color: 'var(--color-accent)', whiteSpace: 'nowrap' }}
                  >
                    {mf.namespace}.{mf.key}
                  </td>
                  <td
                    className="ff-mono"
                    style={{ color: 'var(--color-text-tertiary)', whiteSpace: 'nowrap' }}
                  >
                    {mf.type}
                  </td>
                  <td className="break-all">{mf.value}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>
    </div>
  )
}

function PaginationBar({
  page,
  pageSize,
  totalPages,
  onPageChange,
  onPageSizeChange,
  disabled,
}: {
  page: number
  pageSize: number
  totalPages: number
  onPageChange: (p: number) => void
  onPageSizeChange: (n: number) => void
  disabled: boolean
}) {
  const canPrev = page > 1 && !disabled
  const canNext = page < totalPages && !disabled

  return (
    <div
      className="flex items-center justify-between gap-3 mt-3 px-3.5 py-2.5"
      style={{
        border: '1px solid var(--color-border-tertiary)',
        borderRadius: '4px',
        background: 'var(--color-background-tertiary)',
      }}
    >
      <div className="flex items-center gap-2">
        <select
          value={pageSize}
          onChange={(e) => onPageSizeChange(parseInt(e.target.value, 10))}
          disabled={disabled}
          className="ff-select"
          style={{ width: '72px', flex: 'none' }}
        >
          {PAGE_SIZE_OPTIONS.map((n) => (
            <option key={n} value={n}>
              {n}
            </option>
          ))}
        </select>
        <span style={{ fontSize: '11px', color: 'var(--color-text-tertiary)' }}>per side</span>
      </div>

      <div className="flex items-center gap-2">
        <button
          type="button"
          onClick={() => onPageChange(page - 1)}
          disabled={!canPrev}
          className="ff-btn-secondary"
        >
          Forrige
        </button>
        <button
          type="button"
          onClick={() => onPageChange(page + 1)}
          disabled={!canNext}
          className="ff-btn-secondary"
        >
          Næste
        </button>
      </div>

      <span style={{ fontSize: '11px', color: 'var(--color-text-tertiary)' }}>
        Side {page} af {totalPages}
      </span>
    </div>
  )
}

export function ProductsTable({
  products,
  total,
  page,
  pageSize,
  totalPages,
  search,
  onSearchChange,
  onPageChange,
  onPageSizeChange,
  loading,
}: {
  products: ShopifyProduct[]
  total: number
  page: number
  pageSize: number
  totalPages: number
  search: string
  onSearchChange: (s: string) => void
  onPageChange: (p: number) => void
  onPageSizeChange: (n: number) => void
  loading: boolean
}) {
  return (
    <div>
      <input
        type="search"
        placeholder="Søg titel, leverandør, handle, tags…"
        value={search}
        onChange={(e) => onSearchChange(e.target.value)}
        className="ff-input mb-3"
      />

      <div
        className="space-y-1.5"
        style={{ opacity: loading ? 0.6 : 1, transition: 'opacity 0.15s ease' }}
      >
        {products.map((product) => (
          <ProductRow key={product.id} product={product} />
        ))}
      </div>

      {products.length === 0 && (
        <div
          className="ff-panel py-12 text-center"
          style={{ fontSize: '12px', color: 'var(--color-text-tertiary)' }}
        >
          {search
            ? 'Ingen produkter matcher søgningen.'
            : 'Ingen produkter på denne side.'}
        </div>
      )}

      {total > 0 && (
        <PaginationBar
          page={page}
          pageSize={pageSize}
          totalPages={totalPages}
          onPageChange={onPageChange}
          onPageSizeChange={onPageSizeChange}
          disabled={loading}
        />
      )}
    </div>
  )
}
