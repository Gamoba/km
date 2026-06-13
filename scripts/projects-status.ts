// Read-only diagnostic: shows, per project, whether it has a usable stored
// Shopify connection — i.e. a shop_url plus an encrypted token that actually
// decrypts — independent of the connection_status label. This is what decides
// whether a project survives removal of the env fallback (trin 6).
//
// Never prints the token. Run with:
//   npx tsx scripts/projects-status.ts

import postgres from 'postgres'
import { readFileSync } from 'fs'
import { join } from 'path'
import { decryptToken } from '../lib/crypto'

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
  connection_status: string
  shop_url: string | null
  last_verified_at: string | null
  access_token_ciphertext: string | null
  access_token_iv: string | null
  access_token_tag: string | null
  feed_count: number
}

async function run() {
  try {
    const rows = await sql<Row[]>`
      SELECT p.id, p.name, p.connection_status, p.shop_url, p.last_verified_at,
             p.access_token_ciphertext, p.access_token_iv, p.access_token_tag,
             (SELECT count(*)::int FROM feeds f WHERE f.project_id = p.id) AS feed_count
      FROM projects p
      ORDER BY p.created_at ASC
    `

    console.log(`\n${rows.length} project(s):\n`)

    let breakingCount = 0
    let unverifiedButWorking = 0

    for (const r of rows) {
      const hasTokenCols =
        !!r.access_token_ciphertext && !!r.access_token_iv && !!r.access_token_tag
      let decrypts = false
      if (hasTokenCols) {
        try {
          const t = decryptToken({
            ciphertext: r.access_token_ciphertext as string,
            iv: r.access_token_iv as string,
            tag: r.access_token_tag as string,
          })
          decrypts = t.length > 0
        } catch {
          decrypts = false
        }
      }

      const usable = !!r.shop_url && hasTokenCols && decrypts

      let verdict: string
      if (usable) {
        verdict = '✓ virker via project-creds (fallback ikke nødvendig)'
        if (r.connection_status !== 'connected') unverifiedButWorking++
      } else if (r.feed_count > 0) {
        verdict = '✗ VIL BREGE uden fallback — har feeds men intet brugbart token'
        breakingCount++
      } else {
        verdict = '— ingen feeds; harmløs, men forbind før brug'
      }

      console.log(`• ${r.name}`)
      console.log(`    status:        ${r.connection_status}`)
      console.log(`    shop_url:      ${r.shop_url ?? '(mangler)'}`)
      console.log(`    token gemt:    ${hasTokenCols ? 'ja' : 'NEJ'}${hasTokenCols ? ` · dekrypterer: ${decrypts ? 'ja' : 'NEJ'}` : ''}`)
      console.log(`    feeds:         ${r.feed_count}`)
      console.log(`    last_verified: ${r.last_verified_at ?? '(aldrig)'}`)
      console.log(`    → ${verdict}\n`)
    }

    console.log('───────────────────────────────────────────────')
    if (breakingCount === 0) {
      console.log('✓ Alle projects med feeds har et brugbart, dekrypterbart token.')
      console.log('  Env-fallbacken kan fjernes uden at noget aktivt project går i stå.')
    } else {
      console.log(`✗ ${breakingCount} project(s) med feeds mangler et brugbart token — forbind dem FØR fallbacken fjernes.`)
    }
    if (unverifiedButWorking > 0) {
      console.log(
        `ℹ ${unverifiedButWorking} project(s) virker men står ikke 'connected' — kør Connect i UI'en for at probe + sætte grøn status (kosmetisk).`
      )
    }
  } catch (err) {
    console.error('Fejl:', err)
    process.exit(1)
  } finally {
    await sql.end()
  }
}

run()
