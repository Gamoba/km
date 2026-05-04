'use client'

import { useEffect, useState, useTransition } from 'react'
import type { ShopifyProduct } from '@/lib/shopify'
import { saveFilters } from './actions'
import type { FilterRule, FilterConfig } from './actions'

// ── Static data ────────────────────────────────────────────────────────────

const FILTER_FIELDS = [
  { value: 'title', label: 'Title' },
  { value: 'vendor', label: 'Vendor' },
  { value: 'product_type', label: 'Product type' },
  { value: 'tags', label: 'Tags' },
  { value: 'status', label: 'Status' },
  { value: 'handle', label: 'Handle' },
  { value: 'variants[0].price', label: 'Price' },
  { value: 'variants[0].sku', label: 'SKU' },
  { value: 'variants[0].inventory_quantity', label: 'Inventory' },
  { value: 'variants[0].barcode', label: 'Barcode' },
  { value: '__metafield__', label: 'Metafield…' },
]

const OPERATORS = [
  { value: 'contains', label: 'contains' },
  { value: 'does_not_contain', label: 'does not contain' },
  { value: 'equals', label: 'equals' },
  { value: 'not_equals', label: 'does not equal' },
  { value: 'starts_with', label: 'starts with' },
  { value: 'ends_with', label: 'ends with' },
  { value: 'is_empty', label: 'is empty' },
  { value: 'is_not_empty', label: 'is not empty' },
  { value: 'greater_than', label: '> greater than' },
  { value: 'less_than', label: '< less than' },
]

const NO_VALUE_OPS = new Set(['is_empty', 'is_not_empty'])

// ── Filter evaluation ──────────────────────────────────────────────────────

function resolveProductField(field: string, product: ShopifyProduct): string {
  if (field.startsWith('metafield:')) {
    const rest = field.slice('metafield:'.length)
    const dot = rest.indexOf('.')
    if (dot === -1) return ''
    const ns = rest.slice(0, dot)
    const key = rest.slice(dot + 1)
    return product.metafields.find((m) => m.namespace === ns && m.key === key)?.value ?? ''
  }
  const vm = field.match(/^variants\[(\d+)\]\.(.+)$/)
  if (vm) {
    const variants = product.variants as unknown as Record<string, unknown>[] | null | undefined
    const val = variants?.[+vm[1]]?.[vm[2]]
    return String(val ?? '')
  }
  const im = field.match(/^images\[(\d+)\]\.(.+)$/)
  if (im) {
    const images = product.images as unknown as Record<string, unknown>[] | null | undefined
    const val = images?.[+im[1]]?.[im[2]]
    return String(val ?? '')
  }
  const val = (product as Record<string, unknown>)[field]
  if (val == null) return ''
  if (typeof val === 'object') return JSON.stringify(val)
  return String(val)
}

function evalRule(rule: FilterRule, product: ShopifyProduct): boolean {
  if (rule.field === 'collections') {
    const cols = (product.collections as string[] | null | undefined) ?? []
    switch (rule.operator) {
      case 'contains':
      case 'equals': return cols.includes(rule.value)
      case 'does_not_contain':
      case 'not_equals': return !cols.includes(rule.value)
      case 'is_empty': return cols.length === 0
      case 'is_not_empty': return cols.length > 0
      default: return true
    }
  }
  const v = resolveProductField(rule.field, product)
  switch (rule.operator) {
    case 'contains': return v.includes(rule.value)
    case 'does_not_contain': return !v.includes(rule.value)
    case 'equals': return v === rule.value
    case 'not_equals': return v !== rule.value
    case 'starts_with': return v.startsWith(rule.value)
    case 'ends_with': return v.endsWith(rule.value)
    case 'is_empty': return !v
    case 'is_not_empty': return !!v
    case 'greater_than': return parseFloat(v) > parseFloat(rule.value)
    case 'less_than': return parseFloat(v) < parseFloat(rule.value)
    default: return true
  }
}

