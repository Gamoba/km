'use client'

import type { ValidationResult, ValidationIssue } from '@/lib/feedValidator'

// ── Sub-components ─────────────────────────────────────────────────────────

// Calm status line — a small coloured dot does the colour work, not a filled
// banner. (Design system: colour as small accents.)
function StatusBanner({ result }: { result: ValidationResult }) {
  const errorCount = result.issues.filter((i) => i.type === 'error').length
  const warnCount = result.issues.filter((i) => i.type === 'warning').length
  const checked =
    result.productsChecked > 0
      ? `${result.productsChecked} products checked`
      : 'Last saved validation — run again for an updated result'

  let dot = 'var(--accent-green)'
  let title = 'Feed is ready for Google Merchant Center'
  let subtitle = result.productsChecked > 0 ? `${result.productsChecked} products checked — no issues found` : checked

  if (result.status === 'warnings') {
    dot = 'var(--accent-amber)'
    title = `${warnCount} ${warnCount === 1 ? 'warning' : 'warnings'} — feed works but can be improved`
    subtitle = checked
  } else if (result.status === 'errors') {
    dot = 'var(--accent-red)'
    title =
      `${errorCount} ${errorCount === 1 ? 'error' : 'errors'} — feed will be rejected by Google` +
      (warnCount > 0 ? ` · ${warnCount} ${warnCount === 1 ? 'warning' : 'warnings'}` : '')
    subtitle = checked
  }

  return (
    <div className="flex items-start gap-2.5">
      <span className="wl-dot" style={{ background: dot, marginTop: '6px' }} />
      <div>
        <p style={{ fontSize: '13px', fontWeight: 500, color: 'var(--ink)' }}>{title}</p>
        <p className="mt-0.5" style={{ fontSize: '12px', color: 'var(--ink-muted)' }}>{subtitle}</p>
      </div>
    </div>
  )
}

function IssueRow({ issue }: { issue: ValidationIssue }) {
  const isError = issue.type === 'error'
  return (
    <div className="flex items-start gap-3" style={{ padding: '12px 0', borderBottom: '1px solid var(--hairline)' }}>
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2 flex-wrap">
          <span
            style={{
              fontSize: '11px',
              fontWeight: 500,
              padding: '1px 8px',
              borderRadius: '999px',
              border: '1px solid var(--hairline)',
              background: '#ffffff',
              color: isError ? 'var(--accent-red)' : 'var(--accent-amber)',
            }}
          >
            {isError ? 'Error' : 'Warning'}
          </span>
          <code
            className="ff-mono"
            style={{
              fontSize: '11px',
              padding: '1px 7px',
              background: 'var(--bg-surface)',
              borderRadius: '6px',
              color: 'var(--ink-secondary)',
            }}
          >
            {issue.field}
          </code>
        </div>
        <p className="mt-1.5" style={{ fontSize: '13px', color: 'var(--ink)' }}>{issue.message}</p>
        {issue.exampleValue !== undefined && (
          <div
            className="mt-1.5 ff-mono"
            style={{
              fontSize: '11px',
              padding: '6px 9px',
              background: 'var(--bg-surface)',
              borderRadius: '8px',
              color: 'var(--ink-secondary)',
              wordBreak: 'break-word',
            }}
          >
            <span style={{ color: 'var(--ink-muted)' }}>Example: </span>
            {issue.exampleValue === '' ? <em style={{ fontStyle: 'italic' }}>(empty)</em> : issue.exampleValue}
          </div>
        )}
      </div>
      {issue.affectedCount > 0 && (
        <span className="shrink-0" style={{ fontSize: '11px', color: 'var(--ink-muted)' }}>
          {issue.affectedCount} {issue.affectedCount === 1 ? 'product' : 'products'}
        </span>
      )}
    </div>
  )
}

// ── Main component ─────────────────────────────────────────────────────────

// Controlled component — `result`, `isRunning`, `runError` and `onRun` are
// owned by the parent so the feed overview stays in sync.
export function FeedValidation({
  result,
  isRunning,
  onRun,
  runError,
}: {
  result: ValidationResult | null
  isRunning: boolean
  onRun: () => void
  runError: string | null
}) {
  const errors = result?.issues.filter((i) => i.type === 'error') ?? []
  const warnings = result?.issues.filter((i) => i.type === 'warning') ?? []

  return (
    <div className="wl-card">
      <div
        className="flex items-center justify-between"
        style={{ padding: '14px 18px', borderBottom: '1px solid var(--hairline)' }}
      >
        <span style={{ fontSize: '15px', fontWeight: 500, color: 'var(--ink)' }}>Validation</span>
        <button onClick={onRun} disabled={isRunning} className="wl-btn-primary">
          {isRunning ? (
            <>
              <svg className="w-3 h-3 animate-spin" fill="none" viewBox="0 0 24 24">
                <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8H4z" />
              </svg>
              Validating…
            </>
          ) : (
            'Run validation'
          )}
        </button>
      </div>

      <div className="p-4 space-y-3.5">
        {runError && (
          <div
            className="flex items-start gap-2.5"
            style={{ padding: '10px 12px', border: '1px solid var(--hairline)', borderRadius: '10px' }}
          >
            <span className="wl-dot" style={{ background: 'var(--accent-red)', marginTop: '5px' }} />
            <p style={{ fontSize: '12px', color: 'var(--ink-secondary)' }}>{runError}</p>
          </div>
        )}

        {!result && !isRunning && (
          <p className="text-center py-5" style={{ fontSize: '13px', color: 'var(--ink-muted)' }}>
            Run validation to check your feed against Google&apos;s requirements.
          </p>
        )}

        {isRunning && (
          <p className="text-center py-5" style={{ fontSize: '13px', color: 'var(--ink-muted)' }}>
            Fetching and validating the first 20 products…
          </p>
        )}

        {result && !isRunning && (
          <>
            <StatusBanner result={result} />

            {result.issues.length > 0 && (
              <div className="space-y-4">
                {errors.length > 0 && (
                  <div>
                    <p className="wl-eyebrow" style={{ marginBottom: '2px' }}>Errors ({errors.length})</p>
                    {errors.map((issue, i) => (
                      <IssueRow key={i} issue={issue} />
                    ))}
                  </div>
                )}

                {warnings.length > 0 && (
                  <div>
                    <p className="wl-eyebrow" style={{ marginBottom: '2px' }}>Warnings ({warnings.length})</p>
                    {warnings.map((issue, i) => (
                      <IssueRow key={i} issue={issue} />
                    ))}
                  </div>
                )}
              </div>
            )}
          </>
        )}
      </div>
    </div>
  )
}
