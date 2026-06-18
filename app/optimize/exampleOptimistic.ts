// Pure state transitions for optimistic approve/delete of workshop examples.
//
// Kept separate from the component (no React, no server imports) so the optimistic
// update AND its rollback can be unit-tested without a browser — see
// scripts/verify-optimistic.ts. Every function is a pure (prev) -> next, applied
// through setExamples((cur) => ...), and rollback is BY ID so concurrent optimistic
// changes to OTHER examples are preserved when one action's save fails late.

export type ExampleStatus = 'approved' | 'rejected' | 'candidate'
export type ExampleLike = { id: string; status: ExampleStatus; position: number | null }

export const MAX_APPROVED = 5

// Smallest free approved slot in [0, max). Mirrors lib/bucketExamples
// nextApprovedPosition so the optimistic position matches what the server assigns.
export function nextFreePosition(used: number[], max = MAX_APPROVED): number | null {
  const taken = new Set(used)
  for (let p = 0; p < max; p++) if (!taken.has(p)) return p
  return null
}

// Optimistically approve an example, at the next free position computed from the
// LATEST list (so rapid approvals don't collide on a slot). No-op if already full.
export function applyApprove<T extends ExampleLike>(examples: T[], id: string): T[] {
  const used = examples.filter((e) => e.status === 'approved').map((e) => e.position ?? 0)
  const pos = nextFreePosition(used)
  if (pos === null) return examples
  return examples.map((e) => (e.id === id ? ({ ...e, status: 'approved', position: pos } as T) : e))
}

// Roll an example back to a captured prior snapshot (status + position), by id.
export function revertStatus<T extends ExampleLike>(
  examples: T[],
  id: string,
  status: ExampleStatus,
  position: number | null
): T[] {
  return examples.map((e) => (e.id === id ? ({ ...e, status, position } as T) : e))
}

// Optimistically remove an example from the list.
export function applyDelete<T extends ExampleLike>(examples: T[], id: string): T[] {
  return examples.filter((e) => e.id !== id)
}

// Roll a delete back: re-insert the removed item near its original index (idempotent
// — does nothing if it's somehow already present).
export function restoreDeleted<T extends ExampleLike>(examples: T[], item: T, atIndex: number): T[] {
  if (examples.some((e) => e.id === item.id)) return examples
  const i = Math.max(0, Math.min(atIndex, examples.length))
  return [...examples.slice(0, i), item, ...examples.slice(i)]
}
