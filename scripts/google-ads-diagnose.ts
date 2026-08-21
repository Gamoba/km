// Read-only diagnostic against the Google Ads API. THROWAWAY — this exists to
// answer four questions before we design anything:
//
//   1. Does the developer token actually read a PRODUCTION account?
//      (i.e. is "Grundlæggende adgang" wired up correctly end to end)
//   2. Which API version is current? (probed, not assumed)
//   3. Does shopping_performance_view return Performance Max product data, or
//      only Shopping? — decides whether a product-labelling feature has data at
//      all for a typical Shopify advertiser.
//   4. Do segments.product_item_id values MATCH this app's g:id?
//      feedGenerator emits shopify_id (product mode) or shopify_id_variantid
//      (variant mode). If Merchant Center is fed by Shopify's own Google channel
//      app instead, ids look like shopify_DK_1234_5678 and every join is empty.
//
// Writes nothing, anywhere. Google Ads is queried read-only (GAQL SELECT only);
// Supabase is read-only too.
//
// Run:  npx tsx scripts/google-ads-diagnose.ts [clientCustomerId] [managerCustomerId]
// Defaults to Vinnu (537-571-6745) under the Gamoba MCC (345-856-6876).

import { readFileSync } from 'fs'
import { join } from 'path'
import postgres from 'postgres'

const envFile = join(process.cwd(), '.env.local')
try {
  for (const line of readFileSync(envFile, 'utf-8').split('\n')) {
    const [k, ...rest] = line.split('=')
    if (k?.trim() && !k.startsWith('#')) process.env[k.trim()] ??= rest.join('=').trim()
  }
} catch {
  // fall through to existing env
}

const DEV_TOKEN = process.env.GOOGLE_DEVELOPER_TOKEN
const CLIENT_ID = process.env.CLIENT_ID
const CLIENT_SECRET = process.env.CLIENT_SECRET
const REFRESH_TOKEN = process.env.GOOGLE_ADS_REFRESH_TOKEN

const digits = (s: string) => s.replace(/\D/g, '')
const CUSTOMER_ID = digits(process.argv[2] ?? '537-571-6745')
const MANAGER_ID = digits(process.argv[3] ?? '345-856-6876')

if (!DEV_TOKEN || !CLIENT_ID || !CLIENT_SECRET) {
  console.error('Mangler GOOGLE_DEVELOPER_TOKEN / CLIENT_ID / CLIENT_SECRET i .env.local')
  process.exit(1)
}
if (!REFRESH_TOKEN) {
  console.error('Mangler GOOGLE_ADS_REFRESH_TOKEN. Kør først:  npx tsx scripts/google-ads-auth.ts')
  process.exit(1)
}

// Versions are deprecated on a rolling schedule, so probe rather than hardcode.
// Override with GOOGLE_ADS_API_VERSION if you already know the right one.
const VERSIONS = process.env.GOOGLE_ADS_API_VERSION
  ? [process.env.GOOGLE_ADS_API_VERSION]
  : ['v24', 'v23', 'v22', 'v21', 'v20', 'v19', 'v18']

const line = () => console.log('─'.repeat(72))
const num = (v: unknown) => (v === undefined || v === null ? 0 : Number(v))
const money = (micros: unknown) => num(micros) / 1_000_000
const fmt = (n: number, d = 2) =>
  n.toLocaleString('da-DK', { minimumFractionDigits: d, maximumFractionDigits: d })

// ── Auth ─────────────────────────────────────────────────────────────────────

async function accessToken(): Promise<string> {
  const res = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: CLIENT_ID!,
      client_secret: CLIENT_SECRET!,
      refresh_token: REFRESH_TOKEN!,
      grant_type: 'refresh_token',
    }).toString(),
  })
  const json = (await res.json()) as Record<string, unknown>
  if (!res.ok) throw new Error(`Token refresh ${res.status}: ${JSON.stringify(json)}`)
  return json.access_token as string
}

