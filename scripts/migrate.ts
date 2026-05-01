import postgres from 'postgres'
import { readFileSync, readdirSync } from 'fs'
import { join } from 'path'

// Load .env.local manually (tsx doesn't auto-load it)
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
if (!DATABASE_URL) {
  console.error('Mangler DATABASE_URL i .env.local')
  console.error('Hent den fra: Supabase Dashboard → Settings → Database → URI')
  process.exit(1)
}

const sql = postgres(DATABASE_URL, { ssl: 'require', max: 1 })

const migrationsDir = join(process.cwd(), 'supabase/migrations')
const files = readdirSync(migrationsDir)
  .filter((f) => f.endsWith('.sql'))
  .sort()

// Migrations 001–008 ran before schema_migrations existed. If the schema is
// already provisioned (i.e. products table exists), record them as applied
// without re-running — re-running them would DROP and recreate tables, wiping
// out columns added by later migrations like 009.
const LEGACY_MIGRATIONS = [
  '001_initial.sql',
  '002_feed_mappings.sql',
  '003_feed_cache.sql',
  '004_feed_settings.sql',
  '005_metafields_unique.sql',
  '006_feed_filters.sql',
  '007_shop_settings.sql',
  '008_shop_settings_market_url.sql',
]

async function run() {
  try {
    // 1. Ensure schema_migrations exists
    await sql.unsafe(`
      CREATE TABLE IF NOT EXISTS schema_migrations (
        filename   text PRIMARY KEY,
        applied_at timestamptz DEFAULT now()
      );
    `)

    // 2. Bootstrap: if the schema is already provisioned but schema_migrations
    //    is empty for the legacy files, mark them as applied.
    const productsExists = await sql<{ exists: boolean }[]>`
      SELECT EXISTS (
        SELECT 1 FROM information_schema.tables
        WHERE table_schema = 'public' AND table_name = 'products'
      ) AS "exists"
    `
    if (productsExists[0]?.exists) {
      for (const file of LEGACY_MIGRATIONS) {
        await sql`
          INSERT INTO schema_migrations (filename)
          VALUES (${file})
          ON CONFLICT (filename) DO NOTHING
        `
      }
    }

    // 3. Read already-applied set
    const appliedRows = await sql<{ filename: string }[]>`
      SELECT filename FROM schema_migrations
    `
    const applied = new Set(appliedRows.map((r) => r.filename))

    const pending = files.filter((f) => !applied.has(f))
    console.log(`${files.length} migration(er) i alt — ${pending.length} ny(e), ${applied.size} allerede kørt`)

    // 4. Run pending in order; record each on success
    for (const file of files) {
      if (applied.has(file)) {
        console.log(`  ⊝ Springer over: ${file}`)
        continue
      }
      console.log(`  → Kører: ${file}`)
      const migration = readFileSync(join(migrationsDir, file), 'utf-8')
      await sql.unsafe(migration)
      await sql`
        INSERT INTO schema_migrations (filename) VALUES (${file})
      `
    }

    console.log('✓ Alle migrationer er up-to-date')
  } catch (err) {
    console.error('Migration fejlede:', err)
    process.exit(1)
  } finally {
    await sql.end()
  }
}

run()