function matchesConfig(product: ShopifyProduct, rules: FilterRule[], operator: 'AND' | 'OR'): boolean {
  const activeRules = rules.filter((r) => r.value !== '' || r.operator === 'is_empty' || r.operator === 'is_not_empty')
  if (activeRules.length === 0) return true

  const results = activeRules.map((rule) => {
    const fieldValue = String((product as Record<string, unknown>)[rule.field] ?? '').toLowerCase()
    const ruleValue = rule.value.toLowerCase()

    switch (rule.operator) {
      case 'contains': return fieldValue.includes(ruleValue)
      case 'does_not_contain': return !fieldValue.includes(ruleValue)
      case 'equals': return fieldValue === ruleValue
      case 'not_equals': return fieldValue !== ruleValue
      case 'starts_with': return fieldValue.startsWith(ruleValue)
      case 'ends_with': return fieldValue.endsWith(ruleValue)
      case 'is_empty': return !fieldValue
      case 'is_not_empty': return !!fieldValue
      case 'greater_than': return parseFloat(fieldValue) > parseFloat(ruleValue)
      case 'less_than': return parseFloat(fieldValue) < parseFloat(ruleValue)
      default: return true
    }
  })

  return operator === 'AND' ? results.every(Boolean) : results.some(Boolean)
}

// ── Helpers ────────────────────────────────────────────────────────────────

function defaultRule(): FilterRule {
  return { field: 'title', operator: 'contains', value: '' }
}

function defaultConfig(): FilterConfig {
  return { operator: 'AND', rules: [] }
}

function PlusIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"
      strokeLinecap="round" strokeLinejoin="round" className="w-4 h-4">
      <line x1="12" y1="5" x2="12" y2="19" />
      <line x1="5" y1="12" x2="19" y2="12" />
    </svg>
  )
}

function XIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"
      strokeLinecap="round" strokeLinejoin="round" className="w-3.5 h-3.5">
      <line x1="18" y1="6" x2="6" y2="18" />
      <line x1="6" y1="6" x2="18" y2="18" />
    </svg>
  )
}

// ── RuleRow ────────────────────────────────────────────────────────────────

function RuleRow({
  rule,
  onChange,
  onDelete,
}: {
  rule: FilterRule
  onChange: (patch: Partial<FilterRule>) => void
  onDelete: () => void
}) {
  const isMetafield = rule.field.startsWith('metafield:')
  const metafieldKey = isMetafield ? rule.field.slice('metafield:'.length) : ''
  const dropdownValue = isMetafield ? '__metafield__' : rule.field
  const needsValue = !NO_VALUE_OPS.has(rule.operator)

  function handleFieldSelect(val: string) {
    if (val === '__metafield__') {
      onChange({ field: 'metafield:' })
    } else {
      onChange({ field: val })
    }
  }

  const selectCls = 'ff-select'

  return (
    <div className="flex items-center gap-2 flex-wrap">
      <select
        value={dropdownValue}
        onChange={(e) => handleFieldSelect(e.target.value)}
        className={`${selectCls} w-44 shrink-0`}
      >
        {FILTER_FIELDS.map((f) => (
          <option key={f.value} value={f.value}>{f.label}</option>
        ))}
      </select>

      {isMetafield && (
        <input
          type="text"
          value={metafieldKey}
          onChange={(e) => onChange({ field: `metafield:${e.target.value}` })}
          placeholder="namespace.key"
          className={`${selectCls} w-36 shrink-0`}
        />
      )}

      <select
        value={rule.operator}
        onChange={(e) => onChange({ operator: e.target.value })}
        className={`${selectCls} w-44 shrink-0`}
      >
        {OPERATORS.map((op) => (
          <option key={op.value} value={op.value}>{op.label}</option>
        ))}
      </select>

      {needsValue ? (
        <input
          type="text"
          value={rule.value}
          onChange={(e) => onChange({ value: e.target.value })}
          placeholder="Value…"
          className={`${selectCls} flex-1 min-w-24`}
        />
      ) : (
        <div className="flex-1" />
      )}

      <button
        type="button"
        onClick={onDelete}
        className="ff-btn-ghost shrink-0 w-6 h-6"
        aria-label="Delete rule"
      >
        <XIcon />
      </button>
    </div>
  )
}

