// Headless unit checks for the example-workshop pure logic — no DB, no Anthropic.
// Covers the parts that carry the design: candidate JSON parsing, the
// approve/reject dialog history, the round message structure (user-first,
// alternating), and the approved-slot assignment / MAX_APPROVED ceiling.
//
// Run: npx tsx scripts/verify-bucket-examples.ts

import {
  parseCandidatesArray,
  buildDivergenceBlock,
  buildWorkshopMessages,
  buildWorkshopSystemPrompt,
  nextApprovedPosition,
  pickRoundStrategies,
  productHasEnoughData,
  MAX_APPROVED,
  APPROACHES_PER_ROUND,
  STRATEGIES,
  type BucketExample,
} from '../lib/bucketExamples'
import type { SupabaseProduct } from '../lib/sync'

let passed = 0
let failed = 0
function check(name: string, cond: boolean) {
  if (cond) {
    passed++
    console.log(`  ✓ ${name}`)
  } else {
    failed++
    console.log(`  ✗ ${name}`)
  }
}

function ex(partial: Partial<BucketExample>): BucketExample {
  return {
    id: partial.id ?? 'id',
    bucket_id: 'b',
    product_ref: partial.product_ref ?? 'p',
    generated_title: partial.generated_title ?? 't',
    status: partial.status ?? 'candidate',
    note: partial.note ?? '',
    approach: partial.approach ?? '',
    rationale: partial.rationale ?? '',
    position: partial.position ?? null,
    created_at: partial.created_at ?? '2026-01-01T00:00:00Z',
  }
}

console.log('parseCandidatesArray')
{
  const ok = parseCandidatesArray('[{"product_ref":"1","approach":"concise","rationale":"short","title":"A","source_values":["x"]}]')
  check('parses a plain array', ok?.length === 1 && ok[0].title === 'A' && ok[0].product_ref === '1')
  check('captures approach + rationale', ok?.[0].approach === 'concise' && ok?.[0].rationale === 'short')

  const fenced = parseCandidatesArray('```json\n[{"title":"B"}]\n```')
  check('strips ``` fences', fenced?.length === 1 && fenced[0].title === 'B')
  check('approach/rationale default to empty when absent', fenced?.[0].approach === '' && fenced?.[0].rationale === '')

  const preamble = parseCandidatesArray('Here you go:\n[{"title":"C","source_values":"nope"}]\nDone')
  check('tolerates preamble + coerces bad source_values to []', preamble?.length === 1 && preamble[0].source_values.length === 0)

  check('returns null on garbage', parseCandidatesArray('not json at all') === null)
  check('drops entries without a string title', parseCandidatesArray('[{"title":5},{"title":"D"}]')?.length === 1)

  // A well-formed round = 5 candidates with 5 DISTINCT approach labels.
  const round = parseCandidatesArray(
    JSON.stringify(STRATEGIES.slice(0, 5).map((s, i) => ({ product_ref: String(i), approach: s.id, rationale: 'r', title: `T${i}` })))
  )
  check('parses a 5-candidate round', round?.length === 5)
  check('preserves 5 distinct approach labels', new Set((round ?? []).map((c) => c.approach)).size === 5)
}

console.log('buildDivergenceBlock')
{
  const empty = buildDivergenceBlock([ex({ status: 'candidate' }), ex({ status: 'rejected', generated_title: 'X' })])
  check('no block until something is approved', empty === '')

  const block = buildDivergenceBlock([
    ex({ status: 'approved', generated_title: 'Brand 1990 Rioja', approach: 'spec_heavy', position: 0 }),
    ex({ status: 'approved', generated_title: 'Brand Rioja', approach: 'concise', position: 1 }),
  ])
  check('lists approved titles as covered ground', block.includes('Brand 1990 Rioja') && block.includes('Brand Rioja'))
  check('tells the model to diverge', /DIFFERENT/i.test(block) && /do NOT converge/i.test(block))
  check('names already-covered approaches', block.includes('spec_heavy') && block.includes('concise') && block.includes('avoid repeating'))
  check('carries no GOOD/BAD verdict framing', !block.includes('GOOD') && !block.includes('BAD'))
}

console.log('pickRoundStrategies (assigned, distinct, fresh-first)')
{
  const none = pickRoundStrategies([], 5)
  check('returns exactly N strategies', none.length === 5)
  check('all distinct', new Set(none).size === 5)
  check('all are real taxonomy ids', none.every((id) => STRATEGIES.some((s) => s.id === id)))

  const withCovered = pickRoundStrategies(['search_intent', 'spec_heavy'], 5)
  check('still N distinct', withCovered.length === 5 && new Set(withCovered).size === 5)
  check('puts covered approaches last (fresh-first)', !withCovered.slice(0, STRATEGIES.length - 2).includes('search_intent'))
  check('avoids covered entirely when taxonomy has room', !withCovered.includes('search_intent') && !withCovered.includes('spec_heavy'))
}

