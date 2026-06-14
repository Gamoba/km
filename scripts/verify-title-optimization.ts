// End-to-end verification of the title-optimization run chain on a SMALL filter
// scope: scope → planRun → run → persistence, plus skip / re-run / human_edited
// protection. Inserts a narrow title_optimization_filters row, runs, prints
// persisted rows, then cleans up (filter row + the optimization rows it made).
//
// Run: npx tsx scripts/verify-title-optimization.ts [feedId]

import { createClient } from '@supabase/supabase-js'
import { readFileSync } from 'fs'
import { join } from 'path'
import { runTitleOptimization } from '../lib/titleOptimizationRun'
import type { OptimizerConfig } from '../lib/titleOptimizer'

const envFile = join(process.cwd(), '.env.local')
try {
  for (const line of readFileSync(envFile, 'utf-8').split('\n')) {
    const [k, ...r] = line.split('=')
    if (k?.trim() && !k.startsWith('#')) process.env[k.trim()] ??= r.join('=').trim()
  }
} catch {}

const FEED = process.argv[2] ?? '3c4f4fe4-6226-4cc8-81cb-6bf527538728'
// Exactly 5 specific products (an OR-include on their shopify_id) so the run is
// a true handful and deterministic.
const REFS = ['9185391640902', '15241710436678', '14763786010950', '15241710338374', '9108436484422']
const LANGS: Record<string, string> = { de: 'German', en: 'English', da: 'Danish', fr: 'French', it: 'Italian' }
const FEW_SHOT = `- Villa Antinori Chianti Classico 1970 Rotwein
- Château de Pez Saint-Estèphe 1983 Rotwein`

const db = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!)

async function readRows() {
  const { data } = await db
    .from('product_title_optimizations')
    .select('product_ref, status, original_title, proposed_title, optimized_title, source_hash, validation_issues')
    .eq('feed_id', FEED)
  return data ?? []
}

async function run() {
  const { data: ss } = await db.from('shop_settings').select('selected_locale').eq('feed_id', FEED).maybeSingle()
  const targetLanguage = LANGS[(ss?.selected_locale as string) ?? 'en'] ?? 'en'
  const config: OptimizerConfig = { charLimit: 150, targetLanguage, fewShotExamples: FEW_SHOT }

  // Setup: narrow optimization filter to exactly the 5 chosen products.
  console.log(`Sætter optimerings-filter: item_group_id in ${REFS.length} valgte produkter`)
  await db.from('title_optimization_filters').upsert(
    {
      feed_id: FEED,
      filter_type: 'include',
      operator: 'OR',
      rules: REFS.map((ref) => ({ field: 'item_group_id', operator: 'equals', value: ref })),
    },
    { onConflict: 'feed_id,filter_type' }
  )

  try {
    // ── Run 1: fresh (rerun:false) — all in scope are new → processed.
    console.log('\n── Run 1 (fresh, rerun:false) ──')
    console.log(JSON.stringify(await runTitleOptimization(FEED, 'auto', { rerun: false, includeHumanEdited: false }, config)))

    let rows = await readRows()
    console.log(`\nPersisterede rækker (${rows.length}):`)
    for (const r of rows) {
      console.log(`  ${r.product_ref} [${r.status}]`)
      console.log(`    original:  ${r.original_title}`)
      console.log(`    forslag:   ${r.proposed_title}`)
      console.log(`    accepteret:${r.optimized_title ?? ' (null → needs_review)'}`)
      if (r.validation_issues) console.log(`    issues:    ${JSON.stringify(r.validation_issues)}`)
    }

    // ── Run 2: skip (rerun:false again) — existing rows skipped, 0 processed.
    console.log('\n── Run 2 (rerun:false, skal springe alt over) ──')
    console.log(JSON.stringify(await runTitleOptimization(FEED, 'auto', { rerun: false, includeHumanEdited: false }, config)))

    // ── Mark one row human_edited (simulate manual edit).
    const victim = rows[0]?.product_ref
    if (victim) {
      console.log(`\nMarkerer ${victim} som human_edited (manuel titel).`)
      await db
        .from('product_title_optimizations')
        .update({ status: 'human_edited', optimized_title: 'MANUEL Gattinara Titel', updated_at: new Date().toISOString() })
        .eq('feed_id', FEED)
        .eq('product_ref', victim)
    }

    // ── Run 3: rerun:true but includeHumanEdited:false — human_edited protected.
    console.log('\n── Run 3 (rerun:true, includeHumanEdited:false — håndredigeret beskyttet) ──')
    console.log(JSON.stringify(await runTitleOptimization(FEED, 'auto', { rerun: true, includeHumanEdited: false }, config)))
    const afterR3 = (await readRows()).find((r) => r.product_ref === victim)
    console.log(`  ${victim} status efter run 3: ${afterR3?.status} (forventet: human_edited), titel: ${afterR3?.optimized_title}`)

    // ── Run 4: rerun:true + includeHumanEdited:true — human_edited overwritten, original preserved.
    console.log('\n── Run 4 (rerun:true, includeHumanEdited:true — overskriver håndredigeret) ──')
    console.log(JSON.stringify(await runTitleOptimization(FEED, 'auto', { rerun: true, includeHumanEdited: true }, config)))
    const afterR4 = (await readRows()).find((r) => r.product_ref === victim)
    console.log(`  ${victim} status efter run 4: ${afterR4?.status} (forventet: ai_generated/needs_review)`)
    console.log(`    original bevaret: ${afterR4?.original_title}`)
    console.log(`    ny titel:         ${afterR4?.optimized_title ?? '(needs_review)'}`)
  } finally {
    // Cleanup: remove the rows + filter this verify created, leave feed pristine.
    const refs = (await readRows()).map((r) => r.product_ref)
    if (refs.length) await db.from('product_title_optimizations').delete().eq('feed_id', FEED).in('product_ref', refs)
    await db.from('title_optimization_filters').delete().eq('feed_id', FEED).eq('filter_type', 'include')
    console.log('\nOprydning: slettede testens optimerings-rækker + filter. Feed er rent igen.')
  }
}

run()
