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

  // Per-feed counts use head:true so PostgREST returns just a count header — no
  // rows transferred, no 1000-row cap to bump into. Last-sync uses a per-feed
  // ORDER BY ... LIMIT 1 for the same reason: a single .in() query across feeds
  // would have its row set truncated and silently lose the newest feed's data.
  const productCount = new Map<string, number>()
  const lastSyncByFeed = new Map<string, string>()
  let caches: CacheRow[] | null = []
  let filterCounts: (readonly [string, { total: number; included: number }])[] = []

  try {
    const [productCountResults, cacheResult, lastSyncResults, filterResults] = await Promise.all([
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
      // countFilteredProducts can throw for a single feed (DB error, etc.).
      // Use allSettled so one bad feed doesn't blow up the whole dashboard;
      // the failed feed just falls back to {0,0} included/excluded counts.
      Promise.allSettled(
        feedIds.map(async (id) => [id, await countFilteredProducts(id)] as const)
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
    filterCounts = filterResults
      .map((r) => {
        if (r.status === 'fulfilled') return r.value
        console.error('[/api/feeds] countFilteredProducts failed for one feed:', r.reason)
        return null
      })
      .filter((x): x is readonly [string, { total: number; included: number }] => x !== null)
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
