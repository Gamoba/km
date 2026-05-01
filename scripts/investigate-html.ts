// One-shot investigation script for HTML handling in the feed pipeline.
// Reads .env.local the same way migrate.ts does, then traces a product with
// HTML in body_html through resolveField → applyMapping → XML escape, plus
// what the validator (via generatePreview) sees for the same product.
//
// Run with: npx tsx scripts/investigate-html.ts

import { readFileSync } from 'fs'
import { join } from 'path'
import { createClient } from '@supabase/supabase-js'
import { generateFeed, generatePreview } from '../lib/feedGenerator'

// ── Load .env.local ────────────────────────────────────────────────────────
try {
  const lines = readFileSync(join(process.cwd(), '.env.local'), 'utf-8').split('\n')
  for (const line of lines) {
    const [key, ...rest] = line.split('=')
    if (key?.trim() && !key.startsWith('#')) {
      process.env[key.trim()] ??= rest.join('=').trim()
    }
  }
} catch {}

const db = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
)

// ── Inline copy of xmlEscape from lib/feedGenerator.ts (line 65). ─────────
// Verbatim — used only to demonstrate what the function does, not to invoke
// the actual generator's copy.
function xmlEscape(str: string): string {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;')
}

function divider(label: string) {
  console.log('\n' + '═'.repeat(72))
  console.log(label)
  console.log('═'.repeat(72))
}

async function run() {
  // ── Question 3: xmlEscape behavior on a literal HTML string ─────────────
  divider('3. xmlEscape() behavior')
  const samples = [
    '<p>Test</p>',
    '<p>Pris: 10 < 20 & "fed"</p>',
    'plain text — no tags',
  ]
  for (const s of samples) {
    console.log(`  in : ${JSON.stringify(s)}`)
    console.log(`  out: ${JSON.stringify(xmlEscape(s))}`)
    console.log('')
  }

  // ── Find a product with HTML in body_html ───────────────────────────────
  divider('1. Finding a product with HTML in body_html')
  const { data: candidates, error: candErr } = await db
    .from('products')
    .select('shopify_id, title, body_html, feed_id, status')
    .ilike('body_html', '%<%')
    .eq('status', 'active')
    .limit(5)
  if (candErr) {
    console.error('Query error:', candErr.message)
    process.exit(1)
  }
  if (!candidates || candidates.length === 0) {
    console.log('  No active products with HTML found.')
    process.exit(0)
  }
  console.log(`  Found ${candidates.length} candidate(s):`)
  for (const c of candidates) {
    console.log(`    - ${c.shopify_id} (feed=${c.feed_id}) "${c.title}"`)
  }

  const sample = candidates[0]
  console.log(`\n  Picked sample: ${sample.shopify_id}`)
  console.log('  Raw body_html (first 300 chars):')
  console.log('    ' + JSON.stringify(String(sample.body_html).slice(0, 300)))

  // ── Description mapping for this feed ───────────────────────────────────
  divider('Description mapping for feed ' + sample.feed_id)
  const { data: mappings } = await db
    .from('feed_mappings')
    .select('google_field, mapping_type, config')
    .eq('feed_id', sample.feed_id)
    .eq('google_field', 'description')
  console.log('  ' + JSON.stringify(mappings, null, 2).replace(/\n/g, '\n  '))

  // ── Question 2: what's actually in the generated XML ────────────────────
  divider('2. Generating feed → inspecting <item> block for sample')
  let xml = ''
  try {
    const result = await generateFeed(sample.feed_id)
    xml = result.xml
  } catch (e) {
    console.error('  generateFeed threw:', e instanceof Error ? e.message : e)
    process.exit(1)
  }

  const itemRegex = new RegExp(
    `<item>[\\s\\S]*?${sample.shopify_id}[\\s\\S]*?</item>`
  )
  const itemMatch = xml.match(itemRegex)
  if (!itemMatch) {
    console.log(`  (No <item> for ${sample.shopify_id} — filtered out, or id mapping uses a different format.)`)
    // Show the first item instead so user still sees something useful.
    const firstItem = xml.match(/<item>[\s\S]*?<\/item>/)
    if (firstItem) {
      console.log('\n  Showing first <item> in the feed instead:')
      console.log('  ' + firstItem[0].replace(/\n/g, '\n  '))
    }
  } else {
    console.log('  Full <item> block:')
    console.log('  ' + itemMatch[0].replace(/\n/g, '\n  '))

    const descMatch = itemMatch[0].match(/<g:description>([\s\S]*?)<\/g:description>/)
    if (descMatch) {
      console.log('\n  Just the <g:description> contents (raw bytes from XML):')
      console.log('    ' + JSON.stringify(descMatch[1]))
    }
  }

  // Whole-feed audit: count escaped vs unescaped tags in the generated XML.
  // Inside <g:description>…</g:description> we expect ONLY escaped (&lt;p&gt;)
  // since xmlEscape ran. Unescaped <p> in description content would mean the
  // generator skipped escaping somehow.
  const allDescriptions = [...xml.matchAll(/<g:description>([\s\S]*?)<\/g:description>/g)].map((m) => m[1])
  const escapedPCount = allDescriptions.filter((d) => /&lt;p&gt;|&lt;br/.test(d)).length
  const unescapedPCount = allDescriptions.filter((d) => /<p[\s>]|<br/i.test(d)).length
  console.log('\n  XML audit across all <g:description> blocks in this feed:')
  console.log(`    descriptions total            : ${allDescriptions.length}`)
  console.log(`    contain ESCAPED tag (&lt;p&gt;) : ${escapedPCount}`)
  console.log(`    contain UNESCAPED tag (<p>)   : ${unescapedPCount}`)

  const firstWithEscaped = allDescriptions.find((d) => /&lt;p&gt;|&lt;br/.test(d))
  if (firstWithEscaped) {
    console.log('\n  First description containing escaped HTML (truncated):')
    console.log('    ' + JSON.stringify(firstWithEscaped.slice(0, 300)))
  }

  // ── Question 4: what does the validator see? ────────────────────────────
  divider('4. generatePreview() output (= what validateFeed inspects)')
  let preview
  try {
    preview = await generatePreview(sample.feed_id, 20)
  } catch (e) {
    console.error('  generatePreview threw:', e instanceof Error ? e.message : e)
    process.exit(1)
  }
  const previewRow =
    preview.rows.find((r) => r.productId === sample.shopify_id) ??
    preview.rows.find((r) => r.productId.startsWith(sample.shopify_id))
  if (!previewRow) {
    console.log(`  Sample ${sample.shopify_id} not in first 20 preview rows.`)
    console.log(`  Showing description of preview.rows[0] (id=${preview.rows[0]?.productId}):`)
    console.log('    ' + JSON.stringify(preview.rows[0]?.fields.description ?? '(missing)'))
  } else {
    console.log('  preview row description field:')
    console.log('    ' + JSON.stringify(previewRow.fields.description ?? '(missing)'))
  }

  console.log('\nDone.\n')
  process.exit(0)
}

run().catch((err) => {
  console.error(err)
  process.exit(1)
})
