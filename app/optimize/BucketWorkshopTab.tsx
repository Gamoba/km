'use client'

// Per-bucket example workshop (migrations 025 + 026 + lib/bucketExamples).
//
// The user writes instructions, picks prioritised input fields, then each round
// generates 5 deliberately DIFFERENT titling approaches (each with an AI rationale).
// Selecting a candidate approves it — a choice means "good", no notes needed. The
// approved set (≤5) is the few-shot. Generation replays the approved examples as
// "covered ground" so new rounds diverge instead of converging. Resumable per bucket.

import { useEffect, useMemo, useRef, useState } from 'react'
import {
  getBucketTitleConfig,
  saveBucketTitleConfig,
  listBucketExamples,
  generateBucketCandidates,
  setBucketExampleStatus,
  deleteBucketExample,
  getFeedMetafields,
} from './actions'
import { FILTER_FIELDS, type MetafieldOption } from '@/app/components/FilterEditor'
import type { BucketExample } from '@/lib/bucketExamples'
import type { ValidationResult } from '@/lib/titleOptimizer'

const MAX_APPROVED = 5

// Standard field tokens for the input-field picker (the metafield sentinel is
// dropped — metafields come from the feed scan instead).
const STANDARD_FIELDS = FILTER_FIELDS.filter((f) => f.value !== '__metafield__')

function TrashIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"
      strokeLinecap="round" strokeLinejoin="round" className="w-3.5 h-3.5">
      <polyline points="3 6 5 6 21 6" />
      <path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
    </svg>
  )
}

// Human label for a field token. Metafields show their namespace.key tail with a
// "(metafield)" hint; standard fields use their friendly label.
function fieldLabel(token: string): string {
  if (token.startsWith('metafield:')) return `${token.slice('metafield:'.length)} (metafield)`
  return STANDARD_FIELDS.find((f) => f.value === token)?.label ?? token
}

function GripIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="currentColor" className="w-3.5 h-3.5" aria-hidden>
      <circle cx="9" cy="6" r="1.4" /><circle cx="15" cy="6" r="1.4" />
      <circle cx="9" cy="12" r="1.4" /><circle cx="15" cy="12" r="1.4" />
      <circle cx="9" cy="18" r="1.4" /><circle cx="15" cy="18" r="1.4" />
    </svg>
  )
}

