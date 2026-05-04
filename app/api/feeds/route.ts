import { NextResponse } from 'next/server'
import { createSupabaseServerClient } from '@/lib/supabase-server'
import { adminDb } from '@/lib/feeds'
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

  // LAG 1 — fast per-feed lookups: head:true count (products), single-row
  // cache + last-sync. The slow per-feed countFilteredProducts call moved
  // to /api/feeds/counts so it doesn't hold back the dashboard render.
  // Per-feed product count uses head:true so PostgREST returns just a count
  // header. Last-sync uses ORDER BY synced_at LIMIT 1 per feed for the same
  // reason: a single .in() query across feeds would hit the 1000-row cap
  // and silently drop the newest feed.
  const productCount = new Map<string, number>()
  const lastSyncByFeed = new Map<string, string>()
  let caches: CacheRow[] | null = []

  try {
    const [productCountResults, cacheResult, lastSyncResults] = await Promise.all([
      Promise.allSettled(
        feedIds.map(
          async (id) =>
            [
              id,
              await db
                .from('products')
                .select('id', { count: 'exact', head: true })
                .eq('feed_id', id),
            ] as const
        )
      ),
      feedIds.length
        ? db
            .from('feed_cache')
            .select('feed_id, generated_at, product_count, validation_status, validation_errors')
            .in('feed_id', feedIds)
        : Promise.resolve({ data: [] as CacheRow[] }),
      Promise.allSettled(
        feedIds.map(
          async (id) =>
            [
              id,
              await db
                .from('products')
                .select('synced_at')
                .eq('feed_id', id)
                .not('synced_at', 'is', null)
                .order('synced_at', { ascending: false })
                .limit(1)
                .maybeSingle(),
            ] as const
        )
      ),
    ])

    for (const r of productCountResults) {
      if (r.status === 'fulfilled') {
        const [id, res] = r.value
        productCount.set(id, res.count ?? 0)
      } else {
        console.error('[/api/feeds] product count failed for one feed:', r.reason)
      }
    }

    for (const r of lastSyncResults) {
      if (r.status === 'fulfilled') {
        const [id, res] = r.value
        const syncedAt = (res.data as { synced_at: string } | null)?.synced_at
        if (syncedAt) lastSyncByFeed.set(id, syncedAt)
      } else {
        console.error('[/api/feeds] last-sync lookup failed for one feed:', r.reason)
      }
    }

    caches = (cacheResult.data as CacheRow[] | null) ?? []
  } catch (err) {
    console.error('[/api/feeds] dashboard data fetch failed:', err)
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Unknown server error' },
      { status: 500 }
    )
  }

  const cacheByFeed = new Map<string, CacheRow>()
  for (const row of (caches ?? []) as CacheRow[]) {
    cacheByFeed.set(row.feed_id, row)
  }

  const enriched = (feeds ?? []).map((f) => {
    const cache = cacheByFeed.get(f.id)
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
      // null = LAG 2 still loading; FeedListClient fills these from
      // /api/feeds/counts.
      includedCount: null,
      excludedCount: null,
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
  if (!name) return NextResponse.json({ error: 'Name is required' }, { status: 400 })

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
