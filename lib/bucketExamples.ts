// Per-bucket example workshop (migration 025).
//
// Few-shot examples moved from per-feed (title_optimization_settings.few_shot_examples)
// to per-BUCKET. A bucket owns:
//   - bucket_title_config: free-text instructions + chosen input-field tokens.
//   - bucket_examples: every candidate ever generated, status approved | rejected
//     | candidate. The approved rows (up to 5, fewer fine) are the few-shot; the
//     rest are dialog history that conditions the next generation round.
//
// The workshop is RESUMABLE — all state lives in those two tables, so the user
// can leave and pick up where they left off. Generation builds an Anthropic
// message history (prior candidates + the user's approve/reject verdict + notes)
// so the model learns the pattern across rounds: "these were good, these weren't
// — make more like the good ones."
//
// Model/temperature mirror lib/titleOptimizer (haiku-4-5 / 0.3): temperature 0.3
// is required and only available on temperature-supporting models, and Haiku is
// the tier already used for the per-product run. This module is the headless
// service; ownership (getOwnedFeed/requireOwnedBucket) is enforced at the action
// layer, and feed_id is carried on every row/query as a scoping belt.

import Anthropic from '@anthropic-ai/sdk'
import { adminDb } from '@/lib/feeds'
import type { SupabaseProduct } from '@/lib/sync'
import { resolveField } from '@/lib/feedFilters'
import { getBucketMembership } from '@/lib/optimizationBuckets'
import {
  createOptimizerClient,
  toOptimizerProduct,
  validateResult,
  localeToLanguage,
  DEFAULT_CHAR_LIMIT,
  type ValidationResult,
} from '@/lib/titleOptimizer'

const IN_CHUNK = 200 // cap .in() list size to stay under URL limits
const MODEL = 'claude-haiku-4-5'
const TEMPERATURE = 0.3
export const MAX_APPROVED = 5 // few-shot ceiling; fewer is fine
export const APPROACHES_PER_ROUND = 5 // each round = 5 deliberately different approaches

// Fixed taxonomy of titling strategies. Each round asks for one candidate per
// DISTINCT strategy — variation is imposed structurally (a strategy per slot),
// not left to the model's whim. The model picks which strategies to use and
// labels each candidate with the one it applied.
export const STRATEGIES: { id: string; description: string }[] = [
  { id: 'search_intent', description: 'phrased the way shoppers actually search — search-intent keywords first' },
  { id: 'spec_heavy', description: 'specification-heavy — key attributes (vintage, region, grape, model) front-loaded' },
  { id: 'concise', description: 'short and precise — brand and core identity/appellation only' },
  { id: 'attribute_rich', description: 'long and attribute-rich — include every available wished-for attribute' },
  { id: 'brand_vintage', description: 'brand- and vintage-centred — producer + year lead the title' },
  { id: 'category_first', description: 'product type / category leads, then brand and attributes' },
  { id: 'region_first', description: 'origin/appellation/region leads, then producer and attributes' },
  { id: 'varietal_first', description: 'grape variety / model / material leads, then brand and origin' },
]

// Picks `count` DISTINCT strategy ids for a round, preferring ones NOT already in
// the approved set (so new rounds explore fresh territory), filling with covered
// ones only if the taxonomy can't supply enough fresh ones. Pure/testable.
export function pickRoundStrategies(coveredApproaches: string[], count: number): string[] {
  const covered = new Set(coveredApproaches.filter(Boolean))
  const ids = STRATEGIES.map((s) => s.id)
  const fresh = ids.filter((id) => !covered.has(id))
  const reused = ids.filter((id) => covered.has(id))
  return [...fresh, ...reused].slice(0, Math.max(0, count))
}

// ── Types ────────────────────────────────────────────────────────────────────

export type ExampleStatus = 'approved' | 'rejected' | 'candidate'

export type BucketExample = {
  id: string
  bucket_id: string
  product_ref: string
  generated_title: string
  status: ExampleStatus
  note: string
  approach: string // strategy id the model used (e.g. "spec_heavy"); '' for legacy rows
  rationale: string // one-sentence AI explanation of how the title was built
  position: number | null
  created_at: string
}

export type BucketTitleConfig = {
  instructions: string
  input_fields: string[] // field tokens (standard fields + metafield:ns.key)
}

// A freshly generated candidate, with the grounding/validation verdict attached
// for the UI (not persisted — examples are re-validated only if needed).
export type GeneratedCandidate = BucketExample & { validation: ValidationResult }

export type GenerateResult = {
  candidates: GeneratedCandidate[]
  // Unused members remaining after this round (members with no example row yet).
  // Approximate — counts members regardless of field-eligibility — so the UI can
  // show roughly how much catalogue is left to draw from.
  unusedMembersAfter: number
}