export function BucketWorkshopTab({ feedId, bucketId }: { feedId: string; bucketId: string }) {
  const [instructions, setInstructions] = useState('')
  const [inputFields, setInputFields] = useState<string[]>([])
  const [metafields, setMetafields] = useState<MetafieldOption[] | undefined>(undefined)
  const [examples, setExamples] = useState<BucketExample[]>([])
  // Validation verdicts from the latest generation (not persisted — id → result).
  const [validationById, setValidationById] = useState<Record<string, ValidationResult>>({})

  const [pickerOpen, setPickerOpen] = useState(false)
  const [dragIndex, setDragIndex] = useState<number | null>(null)
  const pickerRef = useRef<HTMLDivElement | null>(null)
  const [loading, setLoading] = useState(true)
  const [savingConfig, setSavingConfig] = useState(false)
  const [savedConfig, setSavedConfig] = useState(false)
  const [generating, setGenerating] = useState(false)
  const [unusedLeft, setUnusedLeft] = useState<number | null>(null)
  const [error, setError] = useState<string | null>(null)

  // Initial load — config + metafields + examples. setState only in callbacks.
  useEffect(() => {
    let cancelled = false
    Promise.all([
      getBucketTitleConfig(feedId, bucketId),
      getFeedMetafields(feedId),
      listBucketExamples(feedId, bucketId),
    ]).then(([cfg, mf, ex]) => {
      if (cancelled) return
      if ('data' in cfg) {
        setInstructions(cfg.data.instructions)
        setInputFields(cfg.data.input_fields)
      }
      if ('data' in mf) setMetafields(mf.data)
      if ('data' in ex) setExamples(ex.data)
      setLoading(false)
    })
    return () => {
      cancelled = true
    }
  }, [feedId, bucketId])

  // Close the field picker on outside click.
  useEffect(() => {
    if (!pickerOpen) return
    function onDown(e: MouseEvent) {
      if (pickerRef.current && !pickerRef.current.contains(e.target as Node)) setPickerOpen(false)
    }
    document.addEventListener('mousedown', onDown)
    return () => document.removeEventListener('mousedown', onDown)
  }, [pickerOpen])

  const approved = useMemo(
    () => examples.filter((e) => e.status === 'approved').sort((a, b) => (a.position ?? 0) - (b.position ?? 0)),
    [examples]
  )
  const candidates = useMemo(() => examples.filter((e) => e.status === 'candidate'), [examples])
  const rejected = useMemo(() => examples.filter((e) => e.status === 'rejected'), [examples])

  async function refreshExamples() {
    const r = await listBucketExamples(feedId, bucketId)
    if ('data' in r) setExamples(r.data)
  }

  async function persistConfig(): Promise<boolean> {
    const r = await saveBucketTitleConfig(feedId, bucketId, { instructions, input_fields: inputFields })
    if (r.error) {
      setError(r.error)
      return false
    }
    return true
  }

  async function handleSaveConfig() {
    setError(null)
    setSavingConfig(true)
    if (await persistConfig()) {
      setSavedConfig(true)
      setTimeout(() => setSavedConfig(false), 2500)
    }
    setSavingConfig(false)
  }

  // All selectable field tokens (standard + feed metafields), for the checkbox
  // dropdown. Order here is just display order; priority is the inputFields order.
  const allFields = useMemo(
    () => [
      ...STANDARD_FIELDS.map((f) => f.value),
      ...(metafields ?? []).map((m) => `metafield:${m.namespace}.${m.key}`),
    ],
    [metafields]
  )

  function toggleField(token: string) {
    setInputFields((p) => (p.includes(token) ? p.filter((t) => t !== token) : [...p, token]))
    setSavedConfig(false)
  }
  function removeField(token: string) {
    setInputFields((p) => p.filter((t) => t !== token))
    setSavedConfig(false)
  }
  // Reorder the selected (priority) list — moves the dragged item to a new index.
  function moveField(from: number, to: number) {
    if (from === to || from < 0 || to < 0) return
    setInputFields((p) => {
      const next = [...p]
      const [moved] = next.splice(from, 1)
      next.splice(to, 0, moved)
      return next
    })
    setSavedConfig(false)
  }

  async function handleGenerate() {
    setError(null)
    setGenerating(true)
    // Persist the current config first so generation uses the latest instructions
    // and input fields (mirrors the scope tab's save-then-act).
    if (!(await persistConfig())) {
      setGenerating(false)
      return
    }
    const r = await generateBucketCandidates(feedId, bucketId)
    if ('error' in r) {
      setError(r.error)
      setGenerating(false)
      return
    }
    setValidationById((prev) => {
      const next = { ...prev }
      for (const c of r.data.candidates) next[c.id] = c.validation
      return next
    })
    setUnusedLeft(r.data.unusedMembersAfter)
    await refreshExamples()
    setGenerating(false)
  }

  async function approveExample(id: string) {
    setError(null)
    const r = await setBucketExampleStatus(feedId, bucketId, id, 'approved')
    if (r.error) setError(r.error)
    await refreshExamples()
  }
  async function removeExample(id: string) {
    setError(null)
    const r = await deleteBucketExample(feedId, bucketId, id)
    if (r.error) setError(r.error)
    await refreshExamples()
  }

  const approvedFull = approved.length >= MAX_APPROVED

  if (loading) return <p style={{ fontSize: '11px', color: 'var(--color-text-tertiary)' }}>Loading…</p>

  return (
    <div className="space-y-3">
      {error && <div style={{ fontSize: '11px', color: 'var(--color-badge-danger-text)' }}>{error}</div>}

      <p style={{ fontSize: '11px', color: 'var(--color-text-tertiary)' }}>
        Each round proposes 5 deliberately different titling approaches, each with a short explanation.
        Pick the ones you like — selecting a candidate approves it (no notes needed). Keep up to {MAX_APPROVED}.
        New rounds stay broad and avoid approaches you&apos;ve already approved; the bucket run later uses your
        approved examples + instructions + input fields.
      </p>

      {/* Config: instructions + input fields */}
      <div className="ff-panel">
        <div className="ff-panel-header" style={{ textTransform: 'none', letterSpacing: 0, fontSize: '12px', padding: '10px 14px' }}>
          Instructions &amp; input fields
        </div>
        <div className="p-3.5 space-y-3">
          <div>
            <label className="ff-label">Instructions</label>
            <textarea
              value={instructions}
              onChange={(e) => {
                setInstructions(e.target.value)
                setSavedConfig(false)
              }}
              rows={3}
              placeholder="e.g. Brand first. Include vintage if present. Keep it short and searchable."
              className="ff-input w-full"
              style={{ resize: 'vertical' }}
            />
          </div>

          <div>
            <label className="ff-label">Input fields — include if present, in priority order</label>

            {/* Checkbox dropdown: pick/unpick many fields at once. */}
            <div ref={pickerRef} style={{ position: 'relative', maxWidth: '320px' }}>
              <button type="button" onClick={() => setPickerOpen((o) => !o)} className="ff-select w-full text-left">
                {inputFields.length ? `${inputFields.length} field${inputFields.length > 1 ? 's' : ''} selected` : 'Select fields…'}
              </button>
              {pickerOpen && (
                <div
                  className="ff-panel"
                  style={{ position: 'absolute', zIndex: 20, top: 'calc(100% + 4px)', left: 0, right: 0, maxHeight: '240px', overflowY: 'auto', padding: '6px' }}
                >
                  {allFields.map((token) => (
                    <label
                      key={token}
                      className="flex items-center gap-2 px-1.5 py-1 rounded"
                      style={{ fontSize: '11px', color: 'var(--color-text-secondary)', cursor: 'pointer' }}
                    >
                      <input type="checkbox" checked={inputFields.includes(token)} onChange={() => toggleField(token)} />
                      {fieldLabel(token)}
                    </label>
                  ))}
                  {allFields.length === 0 && (
                    <p style={{ fontSize: '11px', color: 'var(--color-text-tertiary)', padding: '4px' }}>No fields available.</p>
                  )}
                </div>
              )}
            </div>

            {/* Ordered priority list — drag to reorder. */}
            <div className="mt-2 space-y-1">
              {inputFields.length === 0 ? (
                <span style={{ fontSize: '11px', color: 'var(--color-text-tertiary)' }}>None — only the current title is used.</span>
              ) : (
                inputFields.map((t, i) => (
                  <div
                    key={t}
                    draggable
                    onDragStart={() => setDragIndex(i)}
                    onDragOver={(e) => e.preventDefault()}
                    onDrop={() => {
                      if (dragIndex !== null) moveField(dragIndex, i)
                      setDragIndex(null)
                    }}
                    onDragEnd={() => setDragIndex(null)}
                    className="flex items-center gap-2"
                    style={{
                      fontSize: '11px',
                      padding: '4px 8px',
                      border: '1px solid var(--color-border-secondary)',
                      borderRadius: '5px',
                      background: dragIndex === i ? 'var(--color-border-tertiary)' : 'transparent',
                      cursor: 'grab',
                    }}
                  >
                    <span style={{ color: 'var(--color-text-tertiary)' }}><GripIcon /></span>
                    <span className="ff-badge ff-badge-neutral shrink-0" style={{ textTransform: 'none', letterSpacing: 0 }}>{i + 1}</span>
                    <span className="flex-1 min-w-0" style={{ color: 'var(--color-text-primary)' }}>{fieldLabel(t)}</span>
                    <button type="button" onClick={() => removeField(t)} className="ff-btn-ghost shrink-0 w-5 h-5" aria-label="Remove field">×</button>
                  </div>
                ))
              )}
            </div>

            <p className="mt-1.5" style={{ fontSize: '10px', color: 'var(--color-text-tertiary)' }}>
              Fields are a wish list: the model includes each only when the product has it, in this priority order, and never invents a missing one.
              A product just needs a title plus one attribute (brand/type or a selected field) to be a candidate.
            </p>
          </div>

          <button onClick={handleSaveConfig} disabled={savingConfig} className="ff-btn-secondary">
            {savingConfig ? 'Saving…' : savedConfig ? 'Saved' : 'Save settings'}
          </button>
        </div>
      </div>

      {/* Approved examples (few-shot) */}
      <div className="ff-panel">
        <div className="ff-panel-header" style={{ textTransform: 'none', letterSpacing: 0, fontSize: '12px', padding: '10px 14px' }}>
          Approved examples — {approved.length}/{MAX_APPROVED}
        </div>
        <div className="p-3.5 space-y-1.5">
          {approved.length === 0 ? (
            <p style={{ fontSize: '11px', color: 'var(--color-text-tertiary)' }}>
              None yet. Generate candidates below and approve the good ones.
            </p>
          ) : (
            approved.map((e) => (
              <div key={e.id} className="flex items-start gap-2" style={{ fontSize: '11px' }}>
                <span className="ff-badge ff-badge-success shrink-0">#{(e.position ?? 0) + 1}</span>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <span style={{ color: 'var(--color-text-primary)' }}>{e.generated_title}</span>
                    {e.approach && (
                      <span className="ff-badge ff-badge-neutral shrink-0" style={{ textTransform: 'none', letterSpacing: 0 }}>{e.approach}</span>
                    )}
                  </div>
                  {e.rationale && <div style={{ color: 'var(--color-text-tertiary)' }}>{e.rationale}</div>}
                </div>
                <button
                  type="button"
                  onClick={() => removeExample(e.id)}
                  className="ff-btn-ghost shrink-0 w-6 h-6"
                  aria-label="Delete example (frees a slot)"
                >
                  <TrashIcon />
                </button>
              </div>
            ))
          )}
        </div>
      </div>

      {/* Generate */}
      <div className="ff-panel">
        <div className="ff-panel-header" style={{ textTransform: 'none', letterSpacing: 0, fontSize: '12px', padding: '10px 14px' }}>
          Generate approaches
        </div>
        <div className="p-3.5 space-y-2">
          <div className="flex items-center gap-2">
            <button onClick={handleGenerate} disabled={generating} className="ff-btn-primary">
              {generating ? 'Generating…' : 'Generate 5 approaches'}
            </button>
            <span style={{ fontSize: '10px', color: 'var(--color-text-tertiary)' }}>
              {approved.length} approved{approved.length ? ' (those approaches are avoided next round)' : ''}
              {unusedLeft !== null ? ` · ${unusedLeft} members left` : ''}
            </span>
          </div>
          <p style={{ fontSize: '10px', color: 'var(--color-text-tertiary)' }}>
            Generating starts a fresh round of 5; any candidates you didn&apos;t pick from the last round are set aside.
          </p>
          {approvedFull && (
            <p style={{ fontSize: '10px', color: 'var(--color-text-tertiary)' }}>
              You have {MAX_APPROVED} approved examples — delete one above to free a slot before approving more.
            </p>
          )}
        </div>
      </div>

      {/* Candidates to curate — this round's 5 approaches. Selecting = approve. */}
      {candidates.length > 0 && (
        <div className="ff-panel">
          <div className="ff-panel-header" style={{ textTransform: 'none', letterSpacing: 0, fontSize: '12px', padding: '10px 14px' }}>
            This round — pick the approaches you like (selecting approves)
          </div>
          <div className="p-3.5 space-y-2.5">
            {candidates.map((e) => {
              const v = validationById[e.id]
              return (
                <label
                  key={e.id}
                  className="flex items-start gap-2"
                  style={{ fontSize: '11px', cursor: approvedFull ? 'not-allowed' : 'pointer' }}
                >
                  <input
                    type="checkbox"
                    checked={false}
                    disabled={approvedFull}
                    onChange={() => approveExample(e.id)}
                    className="mt-0.5"
                    aria-label="Approve this approach"
                    title={approvedFull ? `Max ${MAX_APPROVED} approved` : 'Approve'}
                  />
                  <div className="flex-1 min-w-0 space-y-0.5">
                    <div className="flex items-center gap-2 flex-wrap">
                      {e.approach && (
                        <span className="ff-badge ff-badge-accent shrink-0" style={{ textTransform: 'none', letterSpacing: 0 }}>{e.approach}</span>
                      )}
                      <span style={{ color: 'var(--color-text-primary)' }}>{e.generated_title}</span>
                      {v && !v.ok && (
                        <span className="ff-badge ff-badge-warning" title={v.issues.map((i) => i.detail).join('; ')}>
                          {v.issues.map((i) => i.code).join(', ')}
                        </span>
                      )}
                    </div>
                    {e.rationale && <div style={{ color: 'var(--color-text-tertiary)' }}>{e.rationale}</div>}
                  </div>
                </label>
              )
            })}
          </div>
        </div>
      )}

      {/* Earlier candidates the curator didn't pick — kept as "not these" context. */}
      {rejected.length > 0 && (
        <details className="ff-panel">
          <summary
            className="ff-panel-header"
            style={{ textTransform: 'none', letterSpacing: 0, fontSize: '12px', padding: '10px 14px', cursor: 'pointer' }}
          >
            Not chosen — {rejected.length} from earlier rounds
          </summary>
          <div className="p-3.5 space-y-1.5">
            {rejected.map((e) => (
              <div key={e.id} className="flex items-center gap-2" style={{ fontSize: '11px' }}>
                {e.approach && (
                  <span className="ff-badge ff-badge-neutral shrink-0" style={{ textTransform: 'none', letterSpacing: 0 }}>{e.approach}</span>
                )}
                <span className="flex-1 min-w-0" style={{ color: 'var(--color-text-secondary)', textDecoration: 'line-through' }}>{e.generated_title}</span>
                <button
                  type="button"
                  onClick={() => removeExample(e.id)}
                  className="ff-btn-ghost shrink-0 w-6 h-6"
                  aria-label="Delete from history"
                >
                  <TrashIcon />
                </button>
              </div>
            ))}
          </div>
        </details>
      )}
    </div>
  )
}
