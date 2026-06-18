// Verifies the optimistic approve/delete + ROLLBACK logic for workshop examples,
// using the exact pure transitions the component applies (app/optimize/
// exampleOptimistic). Simulates failed saves and rapid/concurrent actions, and
// asserts the UI state ends up identical to what's actually saved.
//
//   npx tsx scripts/verify-optimistic.ts

import {
  applyApprove,
  applyDelete,
  restoreDeleted,
  revertStatus,
  type ExampleLike,
} from '../app/optimize/exampleOptimistic'

type Ex = ExampleLike & { label: string }

let failures = 0
function check(name: string, cond: boolean, detail?: string) {
  console.log(`${cond ? '✓ PASS' : '✗ FAIL'}  ${name}${cond ? '' : `   — ${detail ?? ''}`}`)
  if (!cond) failures++
}
const eq = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b)
const byId = (s: Ex[], id: string) => s.find((e) => e.id === id)

// Mirrors the component's approveExample: optimistic, then rollback-by-id on a
// failed save. Returns the resulting state + whether an error was shown.
function approve(state: Ex[], id: string, saveFails: boolean): { state: Ex[]; error: boolean } {
  const prev = state.find((e) => e.id === id)
  if (!prev || prev.status === 'approved') return { state, error: false }
  let s = applyApprove(state, id) // optimistic
  if (saveFails) {
    s = revertStatus(s, id, prev.status, prev.position) // rollback this item
    return { state: s, error: true }
  }
  return { state: s, error: false }
}

// Mirrors removeExample.
function remove(state: Ex[], id: string, saveFails: boolean): { state: Ex[]; error: boolean } {
  const prev = state.find((e) => e.id === id)
  if (!prev) return { state, error: false }
  const prevIndex = state.findIndex((e) => e.id === id)
  let s = applyDelete(state, id) // optimistic
  if (saveFails) {
    s = restoreDeleted(s, prev, prevIndex) // rollback
    return { state: s, error: true }
  }
  return { state: s, error: false }
}

const base = (): Ex[] => [
  { id: 'A', status: 'candidate', position: null, label: 'A' },
  { id: 'B', status: 'candidate', position: null, label: 'B' },
  { id: 'C', status: 'approved', position: 0, label: 'C' },
]

// 1. Approve — happy path.
{
  const r = approve(base(), 'A', false)
  check('approve success → A approved', byId(r.state, 'A')?.status === 'approved' && !r.error)
}

// 2. Approve — FAILED save rolls A back to its exact prior snapshot, error shown.
{
  const before = base()
  const r = approve(before, 'A', true)
  check('approve fail → A reverted to candidate/null', eq(byId(r.state, 'A'), byId(before, 'A')))
  check('approve fail → whole state identical to before', eq(r.state, before))
  check('approve fail → error surfaced', r.error)
}

// 3. Delete — happy path.
{
  const r = remove(base(), 'B', false)
  check('delete success → B gone', !byId(r.state, 'B') && !r.error)
}

// 4. Delete — FAILED save restores B at its original index, error shown.
{
  const before = base()
  const r = remove(before, 'B', true)
  check('delete fail → B restored', !!byId(r.state, 'B'))
  check('delete fail → state identical to before (incl. order)', eq(r.state, before))
  check('delete fail → error surfaced', r.error)
}

// 5. RAPID approvals, distinct positions (no collision) — both optimistic before saves.
{
  let s = applyApprove(base(), 'A')
  s = applyApprove(s, 'B')
  const pa = byId(s as Ex[], 'A')?.position
  const pb = byId(s as Ex[], 'B')?.position
  check('rapid approve A,B → distinct positions, neither 0 (C holds 0)', pa !== pb && pa !== 0 && pb !== 0, `A=${pa} B=${pb}`)
}

// 6. RAPID: approve A (SUCCESS) + approve B (FAIL) → only B reverts, A stays approved.
{
  const before = base()
  let s = applyApprove(before, 'A') // optimistic A
  const prevB = byId(s as Ex[], 'B')!
  s = applyApprove(s, 'B') // optimistic B
  // saves resolve: A ok, B fails → roll back only B.
  s = revertStatus(s, 'B', prevB.status, prevB.position)
  check('rapid A-ok/B-fail → A approved', byId(s as Ex[], 'A')?.status === 'approved')
  check('rapid A-ok/B-fail → B reverted to candidate', byId(s as Ex[], 'B')?.status === 'candidate')
}

// 7. CONCURRENT different actions: approve A (FAIL) + delete B (SUCCESS).
//    Late A-failure must revert A only, leaving B's successful delete intact.
{
  const before = base()
  const prevA = byId(before, 'A')!
  let s = applyApprove(before, 'A') // optimistic approve A
  s = applyDelete(s, 'B') // optimistic delete B (succeeds, no rollback)
  s = revertStatus(s, 'A', prevA.status, prevA.position) // A's save fails late → revert A by id
  check('concurrent A-fail/B-ok → A reverted to candidate', byId(s as Ex[], 'A')?.status === 'candidate')
  check('concurrent A-fail/B-ok → B still deleted', !byId(s as Ex[], 'B'))
}

// 8. Position assignment fills the smallest free slot and caps at MAX_APPROVED.
{
  // Approve into a list where slots 0 and 2 are taken → next should be 1.
  const s: Ex[] = [
    { id: 'x', status: 'approved', position: 0, label: 'x' },
    { id: 'y', status: 'approved', position: 2, label: 'y' },
    { id: 'z', status: 'candidate', position: null, label: 'z' },
  ]
  const r = applyApprove(s, 'z')
  check('approve fills smallest free slot (→1)', byId(r as Ex[], 'z')?.position === 1)

  // Full (5 approved) → optimistic approve is a no-op (gating also prevents it).
  const full: Ex[] = [0, 1, 2, 3, 4].map((p) => ({ id: `f${p}`, status: 'approved', position: p, label: `f${p}` }))
  full.push({ id: 'extra', status: 'candidate', position: null, label: 'extra' })
  const rf = applyApprove(full, 'extra')
  check('approve when full → no-op (extra stays candidate)', byId(rf as Ex[], 'extra')?.status === 'candidate')
}

console.log(`\n${failures === 0 ? 'ALL PASS' : `${failures} FAILURE(S)`}`)
process.exit(failures === 0 ? 0 : 1)