function db() {
  return adminDb()
}

// ── Title config (per bucket) ────────────────────────────────────────────────

export async function getBucketTitleConfig(bucketId: string): Promise<BucketTitleConfig> {
  const { data } = await db()
    .from('bucket_title_config')
    .select('instructions, input_fields')
    .eq('bucket_id', bucketId)
    .maybeSingle()
  return {
    instructions: (data?.instructions as string | undefined) ?? '',
    input_fields: (data?.input_fields as string[] | undefined) ?? [],
  }
}

export async function saveBucketTitleConfig(
  feedId: string,
  bucketId: string,
  config: BucketTitleConfig
): Promise<void> {
  const { error } = await db()
    .from('bucket_title_config')
    .upsert(
      {
        feed_id: feedId,
        bucket_id: bucketId,
        instructions: config.instructions,
        input_fields: config.input_fields,
        updated_at: new Date().toISOString(),
      },
      { onConflict: 'bucket_id' }
    )
  if (error) throw new Error(error.message)
}

// ── Examples CRUD ────────────────────────────────────────────────────────────

// All examples for a bucket. Approved first (by position), then the rest newest
// first — the shape the workshop UI and the dialog history both want.
export async function listBucketExamples(bucketId: string): Promise<BucketExample[]> {
  const { data } = await db()
    .from('bucket_examples')
    .select('id, bucket_id, product_ref, generated_title, status, note, approach, rationale, position, created_at')
    .eq('bucket_id', bucketId)
  const rows = ((data ?? []) as BucketExample[]).map((r) => ({
    ...r,
    note: r.note ?? '',
    approach: r.approach ?? '',
    rationale: r.rationale ?? '',
  }))
  return rows.sort((a, b) => {
    if (a.status === 'approved' && b.status === 'approved') return (a.position ?? 0) - (b.position ?? 0)
    if (a.status === 'approved') return -1
    if (b.status === 'approved') return 1
    return b.created_at.localeCompare(a.created_at)
  })
}

// Smallest free approved slot in [0, max). Pure so it's unit-testable.
export function nextApprovedPosition(used: Iterable<number>, max = MAX_APPROVED): number | null {
  const taken = new Set(used)
  for (let p = 0; p < max; p++) if (!taken.has(p)) return p
  return null
}

// Approve / reject / un-curate a candidate. Approving assigns the next free slot
// and enforces the MAX_APPROVED ceiling; any other status clears the position.
export async function setExampleStatus(
  feedId: string,
  bucketId: string,
  exampleId: string,
  status: ExampleStatus
): Promise<void> {
  if (status === 'approved') {
    const { data: approved } = await db()
      .from('bucket_examples')
      .select('id, position')
      .eq('bucket_id', bucketId)
      .eq('status', 'approved')
    const rows = (approved ?? []) as { id: string; position: number | null }[]
    if (rows.some((r) => r.id === exampleId)) return // already approved — no-op
    if (rows.length >= MAX_APPROVED) {
      throw new Error(`Maks ${MAX_APPROVED} godkendte eksempler — slet et for at frigøre en plads`)
    }
    const position = nextApprovedPosition(rows.map((r) => r.position ?? 0))
    const { error } = await db()
      .from('bucket_examples')
      .update({ status, position })
      .eq('id', exampleId)
      .eq('feed_id', feedId)
      .eq('bucket_id', bucketId)
    if (error) throw new Error(error.message)
    return
  }

  const { error } = await db()
    .from('bucket_examples')
    .update({ status, position: null })
    .eq('id', exampleId)
    .eq('feed_id', feedId)
    .eq('bucket_id', bucketId)
  if (error) throw new Error(error.message)
}

export async function updateExampleNote(
  feedId: string,
  bucketId: string,
  exampleId: string,
  note: string
): Promise<void> {
  const { error } = await db()
    .from('bucket_examples')
    .update({ note })
    .eq('id', exampleId)
    .eq('feed_id', feedId)
    .eq('bucket_id', bucketId)
  if (error) throw new Error(error.message)
}

// Deletes an example. On an approved row this frees a slot; on a candidate/reject
// it drops it from the dialog history.
export async function deleteExample(feedId: string, bucketId: string, exampleId: string): Promise<void> {
  const { error } = await db()
    .from('bucket_examples')
    .delete()
    .eq('id', exampleId)
    .eq('feed_id', feedId)
    .eq('bucket_id', bucketId)
  if (error) throw new Error(error.message)
}

// ── Candidate generation ─────────────────────────────────────────────────────

