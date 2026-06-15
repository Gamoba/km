// Manual driver for the bucket example-workshop against a REAL feed/bucket, so
// we can watch the dialog memory (approve/reject history) actually change the
// model's output across rounds. Uses the headless service layer directly
// (service-role DB; no auth/session), with the real Anthropic call (haiku-4-5).
//
// Subcommands:
//   setup [titleContains]   find-or-create the test bucket, scope it, set
//                           membership, save a starter config. Default scope:
//                           title contains "Gattinara".
//   gen [count]             generate one round of candidates (default 3).
//   list                    show every example (id-prefix, status, position, title, note).
//   approve <idPrefix...>   mark candidates good (locks, takes a slot).
//   reject  <idPrefix...>   mark candidates bad (feeds the "BAD" dialog signal).
//   note <idPrefix> <text>  attach a note (replayed into the next round).
//   reset                   delete all examples for the bucket (keep scope/config).
//
// Run: npx tsx scripts/workshop-cli.ts <subcommand> [args]   (feed via FEED env or default)

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
import {
  listBuckets,
  createBucket,
  deleteBucket,
  saveBucketFilters,
  getBucketCandidates,
  setBucketMembership,
  getBucketMembership,
  getFeedMetafields,
} from '../lib/optimizationBuckets'
import {
  saveBucketTitleConfig,
  getBucketTitleConfig,
  generateBucketCandidates,
  listBucketExamples,
  setExampleStatus,
  updateExampleNote,
  type BucketExample,
} from '../lib/bucketExamples'

const FEED = process.env.FEED ?? '3c4f4fe4-6226-4cc8-81cb-6bf527538728'
const BUCKET_NAME = 'Workshop test (Gattinara)'

// Starter config: modest input fields (broadly present so eligibility holds) and
// neutral instructions — we want the approve/reject feedback, not the prompt, to
// drive the round-2 difference.
const INPUT_FIELDS = ['vendor', 'product_type']
const INSTRUCTIONS = 'Skriv en kort, søgbar Google Shopping-titel. Producent/brand først.'

async function findBucketId(): Promise<string | null> {
  const buckets = await listBuckets(FEED)
  return buckets.find((b) => b.name === BUCKET_NAME)?.id ?? null
}

function printExamples(examples: BucketExample[]) {
  if (!examples.length) {
    console.log('  (ingen eksempler endnu)')
    return
  }
  for (const e of examples) {
    const slot = e.status === 'approved' ? ` #${e.position}` : ''
    console.log(`  [${e.id.slice(0, 8)}] ${e.status.toUpperCase()}${slot}  ${e.generated_title}`)
    if (e.note) console.log(`            note: ${e.note}`)
  }
}

async function resolvePrefixes(bucketId: string, prefixes: string[]): Promise<string[]> {
  const examples = await listBucketExamples(bucketId)
  const ids: string[] = []
  for (const p of prefixes) {
    const match = examples.filter((e) => e.id.startsWith(p))
    if (match.length === 0) console.log(`  ⚠ ingen eksempel matcher "${p}"`)
    else if (match.length > 1) console.log(`  ⚠ "${p}" er tvetydigt (${match.length} match) — brug flere tegn`)
    else ids.push(match[0].id)
  }
  return ids
}