// ── API plumbing ─────────────────────────────────────────────────────────────

type Row = Record<string, Record<string, unknown>>

function headers(token: string, login?: string): Record<string, string> {
  const h: Record<string, string> = {
    Authorization: `Bearer ${token}`,
    'developer-token': DEV_TOKEN!,
    'Content-Type': 'application/json',
  }
  // Required whenever the authenticated user reaches the account THROUGH a
  // manager account rather than owning it directly.
  if (login) h['login-customer-id'] = login
  return h
}

// Surfaces the Google error payload, which carries the actually-useful enum
// (DEVELOPER_TOKEN_NOT_APPROVED, USER_PERMISSION_DENIED, ...) rather than just
// an HTTP status.
function explain(status: number, body: unknown): string {
  try {
    const b = body as { error?: { message?: string; details?: unknown[] } }
    const msg = b?.error?.message ?? ''
    const details = JSON.stringify(b?.error?.details ?? [])
    return `${status} ${msg} ${details}`.trim()
  } catch {
    return `${status} ${String(body)}`
  }
}

async function gaql(
  version: string,
  token: string,
  customerId: string,
  loginId: string | undefined,
  query: string
): Promise<Row[]> {
  const res = await fetch(
    `https://googleads.googleapis.com/${version}/customers/${customerId}/googleAds:searchStream`,
    { method: 'POST', headers: headers(token, loginId), body: JSON.stringify({ query }) }
  )
  const json = await res.json().catch(() => null)
  if (!res.ok) throw new Error(explain(res.status, json))
  // searchStream returns a JSON ARRAY of chunks, each { results: [...] }.
  const chunks = (Array.isArray(json) ? json : [json]) as { results?: Row[] }[]
  return chunks.flatMap((c) => c.results ?? [])
}

// ── 1. Version probe + token sanity ──────────────────────────────────────────

async function probeVersion(token: string): Promise<string> {
  const errors: string[] = []
  for (const v of VERSIONS) {
    const res = await fetch(`https://googleads.googleapis.com/${v}/customers:listAccessibleCustomers`, {
      headers: headers(token),
    })
    if (res.ok) {
      const json = (await res.json()) as { resourceNames?: string[] }
      console.log(`✓ API-version:            ${v}`)
      console.log(`✓ Developer token virker mod produktionskonti`)
      const ids = (json.resourceNames ?? []).map((r) => r.split('/').pop())
      console.log(`  Tilgængelige konti:     ${ids.length ? ids.join(', ') : '(ingen)'}`)
      return v
    }
    const body = await res.json().catch(() => null)
    errors.push(`  ${v}: ${explain(res.status, body)}`)
    // A 401/403 is an auth/token problem, not a version problem — stop early.
    if (res.status === 401 || res.status === 403) break
  }
  console.error('✗ Kunne ikke kalde listAccessibleCustomers:')
  errors.forEach((e) => console.error(e))
  console.error(
    '\n  DEVELOPER_TOKEN_NOT_APPROVED  → tokenet har kun testadgang\n' +
      '  USER_PERMISSION_DENIED        → login-brugeren har ikke adgang til kontoen\n' +
      '  403 uden enum                 → Google Ads API ikke aktiveret i Cloud-projektet'
  )
  process.exit(1)
}

// ── 2. Account context ───────────────────────────────────────────────────────