// Brand + type are the universal title backbone; either one (or any chosen
// field) is enough structured data to build a meaningful title from.
const CORE_FIELDS = ['vendor', 'product_type']

// "Enough data for a meaningful title": a non-empty current title AND at least
// one non-empty structured attribute among {vendor, product_type} ∪ the selected
// input fields. The selected fields are a WISH LIST, not a requirement — a
// missing wished-for field never disqualifies a product (vendor/product_type can
// carry it). Empty field list → still requires a core attribute.
export function productHasEnoughData(p: SupabaseProduct, fields: string[], marketUrl: string | null): boolean {
  if (!(p.title ?? '').trim()) return false
  const probe = [...new Set([...CORE_FIELDS, ...fields])]
  return probe.some((f) => {
    const v = resolveField(f, p, marketUrl)
    return !!(v && v.trim())
  })
}

// The value-only payload sent to the model for one product: its ref, the current
// title (rewrite source), and the resolved values of the chosen input fields.
// Only present fields are included ("include if possible"), iterated in priority
// order so the payload's key order also reflects the wish list's ranking.
function buildProductPayload(p: SupabaseProduct, fields: string[], marketUrl: string | null) {
  const resolved: Record<string, string> = {}
  for (const f of fields) {
    const v = resolveField(f, p, marketUrl)
    if (v && v.trim()) resolved[f] = v
  }
  return { product_ref: p.shopify_id, current_title: p.title ?? '', fields: resolved }
}

// Stable, cacheable system prompt. The bucket's instructions + char limit +
// target language are part of it (stable within one workshop session); the
// per-round products and the approve/reject verdict live in the messages.
export function buildWorkshopSystemPrompt(
  instructions: string,
  charLimit: number,
  targetLanguage: string,
  inputFields: string[] = []
): string {
  // The selected fields are a prioritised WISH LIST ("include if present"), keyed
  // by the same tokens used as keys in each product's `fields` payload, so the
  // model can correlate them. Order = priority. Omitted entirely when no fields
  // are selected.
  const wishList = inputFields.length
    ? `

# Desired information — most important first
Include these attributes in the title when they help, in this priority order. Each token below matches a key in the product's "fields" data. Include each ONLY if it is present for that product; if it is missing, simply skip it — NEVER invent it. When space is tight (the character limit), keep the higher-priority ones and drop the lower-priority ones:
${inputFields.map((f, i) => `${i + 1}. ${f}`).join('\n')}`
    : ''

  return `You are a product title optimizer for Google Shopping feeds. You generate CANDIDATE titles for a human curator who will pick the best ones as reference examples. Rewrite each product's title so it ranks well in Google Shopping search and matches how shoppers search — while staying 100% truthful to the source data.

# Title rules
- Structure: Brand → Product type → Key attributes (color, material, size, volume, vintage, model) → Variant. Most searchable terms first.
- Front-load the most important keywords; stay under ${charLimit} characters total.
- Language: write the title in ${targetLanguage}, using natural phrasing a native speaker would search for — not a literal translation.
- No promotional/subjective language: no "best", "sale", "cheap", "free shipping", "%", "!".
- No ALL-CAPS words (except acronyms/units like ABV, ml, cl).

# Grounding (critical — never violate)
- Use ONLY attributes explicitly present in each product's data. NEVER invent or guess an attribute.
- NEVER add a measurement (ml, cl, l, kg, g) unless that exact value is in the data.
- If data is thin, produce a SHORTER but accurate title rather than padding with assumptions.
${wishList}

# Curator's instructions for this bucket
${instructions.trim() || '(none provided — apply the general rules above)'}

# Titling strategies — vary the METHOD, not just the words
You generate several candidates at once. Each candidate MUST use a DIFFERENT strategy from this list — never repeat a strategy within one response. Vary the approach to building the title, not just the wording:
${STRATEGIES.map((s) => `- ${s.id}: ${s.description}`).join('\n')}

# Output — return ONLY a JSON array, no preamble. One object per product, echoing its product_ref:
[{ "product_ref": "...", "approach": "<one strategy id from the list>", "rationale": "<one short sentence>", "title": "...", "source_values": ["..."] }]
- "approach": the strategy id you applied — must be one from the list above, and DISTINCT across the array.
- "rationale": one short sentence in ${targetLanguage} describing how this title is built. It must NEVER justify an attribute that is not in the product's data.
- "source_values": the factual values you took from the product data and placed in the title, written EXACTLY as they appear in the data, in the source language (NOT translated). Do not list the generic product type or any inferred/translated word.`
}

type ParsedCandidate = {
  product_ref?: string
  approach: string
  rationale: string
  title: string
  source_values: string[]
}

