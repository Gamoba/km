// READ-ONLY diagnostic: how many product_metafields hold metaobject references
// (gid://shopify/Metaobject/...) vs resolved values, grouped by type + key.
// Run: npx tsx scripts/probe-metaobjects.ts
import postgres from 'postgres'
import { readFileSync } from 'fs'
import { join } from 'path'

const envFile = join(process.cwd(), '.env.local')
try {
  for (const line of readFileSync(envFile, 'utf-8').split('\n')) {
    const [k, ...rest] = line.split('=')
    if (k?.trim() && !k.startsWith('#')) process.env[k.trim()] ??= rest.join('=').trim()
  }
} catch {}

const sql = postgres(process.env.DATABASE_URL!, { ssl: 'require', max: 1 })

async function run() {
  try {
    const byType = await sql<{ type: string | null; n: number }[]>`
      SELECT type, count(*)::int AS n FROM product_metafields GROUP BY type ORDER BY n DESC`
    console.log('\nMetafield-typer:')
    for (const r of byType) console.log(`  ${r.type ?? '(null)'} — ${r.n}`)

    const gidRows = await sql<{ namespace: string; key: string; type: string | null; n: number }[]>`
      SELECT namespace, key, type, count(*)::int AS n
      FROM product_metafields
      WHERE value LIKE 'gid://shopify/Metaobject/%' OR value LIKE '%gid://shopify/Metaobject/%'
      GROUP BY namespace, key, type ORDER BY n DESC`
    const total = gidRows.reduce((s, r) => s + r.n, 0)
    console.log(`\n${total} metafield-værdier indeholder Metaobject-GID'er, fordelt på:`)
    for (const r of gidRows) console.log(`  ${r.namespace}.${r.key} [${r.type}] — ${r.n}`)

    const samples = await sql<{ namespace: string; key: string; type: string | null; value: string }[]>`
      SELECT namespace, key, type, value FROM product_metafields
      WHERE value LIKE '%gid://shopify/Metaobject/%' LIMIT 8`
    console.log('\nEksempler:')
    for (const r of samples) console.log(`  ${r.namespace}.${r.key} [${r.type}] = ${r.value}`)
  } finally {
    await sql.end()
  }
}
run()
