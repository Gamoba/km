'use client'

import type { ValidationResult, ValidationIssue } from '@/lib/feedValidator'

// ── Icons ──────────────────────────────────────────────────────────────────

function IconCheck() {
  return (
    <svg className="w-4 h-4 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
    </svg>
  )
}

function IconWarning() {
  return (
    <svg className="w-4 h-4 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v2m0 4h.01M10.29 3.86L1.82 18a2 2 0 001.71 3h16.94a2 2 0 001.71-3L13.71 3.86a2 2 0 00-3.42 0z" />
    </svg>
  )
}

function IconError() {
  return (
    <svg className="w-4 h-4 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
      <circle cx="12" cy="12" r="10" />
      <line x1="15" y1="9" x2="9" y2="15" />
      <line x1="9" y1="9" x2="15" y2="15" />
    </svg>
  )
}

// ── Sub-components ─────────────────────────────────────────────────────────

function StatusBanner({ result }: { result: ValidationResult }) {
  const errorCount = result.issues.filter((i) => i.type === 'error').length
  const warnCount = result.issues.filter((i) => i.type === 'warning').length
  const subtitle =
    result.productsChecked > 0
      ? `${result.productsChecked} produkter tjekket`
      : 'Sidste gemte validering — kør igen for opdateret resultat'

  if (result.status === 'ok') {
    return (
      <div
        className="flex items-center gap-2.5 p-3"
        style={{
          background: 'var(--color-badge-success-bg)',
          border: '1px solid var(--color-badge-success-text)',
          borderRadius: '4px',
          color: 'var(--color-badge-success-text)',
        }}
      >
        <IconCheck />
        <div>
          <p style={{ fontSize: '12px', fontWeight: 500 }}>Feed er klar til Google Merchant Center</p>
          <p className="mt-0.5" style={{ fontSize: '11px', opacity: 0.85 }}>
            {result.productsChecked > 0
              ? `${result.productsChecked} produkter tjekket — ingen problemer fundet`
              : subtitle}
          </p>
        </div>
      </div>
    )
  }

  if (result.status === 'warnings') {
    return (
      <div
        className="flex items-center gap-2.5 p-3"
        style={{
          background: 'var(--color-badge-warning-bg)',
          border: '1px solid var(--color-badge-warning-text)',
          borderRadius: '4px',
          color: 'var(--color-badge-warning-text)',
        }}
      >
        <IconWarning />
        <div>
          <p style={{ fontSize: '12px', fontWeight: 500 }}>
            {warnCount} advarsel{warnCount !== 1 ? 'er' : ''} — feedet virker men kan forbedres
          </p>
          <p className="mt-0.5" style={{ fontSize: '11px', opacity: 0.85 }}>
            {subtitle}
          </p>
        </div>
      </div>
    )
  }

  return (
    <div
      className="flex items-center gap-2.5 p-3"
      style={{
        background: 'var(--color-badge-danger-bg)',
        border: '1px solid var(--color-badge-danger-text)',
        borderRadius: '4px',
        color: 'var(--color-badge-danger-text)',
      }}
    >
      <IconError />
      <div>
        <p style={{ fontSize: '12px', fontWeight: 500 }}>
          {errorCount} fejl — feedet vil blive afvist af Google
          {warnCount > 0 && ` · ${warnCount} advarsel${warnCount !== 1 ? 'er' : ''}`}
        </p>
        <p className="mt-0.5" style={{ fontSize: '11px', opacity: 0.85 }}>
          {subtitle}
        </p>
      </div>
    </div>
  )
}

