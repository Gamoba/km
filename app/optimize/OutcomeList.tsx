'use client'

import type { OptimizationOutcome } from '@/lib/titleOptimizer'

// Shared list of optimization outcomes (proposed title, original, OK/REVIEW +
// validation issues). Used by per-bucket preview and run.
export function OutcomeList({ title, outcomes }: { title: string; outcomes: OptimizationOutcome[] }) {
  if (outcomes.length === 0) return null
  return (
    <div className="ff-panel">
      <div
        className="ff-panel-header"
        style={{ textTransform: 'none', letterSpacing: 0, fontSize: '12px', padding: '10px 14px' }}
      >
        {title} ({outcomes.length})
      </div>
      <div className="divide-y" style={{ borderColor: 'var(--color-border-tertiary)' }}>
        {outcomes.map((o) => {
          const ok = o.validation.ok
          return (
            <div key={o.product_ref} className="px-3.5 py-2.5">
              <div className="flex items-start gap-2">
                <span className={`mt-0.5 shrink-0 ff-badge ${ok ? 'ff-badge-success' : 'ff-badge-warning'}`}>
                  {ok ? 'OK' : 'REVIEW'}
                </span>
                <div className="min-w-0 flex-1">
                  <div style={{ fontSize: '12px', color: 'var(--color-text-primary)', fontWeight: 500 }}>
                    {o.proposed_title ?? '(no output)'}
                  </div>
                  <div className="mt-0.5 truncate" style={{ fontSize: '10px', color: 'var(--color-text-tertiary)' }}>
                    was: {o.original_title}
                  </div>
                  {!ok && o.validation.issues.length > 0 && (
                    <div className="mt-1" style={{ fontSize: '10px', color: 'var(--color-badge-warning-text)' }}>
                      {o.validation.issues.map((i, idx) => (
                        <div key={idx}>• {i.detail}</div>
                      ))}
                    </div>
                  )}
                </div>
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )
}
