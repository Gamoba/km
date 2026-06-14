// Step-2 smoke test for the AI title optimizer. READ-ONLY: fetches a few active
// products from a feed, runs Method A (auto) through Claude, and prints
// original → optimized + validation. Writes NOTHING to Supabase or Shopify.
//
// Run with:
//   npx tsx scripts/test-title-optimizer.ts [feedId] [count]
//
// If feedId is omitted, the oldest feed is used. count defaults to 5.

import { createClient } from '@supabase/supabase-js'
import { readFileSync } from 'fs'
import { join } from 'path'
import {
  createOptimizerClient,
  optimizeBatch,
  toOptimizerProduct,
  DEFAULT_CHAR_LIMIT,
  type OptimizerConfig,
} from '../lib/titleOptimizer'
import type { SupabaseProduct } from '../lib/sync'

// ── env (.env.local, same loader as scripts/migrate.ts) ──────────────────────
const envFile = join(process.cwd(), '.env.local')
try {
  for (const line of readFileSync(envFile, 'utf-8').split('\n')) {
    const [key, ...rest] = line.split('=')
    if (key?.trim() && !key.startsWith('#')) process.env[key.trim()] ??= rest.join('=').trim()
  }
} catch {
  // fall through to existing env
}

// Minimal locale → language-name map; falls back to the raw code.
const LANGS: Record<string, string> = {
  en: 'English',
  da: 'Danish',
  de: 'German',
  fr: 'French',
  sv: 'Swedish',
  no: 'Norwegian',
  nb: 'Norwegian',
  es: 'Spanish',
  it: 'Italian',
  nl: 'Dutch',
  fi: 'Finnish',
  pt: 'Portuguese',
}

// Placeholder few-shot. THE USER REPLACES THIS with 5–10 hand-written
// "perfect" titles for their catalog before any production run.
const FEW_SHOT_EXAMPLES = `- RØDE NT1 5th Generation Studio Condenser Microphone XLR/USB
- Levi's 501 Original Fit Jeans Men's Dark Blue W32 L34
- Château Margaux 2015 Bordeaux Red Wine 750ml`

async function run() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!url || !key) {
    console.error('Mangler NEXT_PUBLIC_SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY i .env.local')
    process.exit(1)
  }
  if (!process.env.ANTHROPIC_API_KEY) {
    console.error('Mangler ANTHROPIC_API_KEY i .env.local')
    process.exit(1)
  }

  const db = createClient(url, key)

  let feedId = process.argv[2]
  const count = parseInt(process.argv[3] ?? '5', 10) || 5

  if (!feedId) {
    const { data } = await db
      .from('feeds')
      .select('id, name')
      .order('created_at', { ascending: true })
      .limit(1)
      .maybeSingle()
    if (!data) {
      console.error('Ingen feeds fundet.')
      process.exit(1)
    }
    feedId = data.id as string
    console.log(`Bruger ældste feed: ${data.name} (${feedId})`)
  }

  const { data: shopSettings } = await db
    .from('shop_settings')
    .select('selected_locale')
    .eq('feed_id', feedId)
    .maybeSingle()
  const locale = (shopSettings?.selected_locale as string | undefined) ?? 'en'
  const targetLanguage = LANGS[locale] ?? locale

  const { data: productsData, error } = await db
    .from('products')
    .select('*, metafields:product_metafields(*)')
    .eq('feed_id', feedId)
    .eq('status', 'active')
    .order('created_at', { ascending: true })
    .limit(count)
  if (error) {
    console.error('Produkt-query fejlede:', error.message)
    process.exit(1)
  }

  const products = (productsData ?? []) as SupabaseProduct[]
  if (!products.length) {
    console.error('Ingen aktive produkter i dette feed.')
    process.exit(1)
  }

  console.log(`\nMål-sprog: ${targetLanguage} (locale=${locale})`)
  console.log(`Optimerer ${products.length} produkt(er) med Metode A (auto)…\n`)

  const config: OptimizerConfig = {
    charLimit: DEFAULT_CHAR_LIMIT,
    targetLanguage,
    fewShotExamples: FEW_SHOT_EXAMPLES,
  }

  const client = createOptimizerClient()
  const optimizerProducts = products.map(toOptimizerProduct)

  const t0 = Date.now()
  const outcomes = await optimizeBatch(client, optimizerProducts, 'auto', config)
  const ms = Date.now() - t0

  for (const o of outcomes) {
    console.log('────────────────────────────────────────────')
    console.log(`ref:        ${o.product_ref}`)
    console.log(`original:   ${o.original_title}`)
    console.log(`forslag:    ${o.proposed_title ?? '(intet svar)'}`)
    console.log(`accepteret: ${o.optimized_title ?? '(afvist — manuelt review)'}`)
    console.log(`kilde-værdier:${o.source_values.length ? ' ' + o.source_values.join(', ') : ' —'}`)
    if (!o.validation.ok) {
      for (const issue of o.validation.issues) {
        console.log(`   ⚠ ${issue.code}: ${issue.detail}`)
      }
    }
  }

  const okCount = outcomes.filter((o) => o.validation.ok).length
  console.log('\n────────────────────────────────────────────')
  console.log(`${okCount}/${outcomes.length} bestod validering · ${ms}ms`)
  console.log('(Bemærk: udskift FEW_SHOT_EXAMPLES med dine egne titler før produktion.)')
}

run()
