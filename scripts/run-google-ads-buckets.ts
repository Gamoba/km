// Exercises the performance-bucket engine from the CLI, before the UI exists.
//
// Writes only to google_ads_buckets / google_ads_bucket_members. Nothing here
// touches the generated feed — emit_to_feed stays false.
//
// Usage:
//   npx tsx scripts/run-google-ads-buckets.ts <feedId>            recompute + report
//   npx tsx scripts/run-google-ads-buckets.ts <feedId> --seed     create the starter set first
//   npx tsx scripts/run-google-ads-buckets.ts <feedId> --list     show buckets and members only
//   npx tsx scripts/run-google-ads-buckets.ts <feedId> --level variant --window 30

import { readFileSync } from 'fs'
import { join } from 'path'
import { adminDb } from '@/lib/feeds'
import { getFeedSettings, saveFeedSettings } from '@/lib/feedGoogleAds'
import {
  listBuckets,
  saveBucket,
  recomputeBuckets,
  starterBuckets,
  type BucketLevel,
} from '@/lib/googleAdsBuckets'

const envFile = join(process.cwd(), '.env.local')
try {
  for (const line of readFileSync(envFile, 'utf-8').split('\n')) {
    const [k, ...rest] = line.split('=')
    if (k?.trim() && !k.startsWith('#')) process.env[k.trim()] ??= rest.join('=').trim()
  }
} catch {
  // fall through to existing env
}

const argv = process.argv.slice(2)
const flagValue = (n: string) => {
  const i = argv.indexOf(n)
  return i === -1 ? undefined : argv[i + 1]
}
const has = (n: string) => argv.includes(n)
const feedId = argv.find((a, i) => !a.startsWith('--') && !argv[i - 1]?.startsWith('--'))

if (!feedId) {
  console.error('Usage: npx tsx scripts/run-google-ads-buckets.ts <feedId> [--seed] [--list]')
  console.error('Find the feed id with: npx tsx scripts/connect-google-ads.ts --feeds')
  process.exit(1)
}

const fmt = (n: number) => n.toLocaleString('da-DK')

async function main() {
  const db = adminDb()

  const settings = await getFeedSettings(db, feedId!)
  if (!settings) {
    console.error('Google Ads is not set up for this feed.')
    process.exit(1)
  }

  const level = flagValue('--level') as BucketLevel | undefined
  const window = flagValue('--window') ? Number(flagValue('--window')) : undefined
  if (level || window) {
    await saveFeedSettings(db, feedId!, {
      ...(level ? { bucket_level: level } : {}),
      ...(window ? { bucket_window_days: window } : {}),
    })
    console.log(`Settings updated: level=${level ?? settings.bucket_level}, window=${window ?? settings.bucket_window_days}d`)
  }

  if (has('--seed')) {
    const existing = await listBuckets(db, feedId!)
    if (existing.length) {
      console.log(`${existing.length} bucket(s) already exist — skipping seed.`)
    } else {
      for (const b of starterBuckets()) await saveBucket(db, feedId!, b)
      console.log(`Seeded ${starterBuckets().length} starter buckets.`)
    }
  }

  const buckets = await listBuckets(db, feedId!)
  if (!buckets.length) {
    console.log('\nNo buckets defined. Run with --seed to create a starter set.\n')
    return
  }

  if (has('--list')) {
    const { data } = await db
      .from('google_ads_bucket_members')
      .select('bucket_id')
      .eq('feed_id', feedId!)
    const counts = new Map<string, number>()
    for (const r of (data ?? []) as { bucket_id: string }[]) {
      counts.set(r.bucket_id, (counts.get(r.bucket_id) ?? 0) + 1)
    }
    console.log(`\n${buckets.length} bucket(s):\n`)
    for (const b of buckets) {
      const rules = b.is_fallback
        ? 'catch-all'
        : b.rules.map((r) => `${r.metric} ${r.operator} ${r.value ?? ''}`.trim()).join(` ${b.match_type} `)
      console.log(`  ${String(b.priority).padStart(4)}  ${b.name.padEnd(18)} ${String(counts.get(b.id) ?? 0).padStart(5)}  ${rules}`)
    }
    console.log('')
    return
  }

  const r = await recomputeBuckets(db, feedId!)

  console.log(`\nRecomputed — level=${r.level}, window=${r.windowDays}d`)
  console.log(`  entities      : ${fmt(r.entities)}  (${fmt(r.withData)} with Google data, ${fmt(r.entities - r.withData)} without)`)
  console.log(`  assigned      : ${fmt(r.assigned)}`)
  if (r.unassigned) {
    console.log(`  unassigned    : ${fmt(r.unassigned)}  (no bucket matched — add a catch-all)`)
  }
  console.log(`  changed bucket: ${fmt(r.moved)}`)
  console.log('')
  for (const b of r.perBucket) {
    const pct = r.entities ? ((b.count / r.entities) * 100).toFixed(0) : '0'
    const bar = '█'.repeat(Math.round((b.count / Math.max(1, r.entities)) * 30))
    console.log(`  ${b.name.padEnd(18)} ${String(b.count).padStart(5)}  ${pct.padStart(3)}%  ${bar}`)
  }
  for (const w of r.warnings) console.log(`\n  ⚠ ${w}`)
  console.log('')
}

main().catch((e) => {
  console.error('\n✗', e instanceof Error ? e.message : e)
  process.exit(1)
})
