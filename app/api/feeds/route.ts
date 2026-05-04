import { NextResponse } from 'next/server'
import { createSupabaseServerClient } from '@/lib/supabase-server'
import { adminDb } from '@/lib/feeds'
import { countFilteredProducts } from '@/lib/feedGenerator'
import type { ValidationIssue } from '@/lib/feedValidator'

export async function GET() {
  const supabase = await createSupabaseServerClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const db = adminDb()

  const { data: feeds, error: feedsErr } = await db
    .from('feeds')
    .select('id, name, description, created_at, updated_at')
    .eq('user_id', user.id)
    .order('created_at', { ascending: true })

  if (feedsErr) {
    return NextResponse.json({ error: feedsErr.message }, { status: 500 })
  }

  const feedIds = (feeds ?? []).map((f) => f.id)

  type CacheRow = {
    feed_id: string
    generated_at: string
    product_count: number
    validation_status: 'ok' | 'warnings' | 'errors' | null
    validation_errors: ValidationIssue[] | null
  }

  let productCounts: { feed_id: string }[] | null = []
  let caches: CacheRow[] | null = []
  let lastSyncs: { feed_id: string; synced_at: string }[] | null = []
  let filterCounts: (readonly [string, { total: number; included: number }])[] = []

  try {
    const results = await Promise.all([
      feedIds.length
        ? db.from('products').select('feed_id').in('feed_id', feedIds)
        : Promise.resolve({ data: [] as { feed_id: string }[] }),
      feedIds.length
        ? db
            .from('feed_cache')
            .select('feed_id, generated_at, product_count, validation_status, validation_errors')
            .in('feed_id', feedIds)
        : Promise.resolve({ data: [] as CacheRow[] }),
      feedIds.length
        ? db.from('products').select('feed_id, synced_at').in('feed_id', feedIds).not('synced_at', 'is', null)
        : Promise.resolve({ data: [] as { feed_id: string; synced_at: string }[] }),
      // countFilteredProducts can throw for a single feed (DB error, etc.).
      // Use allSettled so one bad feed doesn't blow up the whole dashboard;
      // the failed feed just falls back to {0,0} included/excluded counts.
      Promise.allSettled(
        feedIds.map(async (id) => [id, await countFilteredProducts(id)] as const)
      ),
    ])
    productCounts = (results[0].data as { feed_id: string }[] | null) ?? []
    caches = (results[1].data as CacheRow[] | null) ?? []
    lastSyncs = (results[2].data as { feed_id: string; synced_at: string }[] | null) ?? []
    filterCounts = results[3]
      .map((r) => {
        if (r.status === 'fulfilled') return r.value
        console.error('[/api/feeds] countFilteredProducts fejlede for ét feed:', r.reason)
        return null
      })
      .filter((x): x is readonly [string, { total: number; included: number }] => x !== null)
  } catch (err) {
    console.error('[/api/feeds] dashboard-data hentning fejlede:', err)
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Ukendt serverfejl' },
      { status: 500 }
    )
  }

  const productCount = new Map<string, number>()
  for (const row of (productCounts ?? []) as { feed_id: string }[]) {
    productCount.set(row.feed_id, (productCount.get(row.feed_id) ?? 0) + 1)
  }

  const cacheByFeed = new Map<string, CacheRow>()
  for (const row of (caches ?? []) as CacheRow[]) {
    cacheByFeed.set(row.feed_id, row)
  }

  const lastSyncByFeed = new Map<string, string>()
  for (const row of (lastSyncs ?? []) as { feed_id: string; synced_at: string }[]) {
    const prev = lastSyncByFeed.get(row.feed_id)
    if (!prev || row.synced_at > prev) lastSyncByFeed.set(row.feed_id, row.synced_at)
  }

  const filterCountByFeed = new Map(filterCounts)

  const enriched = (feeds ?? []).map((f) => {
    const cache = cacheByFeed.get(f.id)
    const counts = filterCountByFeed.get(f.id) ?? { total: 0, included: 0 }
    return {
      id: f.id,
      name: f.name,
      description: f.description,
      created_at: f.created_at,
      updated_at: f.updated_at,
      productCount: productCount.get(f.id) ?? 0,
      lastSynced: lastSyncByFeed.get(f.id) ?? null,
      feedGenerated: cache?.generated_at ?? null,
      feedProductCount: cache?.product_count ?? null,
      includedCount: counts.included,
      excludedCount: Math.max(0, counts.total - counts.included),
      validationStatus: cache?.validation_status ?? null,
      validationErrors: cache?.validation_errors ?? null,
    }
  })

  return NextResponse.json({ feeds: enriched })
}

export async function POST(req: Request) {
  const supabase = await createSupabaseServerClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const body = (await req.json().catch(() => ({}))) as { name?: string; description?: string }
  const name = (body.name ?? '').trim()
  if (!name) return NextResponse.json({ error: 'Navn er påkrævet' }, { status: 400 })

  const db = adminDb()
  const { data, error } = await db
    .from('feeds')
    .insert({
      user_id: user.id,
      name,
      description: body.description?.trim() || null,
    })
    .select('id, name, description, created_at, updated_at')
    .single()

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  return NextResponse.json({ feed: data })
}
