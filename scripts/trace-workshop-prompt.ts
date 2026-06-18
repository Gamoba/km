// READ-ONLY diagnostic: reconstructs the EXACT system prompt + product payload the
// workshop "Generate approaches" path would send, WITHOUT calling the model or
// writing anything. Confirms (1) the saved instruction is in the MANDATORY block,
// (2) the selected input field (e.g. drue) resolves to a value for the product the
// round would pick, (3) which prompt builder is used. Delete after diagnosis.
//
//   npx tsx scripts/trace-workshop-prompt.ts            # traces every bucket w/ an instruction
//   npx tsx scripts/trace-workshop-prompt.ts <bucketId> # one bucket

import { readFileSync } from 'fs'
import { join } from 'path'

const envFile = join(process.cwd(), '.env.local')
try {
  for (const line of readFileSync(envFile, 'utf-8').split('\n')) {
    const [k, ...r] = line.split('=')
    if (k?.trim() && !k.startsWith('#')) process.env[k.trim()] ??= r.join('=').trim()
  }
} catch {}

import { adminDb } from '../lib/feeds'
import { getBucketMembership } from '../lib/optimizationBuckets'
import {
  getBucketTitleConfig,
  listBucketExamples,
  productHasEnoughData,
  buildWorkshopSystemPrompt,
} from '../lib/bucketExamples'
import { resolveField } from '../lib/feedFilters'
import {
  localeToLanguage,
  DEFAULT_CHAR_LIMIT,
  fieldDisplayLabel,
  buildSystemPrompt,
  buildUserMessage,
  toOptimizerProduct,
  type OptimizerConfig,
} from '../lib/titleOptimizer'
import { getMetafieldNameMap } from '../lib/metafieldDefinitions'
import type { SupabaseProduct } from '../lib/sync'

const IN_CHUNK = 200