// ── FilterSection ──────────────────────────────────────────────────────────

function FilterSection({
  title,
  description,
  badge,
  badgeCls,
  config,
  onAddRule,
  onRemoveRule,
  onUpdateRule,
  onSetOperator,
}: {
  title: string
  description: string
  badge: string
  badgeCls: string
  config: FilterConfig
  onAddRule: () => void
  onRemoveRule: (i: number) => void
  onUpdateRule: (i: number, patch: Partial<FilterRule>) => void
  onSetOperator: (op: 'AND' | 'OR') => void
}) {
  return (
    <div className="ff-panel">
      <div
        className="ff-panel-header"
        style={{ textTransform: 'none', letterSpacing: 0, fontSize: '11px', alignItems: 'flex-start', padding: '10px 14px' }}
      >
        <div className="flex items-start gap-2.5">
          <span className={`mt-0.5 shrink-0 ${badgeCls}`}>
            {badge}
          </span>
          <div>
            <h2 style={{ fontSize: '12px', fontWeight: 500, color: 'var(--color-text-primary)' }}>{title}</h2>
            <p className="mt-0.5" style={{ fontSize: '10px', color: 'var(--color-text-tertiary)', textTransform: 'none', letterSpacing: 0 }}>{description}</p>
          </div>
        </div>
      </div>

      <div className="p-3.5">
        {config.rules.length === 0 ? (
          <p className="text-center py-3" style={{ fontSize: '11px', color: 'var(--color-text-tertiary)' }}>
            No rules — click + to add one
          </p>
        ) : (
          <div className="space-y-1">
            {config.rules.map((rule, i) => (
              <div key={i}>
                {i > 0 && (
                  <div className="flex items-center gap-2 my-2">
                    <div className="flex-1 h-px" style={{ background: 'var(--color-border-tertiary)' }} />
                    <div
                      className="inline-flex overflow-hidden"
                      style={{ border: '1px solid var(--color-border-secondary)', borderRadius: '4px' }}
                    >
                      {(['AND', 'OR'] as const).map((op, j) => (
                        <button
                          key={op}
                          onClick={() => onSetOperator(op)}
                          style={{
                            padding: '3px 9px',
                            fontSize: '10px',
                            fontWeight: 600,
                            letterSpacing: '0.4px',
                            borderLeft: j > 0 ? '1px solid var(--color-border-secondary)' : 'none',
                            background: config.operator === op ? '#6c5ce7' : 'transparent',
                            color: config.operator === op ? '#ffffff' : 'var(--color-text-tertiary)',
                          }}
                        >
                          {op}
                        </button>
                      ))}
                    </div>
                    <div className="flex-1 h-px" style={{ background: 'var(--color-border-tertiary)' }} />
                  </div>
                )}
                <RuleRow
                  rule={rule}
                  onChange={(p) => onUpdateRule(i, p)}
                  onDelete={() => onRemoveRule(i)}
                />
              </div>
            ))}
          </div>
        )}

        <button
          onClick={onAddRule}
          className="mt-3 flex items-center gap-1.5 transition-colors"
          style={{ fontSize: '11px', fontWeight: 500, color: 'var(--color-accent)' }}
        >
          <PlusIcon />
          Add rule
        </button>
      </div>
    </div>
  )
}

// ── FiltersClient ──────────────────────────────────────────────────────────

