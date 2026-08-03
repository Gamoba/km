// One-time backfill for migration 030: fill projects.primary_domain for
// projects that were connected before the column existed.
//
// For each project with a stored, decryptable token it reads shop.primaryDomain
// from Shopify (a GraphQL *query* — read-only, per AGENTS.md) and writes the
// result to our own database. Never prints or stores the token.
//
// Idempotent: only touches rows where primary_domain IS NULL, so it is safe to
// re-run. New connections get the value from the Connect probe instead.
//
// Run with:
//   npx tsx scripts/backfill-primary-domain.ts

import postgres from 'postgres'
import { readFileSync } from 'fs'
import { join } from 'path'
import { decryptToken } from '../lib/crypto'
import { API_VERSION } from '../lib/shopify'

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

type Row = {
  id: string
  name: string
  shop_url: string | null
  access_token_ciphertext: string | null
  access_token_iv: string | null
  access_token_tag: string | null
}

async function fetchPrimaryDomain(shopUrl: string, token: string): Promise<string | null> {
  const res = await fetch(`https://${shopUrl}/admin/api/${API_VERSION}/graphql.json`, {
    method: 'POST',
    headers: {
      'X-Shopify-Access-Token': token,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ query: `{ shop { primaryDomain { url } } }` }),
  })
  if (!res.ok) {
    console.error(`   HTTP ${res.status} ${res.statusText}`)
    return null
  }
  const json = (await res.json()) as {
    data?: { shop?: { primaryDomain?: { url?: string } | null } | null }
    errors?: Array<{ message?: string }>
  }
  if (json.errors?.length) {
    console.error(`   GraphQL: ${json.errors.map((e) => e.message).join('; ')}`)
    return null
  }
  const url = json.data?.shop?.primaryDomain?.url?.trim().replace(/\/+$/, '')
  return url || null
}

async function run() {
  try {
    const rows = await sql<Row[]>`
      SELECT id, name, shop_url,
             access_token_ciphertext, access_token_iv, access_token_tag
      FROM projects
      WHERE primary_domain IS NULL
      ORDER BY created_at ASC
    `

    if (rows.length === 0) {
      console.log('\nIntet at gøre — alle projects har allerede primary_domain.\n')
      return
    }

    console.log(`\n${rows.length} project(s) uden primary_domain:\n`)

    let filled = 0
    let skipped = 0

    for (const p of rows) {
      console.log(`• ${p.name} (${p.shop_url ?? 'ingen shop_url'})`)

      if (!p.shop_url || !p.access_token_ciphertext || !p.access_token_iv || !p.access_token_tag) {
        console.log('   → springes over: ingen forbindelse konfigureret\n')
        skipped++
        continue
      }

      let token: string
      try {
        token = decryptToken({
          ciphertext: p.access_token_ciphertext,
          iv: p.access_token_iv,
          tag: p.access_token_tag,
        })
      } catch {
        console.log('   → springes over: token kunne ikke dekrypteres\n')
        skipped++
        continue
      }

      const domain = await fetchPrimaryDomain(p.shop_url, token)
      if (!domain) {
        console.log('   → springes over: kunne ikke læse primaryDomain\n')
        skipped++
        continue
      }

      await sql`UPDATE projects SET primary_domain = ${domain} WHERE id = ${p.id}`
      console.log(`   → ${domain}\n`)
      filled++
    }

    console.log('───────────────────────────────────────────────')
    console.log(`✓ ${filled} udfyldt · ${skipped} sprunget over`)
    if (skipped > 0) {
      console.log('  Sprungne projects får værdien næste gang Connect køres i UI\'en.')
    }
    console.log('')
  } finally {
    await sql.end()
  }
}

run()