function IssueRow({ issue }: { issue: ValidationIssue }) {
  const isError = issue.type === 'error'
  return (
    <div
      className="flex items-start gap-2.5 py-2.5"
      style={{ borderBottom: '1px solid var(--color-border-tertiary)' }}
    >
      <div
        className="mt-0.5 shrink-0"
        style={{ color: isError ? 'var(--color-badge-danger-text)' : 'var(--color-badge-warning-text)' }}
      >
        {isError ? <IconError /> : <IconWarning />}
      </div>
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2 flex-wrap">
          <code
            className="ff-mono px-1.5 py-0.5"
            style={{
              fontSize: '10px',
              background: 'var(--color-background-secondary)',
              borderRadius: '3px',
              color: 'var(--color-text-primary)',
            }}
          >
            {issue.field}
          </code>
          <span className={`ff-badge ${isError ? 'ff-badge-danger' : 'ff-badge-warning'}`}>
            {isError ? 'Fejl' : 'Advarsel'}
          </span>
        </div>
        <p className="mt-1" style={{ fontSize: '12px', color: 'var(--color-text-primary)' }}>{issue.message}</p>
        {issue.exampleValue !== undefined && (
          <div
            className="mt-1.5 ff-mono px-2 py-1"
            style={{
              fontSize: '11px',
              background: 'var(--color-background-secondary)',
              borderRadius: '3px',
              color: 'var(--color-text-secondary)',
              wordBreak: 'break-all',
            }}
          >
            <span style={{ color: 'var(--color-text-tertiary)' }}>Eksempel: </span>
            {issue.exampleValue === '' ? <em style={{ fontStyle: 'italic' }}>(tom)</em> : issue.exampleValue}
          </div>
        )}
      </div>
      {issue.affectedCount > 0 && (
        <div className="shrink-0 text-right">
          <span className="ff-badge ff-badge-neutral">
            {issue.affectedCount} produkt{issue.affectedCount !== 1 ? 'er' : ''}
          </span>
        </div>
      )}
    </div>
  )
}

// ── Main component ─────────────────────────────────────────────────────────

// Controlled component — `result`, `isRunning`, `runError` and `onRun` are
// owned by the parent so they can be shared with the compact ValidationMini
// summary on the feed dashboard.
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
    <div className="ff-panel">
      <div className="ff-panel-header">
        <span>Feed validering</span>
        <button onClick={onRun} disabled={isRunning} className="ff-btn-primary">
          {isRunning ? (
            <>
              <svg className="w-3 h-3 animate-spin" fill="none" viewBox="0 0 24 24">
                <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8H4z" />
              </svg>
              Validerer…
            </>
          ) : (
            'Kør validering'
          )}
        </button>
      </div>

      <div className="p-3.5 space-y-3">
        {runError && (
          <div
            className="p-2.5"
            style={{
              background: 'var(--color-badge-danger-bg)',
              border: '1px solid var(--color-badge-danger-text)',
              borderRadius: '4px',
            }}
          >
            <p style={{ fontSize: '12px', color: 'var(--color-badge-danger-text)' }}>{runError}</p>
          </div>
        )}

        {!result && !isRunning && (
          <p
            className="text-center py-4"
            style={{ fontSize: '11px', color: 'var(--color-text-tertiary)' }}
          >
            Klik &quot;Kør validering&quot; for at tjekke dit feed mod Google krav
          </p>
        )}

        {isRunning && (
          <p
            className="text-center py-4"
            style={{ fontSize: '11px', color: 'var(--color-text-tertiary)' }}
          >
            Henter og validerer de første 20 produkter…
          </p>
        )}

        {result && !isRunning && (
          <>
            <StatusBanner result={result} />

            {result.issues.length > 0 && (
              <div className="space-y-3">
                {errors.length > 0 && (
                  <div>
                    <p className="ff-label mb-2">Fejl ({errors.length})</p>
                    <div
                      className="px-3"
                      style={{ border: '1px solid var(--color-border-tertiary)', borderRadius: '4px' }}
                    >
                      {errors.map((issue, i) => (
                        <IssueRow key={i} issue={issue} />
                      ))}
                    </div>
                  </div>
                )}

                {warnings.length > 0 && (
                  <div>
                    <p className="ff-label mb-2">Advarsler ({warnings.length})</p>
                    <div
                      className="px-3"
                      style={{ border: '1px solid var(--color-border-tertiary)', borderRadius: '4px' }}
                    >
                      {warnings.map((issue, i) => (
                        <IssueRow key={i} issue={issue} />
                      ))}
                    </div>
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