async function traceBucket(bucketId: string, FEED: string, name: string) {
  const db = adminDb()
  const [config, examples, memberRefs, { data: ss }, { data: settings }, nameMap] = await Promise.all([
    getBucketTitleConfig(bucketId),
    listBucketExamples(bucketId),
    getBucketMembership(FEED, bucketId),
    db.from('shop_settings').select('market_url, selected_locale').eq('feed_id', FEED).maybeSingle(),
    db.from('title_optimization_settings').select('char_limit').eq('feed_id', FEED).maybeSingle(),
    getMetafieldNameMap(FEED),
  ])

  const marketUrl = (ss?.market_url as string | null) ?? null
  const targetLanguage = localeToLanguage((ss?.selected_locale as string | null) ?? null)
  const charLimit = (settings?.char_limit as number | undefined) ?? DEFAULT_CHAR_LIMIT
  const label = (token: string) => fieldDisplayLabel(token, nameMap)

  console.log('\n' + '═'.repeat(80))
  console.log(`BUCKET "${name}"  (${bucketId})`)
  console.log('═'.repeat(80))
  console.log(`saved instruction : ${JSON.stringify(config.instructions)}`)
  console.log(`saved input_fields: ${JSON.stringify(config.input_fields)}`)
  console.log(`members           : ${memberRefs.length}`)
  console.log(`targetLanguage    : ${targetLanguage}   charLimit: ${charLimit}`)

  // Replicate generateBucketCandidates' product pick: first member w/o an example
  // row that has enough data.
  const usedRefs = new Set(examples.map((e) => e.product_ref))
  const candidateRefs = memberRefs.filter((r) => !usedRefs.has(r))
  let product: SupabaseProduct | null = null
  for (let i = 0; i < candidateRefs.length && !product; i += IN_CHUNK) {
    const slice = candidateRefs.slice(i, i + IN_CHUNK)
    const { data } = await db
      .from('products')
      .select('*, metafields:product_metafields(*)')
      .eq('feed_id', FEED)
      .in('shopify_id', slice)
    const bySlice = new Map(((data ?? []) as SupabaseProduct[]).map((p) => [p.shopify_id, p]))
    for (const ref of slice) {
      const p = bySlice.get(ref)
      if (p && productHasEnoughData(p, config.input_fields, marketUrl)) {
        product = p
        break
      }
    }
  }

  if (!product) {
    console.log('\n⚠ No eligible product found — generate would throw before any prompt.')
    return
  }

  console.log(`\npicked product    : ${product.shopify_id}  "${product.title}"`)
  console.log(`  product metafields present: ${(product.metafields ?? []).map((m) => `${m.namespace}.${m.key}`).join(', ') || '(none)'}`)

  // Replicate buildProductPayload (private): resolve each chosen field, keyed by
  // the SAME human label the wish-list uses.
  const resolved: Record<string, string> = {}
  for (const f of config.input_fields) {
    const v = resolveField(f, product, marketUrl)
    console.log(`  resolveField(${f}) [label "${label(f)}"] -> ${JSON.stringify(v)}`)
    if (v && v.trim()) resolved[label(f)] = v
  }
  const payload = { product_ref: product.shopify_id, current_title: product.title ?? '', fields: resolved }

  const systemPrompt = buildWorkshopSystemPrompt(
    config.instructions,
    charLimit,
    targetLanguage,
    config.input_fields.map(label)
  )

  const instr = config.instructions.trim()
  const inMandatory = instr.length > 0 && systemPrompt.includes('# MANDATORY USER INSTRUCTION') && systemPrompt.includes(instr)
  console.log('\n── ANSWERS ─────────────────────────────────────────────')
  console.log(`Q1 instruction in prompt (MANDATORY block)?  ${inMandatory ? 'YES' : 'NO'}`)
  console.log(`Q2 grape value passed in payload?            fields = ${JSON.stringify(payload.fields)}`)
  console.log(`Q3 prompt builder used: buildWorkshopSystemPrompt (separate fn; shares mandatoryInstructionBlock helper)`)

  console.log('\n── WORKSHOP product payload (fields object) ────────────')
  console.log(JSON.stringify(payload.fields, null, 2))

  // ── RUN path: reconstruct what the live run sends, to confirm alignment ──
  const runConfig: OptimizerConfig = {
    charLimit,
    targetLanguage,
    fewShotExamples: '',
    instructions: config.instructions,
    inputFields: config.input_fields,
    metafieldNames: nameMap,
  }
  const runSystem = buildSystemPrompt(runConfig)
  const runUser = buildUserMessage(toOptimizerProduct(product), targetLanguage, undefined, nameMap)
  const runWish = runSystem.slice(runSystem.indexOf('# Attributes to include')).split('\n\n')[0]
  const runData = JSON.parse(runUser.slice(runUser.indexOf('Product data: ') + 'Product data: '.length))

  console.log('\n── RUN wish-list (from buildSystemPrompt) ──────────────')
  console.log(runWish)
  console.log('\n── RUN product payload metafields (from buildUserMessage) ──')
  console.log(JSON.stringify(runData.metafields, null, 2))

  // Alignment check: do workshop and run label the metafields identically?
  const wsMeta = Object.keys(payload.fields).filter((k) => !['Title', 'title', 'Vendor', 'vendor', 'Product type', 'product_type'].includes(k))
  const runMeta = Object.keys(runData.metafields ?? {})
  const aligned = wsMeta.every((k) => runMeta.includes(k))
  console.log(`\nMetafield labels aligned workshop↔run? ${aligned ? 'YES' : 'NO'}  (workshop: ${wsMeta.join(', ')} | run: ${runMeta.join(', ')})`)
}

async function main() {
  const arg = process.argv[2]
  if (!arg) {
    console.error('usage: tsx scripts/trace-workshop-prompt.ts <bucketId | bucketName>')
    process.exit(1)
  }
  const db = adminDb()
  // Resolve by id first, else by name (case-insensitive) across ALL feeds — so a
  // bucket on any feed can be traced without knowing its feed id up front.
  const isUuid = /^[0-9a-f-]{36}$/i.test(arg)
  const { data: rows } = isUuid
    ? await db.from('optimization_buckets').select('id, feed_id, name').eq('id', arg)
    : await db.from('optimization_buckets').select('id, feed_id, name').ilike('name', arg)
  const matches = (rows ?? []) as { id: string; feed_id: string; name: string }[]
  if (matches.length === 0) {
    console.log(`No bucket found matching ${JSON.stringify(arg)}.`)
    return
  }
  if (matches.length > 1) {
    console.log(`Multiple buckets match ${JSON.stringify(arg)} — tracing all ${matches.length}:`)
    for (const m of matches) console.log(`  ${m.id}  feed=${m.feed_id}  "${m.name}"`)
  }
  for (const m of matches) await traceBucket(m.id, m.feed_id, m.name)
}

main().then(() => process.exit(0)).catch((e) => {
  console.error('Error:', e instanceof Error ? e.message : e)
  process.exit(1)
})
