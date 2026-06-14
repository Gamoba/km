// Runs syncProducts for a single feed from the CLI (re-fetches Shopify data,
// resolves metaobjects, and persists products + metafields). Read-only against
// Shopify; writes only to Supabase.
//
// Run: npx tsx scripts/run-sync.ts <feedId>

import { readFileSync } from 'fs'
import { join } from 'path'
import { syncProducts } from '../lib/sync'

const envFile = join(process.cwd(), '.env.local')
try {
  for (const line of readFileSync(envFile, 'utf-8').split('\n')) {
    const [k, ...rest] = line.split('=')
    if (k?.trim() && !k.startsWith('#')) process.env[k.trim()] ??= rest.join('=').trim()
  }
} catch {}

const feedId = process.argv[2]
if (!feedId) {
  console.error('Brug: npx tsx scripts/run-sync.ts <feedId>')
  process.exit(1)
}

syncProducts(feedId)
  .then((r) =>
    console.log(`\n✓ Sync færdig: ${r.synced} produkter, ${r.metafields} metafields, ${r.durationMs}ms`)
  )
  .catch((err) => {
    console.error('Sync fejlede:', err)
    process.exit(1)
  })