async function accountInfo(version: string, token: string) {
  line()
  console.log('KONTO')
  line()

  try {
    const rows = await gaql(
      version,
      token,
      CUSTOMER_ID,
      MANAGER_ID,
      `SELECT customer.id, customer.descriptive_name, customer.currency_code,
              customer.time_zone, customer.manager, customer.test_account
       FROM customer LIMIT 1`
    )
    const c = rows[0]?.customer ?? {}
    console.log(`  Navn:                   ${c.descriptiveName ?? '?'}`)
    console.log(`  ID:                     ${c.id ?? CUSTOMER_ID}`)
    console.log(`  Valuta:                 ${c.currencyCode ?? '?'}`)
    console.log(`  Tidszone:               ${c.timeZone ?? '?'}`)
    console.log(`  Testkonto:              ${c.testAccount ? 'JA (!)' : 'nej'}`)
    return String(c.currencyCode ?? '')
  } catch (e) {
    console.error(`  ✗ Kunne ikke læse kontoinfo: ${e instanceof Error ? e.message : e}`)
    return ''
  }
}

// ── 3. Campaign mix (what SHOULD be visible) ─────────────────────────────────

type Agg = { cost: number; impr: number; clicks: number; conv: number; value: number }
const emptyAgg = (): Agg => ({ cost: 0, impr: 0, clicks: 0, conv: 0, value: 0 })
function add(a: Agg, r: Record<string, unknown>) {
  a.cost += money(r.costMicros)
  a.impr += num(r.impressions)
  a.clicks += num(r.clicks)
  a.conv += num(r.conversions)
  a.value += num(r.conversionsValue)
}

async function campaignMix(version: string, token: string, cur: string): Promise<Map<string, Agg>> {
  line()
  console.log('KAMPAGNETYPER (sidste 30 dage, hele kontoen)')
  line()
  const byType = new Map<string, Agg>()
  try {
    const rows = await gaql(
      version,
      token,
      CUSTOMER_ID,
      MANAGER_ID,
      `SELECT campaign.advertising_channel_type, metrics.impressions, metrics.clicks,
              metrics.cost_micros, metrics.conversions, metrics.conversions_value
       FROM campaign WHERE segments.date DURING LAST_30_DAYS`
    )
    for (const r of rows) {
      const t = String(r.campaign?.advertisingChannelType ?? 'UNKNOWN')
      if (!byType.has(t)) byType.set(t, emptyAgg())
      add(byType.get(t)!, r.metrics ?? {})
    }
    if (!byType.size) console.log('  (ingen data i perioden)')
    for (const [t, a] of [...byType].sort((x, y) => y[1].cost - x[1].cost)) {
      console.log(
        `  ${t.padEnd(24)} spend ${fmt(a.cost).padStart(12)} ${cur}   ` +
          `konv.værdi ${fmt(a.value).padStart(12)}   klik ${a.clicks}`
      )
    }
  } catch (e) {
    console.error(`  ✗ ${e instanceof Error ? e.message : e}`)
  }
  return byType
}

// ── 4. Product-level data — the decisive query ───────────────────────────────

type ProductRow = { itemId: string; channel: string; title: string; feedLabel: string; m: Agg }

async function productData(version: string, token: string): Promise<{ rows: ProductRow[]; tier: number }> {
  const base = `metrics.impressions, metrics.clicks, metrics.cost_micros,
                metrics.conversions, metrics.conversions_value`

  // Tiered because I'm not certain every segment below exists in the version we
  // land on. Richest query first; fall back rather than fail the diagnostic.
  const tiers = [
    `SELECT campaign.advertising_channel_type, segments.product_item_id, segments.product_title,
            segments.product_feed_label, ${base}
     FROM shopping_performance_view WHERE segments.date DURING LAST_30_DAYS`,
    `SELECT campaign.advertising_channel_type, segments.product_item_id, ${base}
     FROM shopping_performance_view WHERE segments.date DURING LAST_30_DAYS`,
    `SELECT segments.product_item_id, ${base}
     FROM shopping_performance_view WHERE segments.date DURING LAST_30_DAYS`,
  ]

  for (let i = 0; i < tiers.length; i++) {
    try {
      const raw = await gaql(version, token, CUSTOMER_ID, MANAGER_ID, tiers[i])
      const rows: ProductRow[] = raw.map((r) => ({
        itemId: String(r.segments?.productItemId ?? ''),
        channel: String(r.campaign?.advertisingChannelType ?? '?'),
        title: String(r.segments?.productTitle ?? ''),
        feedLabel: String(r.segments?.productFeedLabel ?? ''),
        m: (() => {
          const a = emptyAgg()
          add(a, r.metrics ?? {})
          return a
        })(),
      }))
      return { rows, tier: i }
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e)
      console.log(`  (tier ${i} fejlede: ${msg.slice(0, 160)})`)
    }
  }
  return { rows: [], tier: -1 }
}

