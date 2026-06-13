// One-off verification: run a real product sync on one feed through the
// project credential path (decrypt token → Shopify → upsert). Confirms the
// AES-256-GCM encryption works end-to-end after the projects migration.
//
//   npx tsx scripts/verify-sync.ts            # syncs the first feed
//   npx tsx scripts/verify-sync.ts <feedId>   # syncs a specific feed

import postgres from 'postgres'
import { readFileSync } from 'fs'
import { join } from 'path'
import { syncProducts } from '../lib/sync'

// Load .env.local (same as scripts/migrate.ts).
const envFile = join(process.cwd(), '.env.local')
try {
  const lines = readFileSync(envFile, 'utf-8').split('\n')
  for (const line of lines) {
    const [key, ...rest] = line.split('=')
    if (key?.trim() && !key.startsWith('#')) {
      process.env[key.trim()] ??= rest.join('=').trim()
    }
  }
} catch {
  // fall through to existing env
}

const DATABASE_URL = process.env.DATABASE_URL
if (!DATABASE_URL) {
  console.error('Mangler DATABASE_URL i .env.local')
  process.exit(1)
}

const sql = postgres(DATABASE_URL, { ssl: 'require', max: 1 })

async function run() {
  try {
    const feeds = await sql<
      {
        id: string
        name: string
        project_id: string
        project_name: string
        connection_status: string
        shop_url: string | null
        product_count: number
      }[]
    >`
      SELECT f.id, f.name, f.project_id,
             p.name AS project_name, p.connection_status, p.shop_url,
             (SELECT count(*)::int FROM products pr WHERE pr.feed_id = f.id) AS product_count
      FROM feeds f
      JOIN projects p ON p.id = f.project_id
      ORDER BY f.created_at ASC
    `

    console.log(`\nFeeds (${feeds.length}):`)
    for (const f of feeds) {
      console.log(
        `  ${f.id}  "${f.name}"  → project "${f.project_name}" [${f.connection_status}] ${f.shop_url ?? '(ingen shop_url)'}  · ${f.product_count} produkter i DB`
      )
    }

    const argFeedId = process.argv[2]
    const target = argFeedId ? feeds.find((f) => f.id === argFeedId) : feeds[0]
    if (!target) {
      console.error(argFeedId ? `\nFeed ${argFeedId} ikke fundet.` : '\nIngen feeds at synkronisere.')
      process.exit(1)
    }

    console.log(`\n── Synkroniserer feed "${target.name}" (${target.id}) ──`)
    console.log(`   via project "${target.project_name}" — krypteret token dekrypteres nu…\n`)

    const before = target.product_count
    const result = await syncProducts(target.id)

    console.log(`\n✓ Sync OK`)
    console.log(`   produkter hentet fra Shopify: ${result.synced}`)
    console.log(`   metafields:                   ${result.metafields}`)
    console.log(`   varighed:                     ${(result.durationMs / 1000).toFixed(1)}s`)
    console.log(`   produkter i DB: ${before} → (efter sync)`)

    if (result.synced > 0) {
      console.log(`\n🔓 Kryptering verificeret end-to-end: token blev dekrypteret og Shopify returnerede produkter.`)
    } else {
      console.log(`\n⚠️  0 produkter hentet — tjek at projectet har read_products-scope og aktive produkter.`)
    }
  } catch (err) {
    console.error('\n✗ Sync fejlede:', err)
    process.exit(1)
  } finally {
    await sql.end()
  }
}

run()
