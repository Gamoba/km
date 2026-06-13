// Data backfill for the projects layer — see migration 019_projects.sql.
//
// Creates ONE default project per feed-owning user, populated from the current
// env Shopify credentials (SHOPIFY_SHOP_URL + SHOPIFY_ACCESS_TOKEN), with the
// access token encrypted (AES-256-GCM, lib/crypto.ts). Then stamps every
// existing feed with its owner's default project_id, and finally locks
// feeds.project_id NOT NULL once no feed is left unassigned.
//
// Why a Node script and not pure SQL: the access token must be encrypted with
// TOKEN_ENCRYPTION_KEY, which only the Node crypto helper can do — a .sql
// migration can't.
//
// Safe to re-run: only users whose feeds still have project_id IS NULL get a
// new project, and each user is processed in its own transaction. Run with:
//   npx tsx scripts/backfill-default-project.ts
//
// connection_status is set to 'unverified' (not 'connected') because this
// script does not run a live probe against Shopify. The connect/rotate flow
// (trin 4–5) sets 'connected' after a successful probeShopifyAccess().

import postgres from 'postgres'
import { readFileSync } from 'fs'
import { join } from 'path'
import { encryptToken } from '../lib/crypto'

// Load .env.local manually (tsx doesn't auto-load it) — same approach as
// scripts/migrate.ts.
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
  // .env.local not found — fall through to existing env vars
}

const DATABASE_URL = process.env.DATABASE_URL
const SHOP_URL = process.env.SHOPIFY_SHOP_URL
const ACCESS_TOKEN = process.env.SHOPIFY_ACCESS_TOKEN

if (!DATABASE_URL) {
  console.error('Mangler DATABASE_URL i .env.local')
  process.exit(1)
}
if (!SHOP_URL || !ACCESS_TOKEN) {
  console.error('Mangler SHOPIFY_SHOP_URL og/eller SHOPIFY_ACCESS_TOKEN i .env.local')
  console.error('Backfill kan ikke oprette default-project uden de nuværende credentials.')
  process.exit(1)
}
if (!process.env.TOKEN_ENCRYPTION_KEY) {
  console.error('Mangler TOKEN_ENCRYPTION_KEY i .env.local — kan ikke kryptere tokenet.')
  process.exit(1)
}

const sql = postgres(DATABASE_URL, { ssl: 'require', max: 1 })

async function run() {
  try {
    // Distinct owners of feeds that aren't yet assigned to a project.
    const owners = await sql<{ user_id: string }[]>`
      SELECT DISTINCT user_id
      FROM feeds
      WHERE project_id IS NULL
    `

    if (owners.length === 0) {
      console.log('Ingen feeds uden project_id — intet at backfille.')
    } else {
      console.log(`${owners.length} bruger(e) med ikke-tildelte feeds — opretter default-projects…`)
    }

    for (const { user_id } of owners) {
      // Fresh IV per project (encryptToken handles that).
      const enc = encryptToken(ACCESS_TOKEN as string)

      await sql.begin(async (tx) => {
        const [project] = await tx<{ id: string }[]>`
          INSERT INTO projects (
            user_id, name, description, shop_url,
            access_token_ciphertext, access_token_iv, access_token_tag,
            connection_status
          ) VALUES (
            ${user_id},
            'Default project',
            'Auto-oprettet ved migration til projects-laget',
            ${SHOP_URL as string},
            ${enc.ciphertext}, ${enc.iv}, ${enc.tag},
            'unverified'
          )
          RETURNING id
        `

        const updated = await tx`
          UPDATE feeds
          SET project_id = ${project.id}
          WHERE user_id = ${user_id} AND project_id IS NULL
        `
        console.log(`  ✓ bruger ${user_id}: project ${project.id} → ${updated.count} feed(s)`)
      })
    }

    // Lock NOT NULL once every feed is assigned. Skipped if any remain null
    // (mirrors the deferred-lock pattern for feed_id in migration 009).
    const [{ count }] = await sql<{ count: number }[]>`
      SELECT count(*)::int AS count FROM feeds WHERE project_id IS NULL
    `
    if (count === 0) {
      await sql`ALTER TABLE feeds ALTER COLUMN project_id SET NOT NULL`
      console.log('✓ feeds.project_id låst NOT NULL')
    } else {
      console.log(`⚠️  ${count} feed(s) har stadig project_id IS NULL — NOT NULL-lås springes over`)
    }

    console.log('✓ Backfill færdig')
  } catch (err) {
    console.error('Backfill fejlede:', err)
    process.exit(1)
  } finally {
    await sql.end()
  }
}

run()
