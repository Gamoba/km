import { createClient } from '@supabase/supabase-js'
import { fetchProductsWithAllData, fetchProductsLocalized } from '@/lib/shopify'
import type { ShopifyData } from '@/lib/shopify'

function adminClient() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  )
}

export type SyncResult = {
  synced: number
  metafields: number
  durationMs: number
}

export type SupabaseMetafield = {
  id: string
  product_id: string
  feed_id: string
  namespace: string
  key: string
  value: string | null
  type: string | null
  created_at: string
}

export type SupabaseProduct = {
  id: string
  feed_id: string
  shopify_id: string
  title: string | null
  body_html: string | null
  vendor: string | null
  product_type: string | null
  status: string | null
  handle: string | null
  published_at: string | null
  tags: string | null
  images: unknown[]
  variants: unknown[]
  collections: unknown[]
  synced_at: string | null
  created_at: string
  updated_at: string
  metafields: SupabaseMetafield[]
}

// Sync products into a specific feed. Locale/currency comes from that feed's
// shop_settings (now per-feed). Products are scoped by feed_id so the same
// Shopify product can exist in multiple feeds independently.
export async function syncProducts(feedId: string): Promise<SyncResult> {
  const t0 = Date.now()
  const db = adminClient()

  console.log(`[sync] syncProducts feedId=${feedId}`)

  const { data: settings, error: settingsErr } = await db
    .from('shop_settings')
    .select('selected_country, selected_locale, currency, selected_market_id')
    .eq('feed_id', feedId)
    .maybeSingle()
  const tSettings = Date.now()
  console.log(
    `[sync] shop_settings: ${tSettings - t0}ms — ${JSON.stringify(settings)} — fejl: ${settingsErr?.message ?? 'ingen'}`
  )

  let shopifyData: ShopifyData
  if (settings?.selected_locale) {
    console.log(
      `[sync] Lokaliseret sync locale="${settings.selected_locale}", currency="${settings.currency ?? 'ingen'}", country="${settings.selected_country ?? 'ingen'}"`
    )
    shopifyData = await fetchProductsLocalized(
      settings.selected_locale,
      settings.currency ?? undefined,
      settings.selected_country ?? undefined
    )
  } else {
    console.log(`[sync] Standard sync (ingen selected_locale)`)
    shopifyData = await fetchProductsWithAllData()
  }
  const tFetch = Date.now()
  console.log(
    `[sync] shopify fetch total: ${tFetch - tSettings}ms — ${shopifyData.products.length} produkter`
  )

  const { products } = shopifyData
  const syncedShopifyIds = new Set(products.map((p) => String(p.id)))
  const now = new Date().toISOString()

  // ── 1. Bulk upsert all products in one round-trip ───────────────────────
  // .select('id, shopify_id') returns the UUIDs we need to attach metafields,
  // avoiding the per-product RT that the old loop required.
  const productRows = products.map((p) => ({
    feed_id: feedId,
    shopify_id: String(p.id),
    title: p.title,
    body_html: p.body_html,
    vendor: p.vendor,
    product_type: p.product_type,
    status: p.status,
    handle: p.handle,
    published_at: p.published_at,
    tags: p.tags,
    images: p.images,
    variants: p.variants,
    collections: p.collections,
    synced_at: now,
    updated_at: now,
  }))

  let upserted: { id: string; shopify_id: string }[] = []
  if (productRows.length > 0) {
    const { data, error: upsertErr } = await db
      .from('products')
      .upsert(productRows, { onConflict: 'feed_id,shopify_id' })
      .select('id, shopify_id')
    if (upsertErr) throw new Error(`Bulk upsert af produkter fejlede: ${upsertErr.message}`)
    upserted = data ?? []
  }
  const tUpsertProducts = Date.now()
  console.log(
    `[sync] bulk upsert ${productRows.length} produkter → 1 RT: ${tUpsertProducts - tFetch}ms`
  )

  const idByShopifyId = new Map<string, string>()
  for (const row of upserted) {
    idByShopifyId.set(row.shopify_id, row.id)
  }

  // ── 2. Bulk delete all metafields for these products ────────────────────
  // PostgREST sender .in()-værdier i URL'en (?product_id=in.(uuid1,uuid2,...))
  // og ved nogle tusinde UUID'er rammer URL-længde-grænsen / IN-clause-loftet.
  // Chunk derfor i grupper på max 500 og kør parallelt.
  const allUuids = Array.from(idByShopifyId.values())
  const DELETE_CHUNK_SIZE = 500
  const deleteChunks: string[][] = []
  for (let i = 0; i < allUuids.length; i += DELETE_CHUNK_SIZE) {
    deleteChunks.push(allUuids.slice(i, i + DELETE_CHUNK_SIZE))
  }
  if (deleteChunks.length > 0) {
    const results = await Promise.all(
      deleteChunks.map((chunk) =>
        db.from('product_metafields').delete().eq('feed_id', feedId).in('product_id', chunk)
      )
    )
    for (const r of results) {
      if (r.error) throw new Error(`Bulk delete af metafields fejlede: ${r.error.message}`)
    }
  }
  const tDeleteMfs = Date.now()
  console.log(
    `[sync] bulk delete metafields → ${deleteChunks.length} chunk(s) parallelt: ${tDeleteMfs - tUpsertProducts}ms`
  )

  // ── 3. Bulk upsert all metafields ───────────────────────────────────────
  const allMetafields: Array<{
    feed_id: string
    product_id: string
    namespace: string
    key: string
    value: string | null
    type: string | null
  }> = []
  for (const p of products) {
    const productUuid = idByShopifyId.get(String(p.id))
    if (!productUuid) continue
    for (const mf of p.metafields) {
      allMetafields.push({
        feed_id: feedId,
        product_id: productUuid,
        namespace: mf.namespace,
        key: mf.key,
        value: mf.value,
        type: mf.type,
      })
    }
  }

  if (allMetafields.length > 0) {
    const { error: mfErr } = await db
      .from('product_metafields')
      .upsert(allMetafields, { onConflict: 'feed_id,product_id,namespace,key' })
    if (mfErr) throw new Error(`Bulk upsert af metafields fejlede: ${mfErr.message}`)
  }
  const tUpsertMfs = Date.now()
  console.log(
    `[sync] bulk upsert ${allMetafields.length} metafields → ${allMetafields.length > 0 ? 1 : 0} RT: ${tUpsertMfs - tDeleteMfs}ms`
  )

  // ── Cleanup: delete Shopify products that disappeared (per feed) ────────
  const { data: existingProducts, error: fetchErr } = await db
    .from('products')
    .select('id, shopify_id')
    .eq('feed_id', feedId)

  if (fetchErr) throw new Error(`Hentning til oprydning fejlede: ${fetchErr.message}`)

  const staleIds = (existingProducts ?? [])
    .filter((row) => !syncedShopifyIds.has(row.shopify_id))
    .map((row) => row.id)

  // Samme PostgREST URL-længde-grænse som ved metafield-delete: chunk i 500
  // og slet parallelt. Med MAX_PRODUCTS-cap'en kan staleIds nemt være tusinder
  // (alt i DB der ikke kom med i denne syncs page-cap).
  const STALE_CHUNK_SIZE = 500
  const staleChunks: string[][] = []
  for (let i = 0; i < staleIds.length; i += STALE_CHUNK_SIZE) {
    staleChunks.push(staleIds.slice(i, i + STALE_CHUNK_SIZE))
  }
  if (staleChunks.length > 0) {
    const results = await Promise.all(
      staleChunks.map((chunk) => db.from('products').delete().in('id', chunk))
    )
    for (const r of results) {
      if (r.error) throw new Error(`Oprydning af udgåede produkter fejlede: ${r.error.message}`)
    }
  }
  const tCleanup = Date.now()
  console.log(
    `[sync] cleanup (${staleIds.length} stale produkter, ${staleChunks.length} chunk(s) parallelt): ${tCleanup - tUpsertMfs}ms`
  )

  const totalMs = Date.now() - t0
  console.log(`[sync] TOTAL: ${totalMs}ms`)

  return {
    synced: products.length,
    metafields: allMetafields.length,
    durationMs: totalMs,
  }
}