// ── 5. Do the item IDs match our feed? ───────────────────────────────────────

async function matchAgainstFeeds(itemIds: Set<string>) {
  line()
  console.log('ID-MATCH MOD VORES EGNE FEEDS')
  line()

  const DATABASE_URL = process.env.DATABASE_URL
  if (!DATABASE_URL) {
    console.log('  (springer over — ingen DATABASE_URL)')
    return
  }

  const sql = postgres(DATABASE_URL, { ssl: 'require', max: 1 })
  try {
    const feeds = await sql<{ id: string; name: string; n: string }[]>`
      SELECT f.id, f.name, count(p.id)::text AS n
      FROM feeds f LEFT JOIN products p ON p.feed_id = f.id
      GROUP BY f.id, f.name ORDER BY count(p.id) DESC`

    if (!feeds.length) {
      console.log('  (ingen feeds i databasen)')
      return
    }

    for (const f of feeds) {
      if (Number(f.n) === 0) {
        console.log(`  ${f.name}: 0 produkter — springes over`)
        continue
      }
      const prods = await sql<{ shopify_id: string; variants: unknown }[]>`
        SELECT shopify_id, variants FROM products WHERE feed_id = ${f.id}`

      // Both id shapes feedGenerator can emit (product mode / variant mode).
      const productIds = new Set<string>()
      const variantIds = new Set<string>()
      for (const p of prods) {
        if (!p.shopify_id) continue
        productIds.add(String(p.shopify_id).toLowerCase())
        for (const v of (p.variants as { id?: unknown }[] | null) ?? []) {
          if (v?.id != null) variantIds.add(`${p.shopify_id}_${v.id}`.toLowerCase())
        }
      }

      let pHits = 0
      let vHits = 0
      for (const id of itemIds) {
        if (productIds.has(id)) pHits++
        if (variantIds.has(id)) vHits++
      }
      const pct = (n: number) => (itemIds.size ? ((n / itemIds.size) * 100).toFixed(1) : '0.0')
      console.log(
        `  ${f.name} (${f.n} produkter): ` +
          `product-mode match ${pHits}/${itemIds.size} (${pct(pHits)}%), ` +
          `variant-mode match ${vHits}/${itemIds.size} (${pct(vHits)}%)`
      )
    }
  } catch (e) {
    console.error(`  ✗ DB-opslag fejlede: ${e instanceof Error ? e.message : e}`)
  } finally {
    await sql.end()
  }
}

// ── main ─────────────────────────────────────────────────────────────────────