// Tolerant JSON-array extraction (mirrors titleOptimizer.parseRawResult but for
// an array). Strips ``` fences and pulls the first [...] block.
export function parseCandidatesArray(text: string): ParsedCandidate[] | null {
  const cleaned = text.replace(/```(?:json)?/gi, '').trim()
  const start = cleaned.indexOf('[')
  const end = cleaned.lastIndexOf(']')
  if (start === -1 || end === -1 || end < start) return null
  try {
    const arr = JSON.parse(cleaned.slice(start, end + 1))
    if (!Array.isArray(arr)) return null
    return arr
      .filter((o) => o && typeof o.title === 'string')
      .map((o) => ({
        product_ref: typeof o.product_ref === 'string' ? o.product_ref : undefined,
        approach: typeof o.approach === 'string' ? o.approach.trim() : '',
        rationale: typeof o.rationale === 'string' ? o.rationale.trim() : '',
        title: (o.title as string).trim(),
        source_values: Array.isArray(o.source_values)
          ? o.source_values.filter((s: unknown): s is string => typeof s === 'string')
          : [],
      }))
  } catch {
    return null
  }
}

// Divergence signal: the approved examples are COVERED ground. We replay them so
// the model produces NEW approaches that differ from them — it drives exploration,
// it does NOT ask the model to converge toward the curator's taste (that happens
// later, at the run, where approved examples are the few-shot). Pure/testable.
export function buildDivergenceBlock(examples: BucketExample[]): string {
  const approved = examples.filter((e) => e.status === 'approved')
  if (!approved.length) return ''
  const lines = approved.map((e) => `- "${e.generated_title}"${e.approach ? ` [${e.approach}]` : ''}`)
  const coveredApproaches = [...new Set(approved.map((e) => e.approach).filter(Boolean))]
  let block =
    `The curator has already APPROVED the examples below — this is covered ground. Produce NEW candidates whose approaches are genuinely DIFFERENT from these; do NOT converge toward them or repeat their style:\n${lines.join('\n')}`
  if (coveredApproaches.length) {
    block += `\nApproaches already covered (avoid repeating these where possible): ${coveredApproaches.join(', ')}.`
  }
  return `${block}\n`
}

// Builds the message for a round: a single user turn carrying the divergence
// signal (when there are approved examples) plus the ask. Strategies are ASSIGNED
// (one per candidate) so the round's distinctness is guaranteed structurally, not
// left to the model. The taxonomy + output format live in the cached system
// prompt. messages[0] is a user turn.
export function buildWorkshopMessages(
  examples: BucketExample[],
  payloads: ReturnType<typeof buildProductPayload>[],
  strategies: string[],
  targetLanguage: string
): Anthropic.MessageParam[] {
  const divergence = buildDivergenceBlock(examples)
  const ask =
    (divergence ? `${divergence}\n` : '') +
    `Produce exactly ${strategies.length} candidate titles — one per product. Use these ${strategies.length} strategies, EXACTLY ONE candidate per strategy, applying each to a different product: ${strategies.join(', ')}. Set each candidate's "approach" to the strategy you used. Target language: ${targetLanguage}.\nProducts: ${JSON.stringify(payloads)}`
  return [{ role: 'user', content: ask }]
}

// Generates one round = up to APPROACHES_PER_ROUND (5) candidates, each a NEW
// product titled with a DISTINCT strategy, and persists them as 'candidate' rows.
// First resolves any leftover candidates from the previous round to 'rejected'
// (the curator moved on without picking them — implicit "not these"), so only the
// current round's candidates are live. Replays the APPROVED examples as covered
// ground so the model diverges instead of converging.
export async function generateBucketCandidates(
  feedId: string,
  bucketId: string
): Promise<GenerateResult> {
  const want = APPROACHES_PER_ROUND

  // Previous round's un-chosen candidates → rejected (implicit "not these").
  await db()
    .from('bucket_examples')
    .update({ status: 'rejected', position: null })
    .eq('bucket_id', bucketId)
    .eq('status', 'candidate')

  const [config, examples, memberRefs, { data: ss }, { data: settings }] = await Promise.all([
    getBucketTitleConfig(bucketId),
    listBucketExamples(bucketId),
    getBucketMembership(feedId, bucketId),
    db().from('shop_settings').select('market_url, selected_locale').eq('feed_id', feedId).maybeSingle(),
    db().from('title_optimization_settings').select('char_limit').eq('feed_id', feedId).maybeSingle(),
  ])

  const marketUrl = (ss?.market_url as string | null) ?? null
  const targetLanguage = localeToLanguage((ss?.selected_locale as string | null) ?? null)
  const charLimit = (settings?.char_limit as number | undefined) ?? DEFAULT_CHAR_LIMIT

  // Members that don't already have an example row.
  const usedRefs = new Set(examples.map((e) => e.product_ref))
  const candidateRefs = memberRefs.filter((r) => !usedRefs.has(r))

  // Collect eligible products (enough data for a meaningful title), stopping at
  // `want`. Fields are a wish list now — a missing one no longer disqualifies.
  const eligible: SupabaseProduct[] = []
  for (let i = 0; i < candidateRefs.length && eligible.length < want; i += IN_CHUNK) {
    const slice = candidateRefs.slice(i, i + IN_CHUNK)
    const { data, error } = await db()
      .from('products')
      .select('*, metafields:product_metafields(*)')
      .eq('feed_id', feedId)
      .in('shopify_id', slice)
    if (error) throw new Error(`Products failed: ${error.message}`)
    for (const p of (data ?? []) as SupabaseProduct[]) {
      if (eligible.length >= want) break
      if (productHasEnoughData(p, config.input_fields, marketUrl)) eligible.push(p)
    }
  }

  if (eligible.length === 0) {
    throw new Error(
      'Ingen egnede produkter tilbage at generere kandidater fra (medlemmer der ikke allerede er brugt og har en titel + mindst én attribut).'
    )
  }

  const payloads = eligible.map((p) => buildProductPayload(p, config.input_fields, marketUrl))
  const systemPrompt = buildWorkshopSystemPrompt(config.instructions, charLimit, targetLanguage, config.input_fields)
  // Assign one distinct strategy per candidate, preferring approaches not already
  // approved (fresh-first), so the round is structurally distinct and divergent.
  const coveredApproaches = examples.filter((e) => e.status === 'approved').map((e) => e.approach)
  const strategies = pickRoundStrategies(coveredApproaches, eligible.length)
  const messages = buildWorkshopMessages(examples, payloads, strategies, targetLanguage)

  const client: Anthropic = createOptimizerClient()
  const msg = await client.messages.create({
    model: MODEL,
    // Each candidate now carries a rationale on top of the title, so give more room.
    max_tokens: Math.min(200 * eligible.length + 300, 4096),
    temperature: TEMPERATURE,
    system: [{ type: 'text', text: systemPrompt, cache_control: { type: 'ephemeral' } }],
    messages,
  })
  const block = msg.content[0]
  if (!block || block.type !== 'text') throw new Error('Tomt svar fra modellen')
  const parsed = parseCandidatesArray(block.text)
  if (!parsed) throw new Error('Kunne ikke parse modellens JSON-svar')

  // Match each candidate to its product (by echoed ref, else positionally), run
  // grounding validation, and persist as candidate rows.
  const byRef = new Map(eligible.map((p) => [p.shopify_id, p]))
  // One candidate per product — dedupe in case the model echoes a ref twice.
  const usedProducts = new Set<string>()
  const rows: {
    feed_id: string
    bucket_id: string
    product_ref: string
    generated_title: string
    status: ExampleStatus
    approach: string
    rationale: string
  }[] = []
  const validations: ValidationResult[] = []
  parsed.forEach((c, i) => {
    const product = (c.product_ref && byRef.get(c.product_ref)) || eligible[i]
    if (!product || !c.title || usedProducts.has(product.shopify_id)) return
    usedProducts.add(product.shopify_id)
    const op = toOptimizerProduct(product)
    const validation = validateResult({ title: c.title, source_values: c.source_values }, op, {
      charLimit,
      targetLanguage,
      fewShotExamples: '',
    })
    rows.push({
      feed_id: feedId,
      bucket_id: bucketId,
      product_ref: product.shopify_id,
      generated_title: c.title,
      status: 'candidate',
      approach: c.approach,
      rationale: c.rationale,
    })
    validations.push(validation)
  })

  if (rows.length === 0) throw new Error('Modellen returnerede ingen brugbare kandidater')

  const { data: inserted, error } = await db()
    .from('bucket_examples')
    .insert(rows)
    .select('id, bucket_id, product_ref, generated_title, status, note, approach, rationale, position, created_at')
  if (error) throw new Error(error.message)

  const candidates: GeneratedCandidate[] = ((inserted ?? []) as BucketExample[]).map((r, i) => ({
    ...r,
    note: r.note ?? '',
    approach: r.approach ?? '',
    rationale: r.rationale ?? '',
    validation: validations[i] ?? { ok: true, issues: [] },
  }))

  return { candidates, unusedMembersAfter: Math.max(0, candidateRefs.length - candidates.length) }
}