async function main() {
  const [cmd, ...args] = process.argv.slice(2)

  if (cmd === 'setup') {
    const titleContains = args[0] ?? 'Gattinara'
    let bucketId = await findBucketId()
    if (!bucketId) {
      const b = await createBucket(FEED, BUCKET_NAME, 'auto')
      bucketId = b.id
      console.log(`Oprettede bucket "${BUCKET_NAME}" (${bucketId})`)
    } else {
      console.log(`Genbruger bucket "${BUCKET_NAME}" (${bucketId})`)
    }
    const include = { operator: 'AND' as const, rules: [{ field: 'title', operator: 'contains', value: titleContains }] }
    const exclude = { operator: 'AND' as const, rules: [] }
    await saveBucketFilters(FEED, bucketId, include, exclude)
    const candidates = await getBucketCandidates(FEED, include, exclude)
    await setBucketMembership(FEED, bucketId, candidates)
    await saveBucketTitleConfig(FEED, bucketId, { instructions: INSTRUCTIONS, input_fields: INPUT_FIELDS })
    const members = await getBucketMembership(FEED, bucketId)
    console.log(`Scope "title contains ${titleContains}" → ${candidates.length} kandidater, membership sat til ${members.length}.`)
    console.log(`Input-felter: ${INPUT_FIELDS.join(', ')}`)
    console.log(`Instruktioner: ${INSTRUCTIONS}`)
    console.log('\nNæste: npx tsx scripts/workshop-cli.ts gen 3')
    return
  }

  const bucketId = await findBucketId()
  if (!bucketId) {
    console.error('Bucket findes ikke endnu — kør "setup" først.')
    process.exit(1)
  }

  if (cmd === 'gen') {
    console.log('Genererer 5 distinkte tilgange… (haiku-4-5, temp 0.3)')
    const before = await listBucketExamples(bucketId)
    const approved = before.filter((e) => e.status === 'approved')
    console.log(`Divergens-historik: ${approved.length} godkendt (allerede dækkede tilgange: ${approved.map((e) => e.approach).filter(Boolean).join(', ') || 'ingen labels'}).`)
    const res = await generateBucketCandidates(FEED, bucketId)
    console.log(`\nNye kandidater (${res.candidates.length}), ${res.unusedMembersAfter} ubrugte medlemmer tilbage:`)
    for (const c of res.candidates) {
      const v = c.validation.ok ? 'ok' : `ISSUES: ${c.validation.issues.map((i) => i.code).join(',')}`
      console.log(`  [${c.id.slice(0, 8)}] (${c.approach || '—'}) ${c.generated_title}   (${v})`)
      if (c.rationale) console.log(`            ↳ ${c.rationale}`)
    }
    console.log('\nMarkér: approve <id> (= godkend), så: gen igen')
    return
  }

  if (cmd === 'list') {
    printExamples(await listBucketExamples(bucketId))
    return
  }

  if (cmd === 'approve' || cmd === 'reject') {
    const ids = await resolvePrefixes(bucketId, args)
    for (const id of ids) {
      await setExampleStatus(FEED, bucketId, id, cmd === 'approve' ? 'approved' : 'rejected')
      console.log(`  ${cmd} ${id.slice(0, 8)}`)
    }
    console.log('\nNuværende tilstand:')
    printExamples(await listBucketExamples(bucketId))
    return
  }

  if (cmd === 'note') {
    const [prefix, ...rest] = args
    const [id] = await resolvePrefixes(bucketId, [prefix])
    if (id) {
      await updateExampleNote(FEED, bucketId, id, rest.join(' '))
      console.log(`  note sat på ${id.slice(0, 8)}`)
    }
    return
  }

  if (cmd === 'reset') {
    const examples = await listBucketExamples(bucketId)
    if (examples.length) {
      await adminDb().from('bucket_examples').delete().eq('bucket_id', bucketId)
    }
    console.log(`Slettede ${examples.length} eksempler. Scope + config beholdt.`)
    const cfg = await getBucketTitleConfig(bucketId)
    console.log(`Config: felter=[${cfg.input_fields.join(', ')}], instruktioner="${cfg.instructions}"`)
    return
  }

  if (cmd === 'metafields') {
    const mf = await getFeedMetafields(FEED)
    console.log(`Metafields i feedet (${mf.length}):`)
    for (const m of mf) console.log(`  metafield:${m.namespace}.${m.key}  (${m.count} produkter)`)
    return
  }

  if (cmd === 'config') {
    // config <field token...>  — sets the ordered input_fields (priority = order).
    await saveBucketTitleConfig(FEED, bucketId, { instructions: INSTRUCTIONS, input_fields: args })
    const cfg = await getBucketTitleConfig(bucketId)
    console.log(`Input-felter sat (prioritetsrækkefølge): ${cfg.input_fields.join(' > ')}`)
    return
  }

  if (cmd === 'cleanup') {
    await deleteBucket(FEED, bucketId)
    console.log(`Slettede bucket "${BUCKET_NAME}" (${bucketId.slice(0, 8)}) + cascade (membership, eksempler, config, filtre). Feed er rent.`)
    return
  }

  console.error('Ukendt kommando. Brug: setup | gen | list | approve | reject | note | reset | cleanup')
  process.exit(1)
}

main().catch((e) => {
  console.error('Fejl:', e instanceof Error ? e.message : e)
  process.exit(1)
})