export async function getProductsForFeed(feedId: string): Promise<SupabaseProduct[]> {
  const db = adminClient()

  const { data, error } = await db
    .from('products')
    .select('*, metafields:product_metafields(*)')
    .eq('feed_id', feedId)
    .order('created_at', { ascending: true })

  if (error) throw new Error(`Hentning fra Supabase fejlede: ${error.message}`)

  return (data ?? []) as SupabaseProduct[]
}

export function toShopifyData(products: SupabaseProduct[]): ShopifyData {
  return {
    products: products.map((p) => ({
      id: parseInt(p.shopify_id, 10),
      title: p.title ?? '',
      body_html: p.body_html ?? '',
      vendor: p.vendor ?? '',
      product_type: p.product_type ?? '',
      created_at: p.created_at,
      updated_at: p.updated_at,
      published_at: p.published_at,
      handle: p.handle ?? '',
      status: (p.status as 'active' | 'draft' | 'archived') ?? 'active',
      tags: p.tags ?? '',
      published_scope: '',
      template_suffix: null,
      admin_graphql_api_id: '',
      variants: (p.variants as unknown[]) as import('@/lib/shopify').ShopifyVariant[],
      options: [],
      images: (p.images as unknown[]) as import('@/lib/shopify').ShopifyImage[],
      image: null,
      metafields: p.metafields.map((mf) => ({
        id: 0,
        namespace: mf.namespace,
        key: mf.key,
        value: mf.value ?? '',
        type: mf.type ?? '',
        description: null,
        owner_id: parseInt(p.shopify_id, 10),
        created_at: mf.created_at,
        updated_at: mf.created_at,
        owner_resource: 'product',
      })),
      collections: Array.isArray(p.collections) ? (p.collections as string[]) : [],
    })),
  }
}