export function FiltersClient({
  feedId,
  feedName,
  initialInclude,
  initialExclude,
}: {
  feedId: string
  feedName: string
  initialInclude: { operator: 'AND' | 'OR'; rules: FilterRule[] } | null
  initialExclude: { operator: 'AND' | 'OR'; rules: FilterRule[] } | null
}) {
  const [include, setInclude] = useState<FilterConfig>(initialInclude ?? defaultConfig())
  const [exclude, setExclude] = useState<FilterConfig>(initialExclude ?? defaultConfig())
  const [products, setProducts] = useState<ShopifyProduct[] | null>(null)
  const [isPending, startTransition] = useTransition()
  const [saveError, setSaveError] = useState<string | null>(null)
  const [saveSuccess, setSaveSuccess] = useState(false)

  useEffect(() => {
    fetch(`/api/products?feedId=${encodeURIComponent(feedId)}`)
      .then((r) => r.json())
      .then((d) => {
        const ps = (d as { products?: ShopifyProduct[] }).products ?? []
        setProducts(ps)
      })
      .catch(() => setProducts([]))
  }, [feedId])

  const hasActiveExclude = exclude.rules.some(
    (r) => NO_VALUE_OPS.has(r.operator) || r.value !== ''
  )

  const matchCount = !products
    ? null
    : products.filter((p) => {
        const inc = include.rules.length === 0 || matchesConfig(p, include.rules, include.operator)
        const exc = hasActiveExclude && matchesConfig(p, exclude.rules, exclude.operator)
        return inc && !exc
      }).length

  function addRule(type: 'include' | 'exclude') {
    const setter = type === 'include' ? setInclude : setExclude
    setter((prev) => ({ ...prev, rules: [...prev.rules, defaultRule()] }))
  }

  function removeRule(type: 'include' | 'exclude', idx: number) {
    const setter = type === 'include' ? setInclude : setExclude
    setter((prev) => ({ ...prev, rules: prev.rules.filter((_, i) => i !== idx) }))
  }

  function updateRule(type: 'include' | 'exclude', idx: number, patch: Partial<FilterRule>) {
    const setter = type === 'include' ? setInclude : setExclude
    setter((prev) => ({
      ...prev,
      rules: prev.rules.map((r, i) => (i === idx ? { ...r, ...patch } : r)),
    }))
  }

  function setOperator(type: 'include' | 'exclude', op: 'AND' | 'OR') {
    const setter = type === 'include' ? setInclude : setExclude
    setter((prev) => ({ ...prev, operator: op }))
  }

  function handleSave() {
    setSaveError(null)
    setSaveSuccess(false)
    startTransition(async () => {
      const result = await saveFilters(feedId, include, exclude)
      if (result.error) {
        setSaveError(result.error)
      } else {
        setSaveSuccess(true)
        setTimeout(() => setSaveSuccess(false), 3000)
      }
    })
  }

  const totalCount = products?.length ?? null

  return (
    <div className="min-h-screen">
      <header className="ff-topbar">
        <div className="flex items-center gap-3">
          <h1 className="ff-topbar-title">{feedName} · Filters</h1>
          <span style={{ fontSize: '11px', color: 'var(--color-text-tertiary)' }}>
            {matchCount !== null && totalCount !== null
              ? `${matchCount} of ${totalCount} products in feed`
              : 'Loading…'}
          </span>
        </div>
        <div className="flex items-center gap-2">
          {saveError && (
            <span style={{ fontSize: '11px', color: 'var(--color-badge-danger-text)' }}>{saveError}</span>
          )}
          <button onClick={handleSave} disabled={isPending} className="ff-btn-primary">
            {isPending ? 'Saving…' : saveSuccess ? 'Saved' : 'Save rules'}
          </button>
        </div>
      </header>

      <main className="px-4 py-4 max-w-4xl space-y-3">
        <FilterSection
          title="Include products"
          description="Only products matching these rules are included. No rules = all products included."
          badge="INCLUDE"
          badgeCls="ff-badge ff-badge-success"
          config={include}
          onAddRule={() => addRule('include')}
          onRemoveRule={(i) => removeRule('include', i)}
          onUpdateRule={(i, p) => updateRule('include', i, p)}
          onSetOperator={(op) => setOperator('include', op)}
        />
        <FilterSection
          title="Exclude products"
          description="Products matching these rules are removed from the feed, even if they match the include rules."
          badge="EXCLUDE"
          badgeCls="ff-badge ff-badge-danger"
          config={exclude}
          onAddRule={() => addRule('exclude')}
          onRemoveRule={(i) => removeRule('exclude', i)}
          onUpdateRule={(i, p) => updateRule('exclude', i, p)}
          onSetOperator={(op) => setOperator('exclude', op)}
        />
      </main>
    </div>
  )
}
