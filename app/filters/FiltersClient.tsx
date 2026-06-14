'use client'

import { useEffect, useState, useTransition } from 'react'
import type { ShopifyProduct } from '@/lib/shopify'
import { saveFilters } from './actions'
import type { FilterRule, FilterConfig } from './actions'
import { FilterSection, defaultRule, defaultConfig } from '@/app/components/FilterEditor'

const NO_VALUE_OPS = new Set(['is_empty', 'is_not_empty'])

// ── Filter evaluation (client-side match count) ─────────────────────────────

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