async function main() {
  console.log(`\nGoogle Ads diagnostik — konto ${CUSTOMER_ID} via MCC ${MANAGER_ID}\n`)
  line()
  console.log('ADGANG')
  line()

  const token = await accessToken()
  const version = await probeVersion(token)
  const cur = await accountInfo(version, token)
  const byCampaignType = await campaignMix(version, token, cur)

  line()
  console.log('PRODUKTDATA (shopping_performance_view, sidste 30 dage)')
  line()

  const { rows, tier } = await productData(version, token)
  if (tier === -1) {
    console.log('  ✗ Ingen af forespørgslerne virkede — se fejl ovenfor.')
  } else if (!rows.length) {
    console.log('  ⚠ Forespørgslen virkede, men gav NUL rækker.')
    console.log('    Enten er der ingen shopping-/PMax-aktivitet i perioden,')
    console.log('    eller kontoen er ikke koblet til et Merchant Center.')
  } else {
    console.log(`  Rækker: ${rows.length}   (query-tier ${tier}: ${['fuld', 'uden feed_label', 'kun item_id'][tier]})`)

    // Per channel type — this is the PMax question, answered empirically.
    const byChan = new Map<string, Agg>()
    const itemsByChan = new Map<string, Set<string>>()
    for (const r of rows) {
      if (!byChan.has(r.channel)) {
        byChan.set(r.channel, emptyAgg())
        itemsByChan.set(r.channel, new Set())
      }
      const a = byChan.get(r.channel)!
      a.cost += r.m.cost
      a.impr += r.m.impr
      a.clicks += r.m.clicks
      a.conv += r.m.conv
      a.value += r.m.value
      if (r.itemId) itemsByChan.get(r.channel)!.add(r.itemId)
    }
    console.log('\n  Produktdata pr. kampagnetype:')
    for (const [c, a] of [...byChan].sort((x, y) => y[1].cost - x[1].cost)) {
      const total = byCampaignType.get(c)?.cost
      const cover = total ? ` — dækker ${((a.cost / total) * 100).toFixed(0)}% af kontoens ${c}-spend` : ''
      console.log(
        `    ${c.padEnd(24)} ${itemsByChan.get(c)!.size} varer, spend ${fmt(a.cost)} ${cur}${cover}`
      )
    }

    // Roll up to item level, exactly as the bucket engine would.
    const byItem = new Map<string, Agg>()
    for (const r of rows) {
      if (!r.itemId) continue
      if (!byItem.has(r.itemId)) byItem.set(r.itemId, emptyAgg())
      const a = byItem.get(r.itemId)!
      a.cost += r.m.cost
      a.impr += r.m.impr
      a.clicks += r.m.clicks
      a.conv += r.m.conv
      a.value += r.m.value
    }

    const feedLabels = new Set(rows.map((r) => r.feedLabel).filter(Boolean))
    if (feedLabels.size) console.log(`\n  Feed labels: ${[...feedLabels].join(', ')}`)

    console.log(`\n  Unikke item_id'er: ${byItem.size}`)
    console.log('\n  Top 15 efter spend (dette er præcis det bucket-motoren skal bruge):')
    console.log(
      `    ${'item_id'.padEnd(34)} ${'spend'.padStart(10)} ${'konv.værdi'.padStart(12)} ` +
        `${'ROAS'.padStart(7)} ${'klik'.padStart(6)} ${'visn.'.padStart(8)}`
    )
    const top = [...byItem].sort((a, b) => b[1].cost - a[1].cost).slice(0, 15)
    for (const [id, a] of top) {
      const roas = a.cost > 0 ? fmt(a.value / a.cost) : '—'
      console.log(
        `    ${id.slice(0, 34).padEnd(34)} ${fmt(a.cost).padStart(10)} ${fmt(a.value).padStart(12)} ` +
          `${roas.padStart(7)} ${String(a.clicks).padStart(6)} ${String(a.impr).padStart(8)}`
      )
    }

    // The zero-division / no-data problem, quantified up front.
    const noCost = [...byItem.values()].filter((a) => a.cost === 0).length
    const noConv = [...byItem.values()].filter((a) => a.cost > 0 && a.conv === 0).length
    console.log(`\n  Varer med 0 spend:            ${noCost}  (kan ikke få en ROAS — skal have egen bucket)`)
    console.log(`  Varer med spend men 0 konv.:  ${noConv}  ("zombies")`)

    await matchAgainstFeeds(new Set(byItem.keys()))
  }

  line()
  console.log('Færdig. Ingen data blev skrevet nogen steder.')
  line()
}

main().catch((e) => {
  console.error('\n✗ Diagnostik fejlede:', e instanceof Error ? e.message : e)
  process.exit(1)
})