console.log('buildWorkshopMessages')
{
  const payloads = [{ product_ref: '1', current_title: 'old', fields: { vendor: 'Acme' } }]

  const firstRound = buildWorkshopMessages([], payloads, ['spec_heavy', 'concise'], 'Danish')
  check('always a single user turn', firstRound.length === 1 && firstRound[0].role === 'user')
  check('asks for exactly N and assigns the strategies', String(firstRound[0].content).includes('Produce exactly 2') && String(firstRound[0].content).includes('spec_heavy, concise'))
  check('first round has no divergence block', !String(firstRound[0].content).includes('covered ground'))

  const later = buildWorkshopMessages([ex({ status: 'approved', generated_title: 'Good', approach: 'concise', position: 0 })], payloads, ['spec_heavy', 'region_first'], 'Danish')
  check('still a single user turn with history', later.length === 1 && later[0].role === 'user')
  check('later round carries the divergence signal', String(later[0].content).includes('covered ground') && String(later[0].content).includes('concise'))
}

console.log('buildWorkshopSystemPrompt')
{
  const sys = buildWorkshopSystemPrompt('Keep it short and punchy', 120, 'Danish')
  check('embeds the curator instructions', sys.includes('Keep it short and punchy'))
  check('embeds the char limit', sys.includes('120'))
  check('embeds the target language', sys.includes('Danish'))
  const noInstr = buildWorkshopSystemPrompt('   ', 150, 'English')
  check('falls back when instructions blank', noInstr.includes('(none provided'))
  check('no wish-list block when no input fields', !sys.includes('Desired information'))

  check('lists the full strategy taxonomy', STRATEGIES.every((s) => sys.includes(s.id)))
  check('requires a different strategy per candidate', sys.includes('DIFFERENT strategy') && sys.includes('DISTINCT across the array'))
  check('output format includes approach + rationale', sys.includes('"approach"') && sys.includes('"rationale"'))
  check('rationale must not justify invented attributes', sys.includes('NEVER justify an attribute that is not in'))

  const withFields = buildWorkshopSystemPrompt('x', 150, 'Danish', ['vendor', 'metafield:custom.region', 'metafield:custom.drue'])
  check('renders the prioritised wish list', withFields.includes('Desired information'))
  check('lists fields in priority order', withFields.includes('1. vendor') && withFields.includes('2. metafield:custom.region') && withFields.includes('3. metafield:custom.drue'))
  check('keeps the include-if-present / never-invent framing', withFields.includes('ONLY if it is present') && withFields.includes('NEVER invent'))
}

console.log('productHasEnoughData (title + ≥1 structured attribute)')
{
  const prod = (p: {
    title?: string
    vendor?: string | null
    product_type?: string | null
    metafields?: { namespace: string; key: string; value: string }[]
  }): SupabaseProduct =>
    ({ shopify_id: 's', title: '', vendor: null, product_type: null, metafields: [], ...p } as unknown as SupabaseProduct)
  const region = [{ namespace: 'custom', key: 'region', value: 'Rioja' }]

  check('title + vendor qualifies even when a wished field is missing', productHasEnoughData(prod({ title: 'Wine', vendor: 'Acme' }), ['metafield:custom.region'], null) === true)
  check('title alone (no core, missing wished field) does NOT qualify', productHasEnoughData(prod({ title: 'Wine' }), ['metafield:custom.region'], null) === false)
  check('title + a filled selected field qualifies (no vendor/type)', productHasEnoughData(prod({ title: 'Wine', metafields: region }), ['metafield:custom.region'], null) === true)
  check('empty title never qualifies', productHasEnoughData(prod({ title: '', vendor: 'Acme' }), [], null) === false)
  check('no fields selected: title + product_type qualifies', productHasEnoughData(prod({ title: 'Wine', product_type: 'Rødvin' }), [], null) === true)
  check('no fields selected: bare title does NOT qualify', productHasEnoughData(prod({ title: 'Wine' }), [], null) === false)
}

console.log('nextApprovedPosition / ceiling')
{
  check('empty → slot 0', nextApprovedPosition([]) === 0)
  check('fills the first gap', nextApprovedPosition([0, 2]) === 1)
  check('appends after a contiguous run', nextApprovedPosition([0, 1, 2]) === 3)
  check('full set → null', nextApprovedPosition([0, 1, 2, 3, 4]) === null)
  check(`MAX_APPROVED is ${MAX_APPROVED}`, MAX_APPROVED === 5)
  check(`APPROACHES_PER_ROUND is 5`, APPROACHES_PER_ROUND === 5)
  check('taxonomy has ≥5 strategies to fill a round', STRATEGIES.length >= 5)
}

console.log(`\n${passed} passed, ${failed} failed`)
process.exit(failed === 0 ? 0 : 1)
