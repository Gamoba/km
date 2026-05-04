import { NextResponse } from 'next/server'
import { createSupabaseServerClient } from '@/lib/supabase-server'
import { adminDb } from '@/lib/feeds'
import { countFilteredProducts } from '@/lib/feedGenerator'

// LAG 2 endpoint for the dashboard. Per-feed countFilteredProducts pages
// through products + applies filter rules in JS — slow enough to be worth
// loading after the feed cards are already on screen. Returns one entry per
// feed; failures are dropped silently so one bad feed can't break the rest.
export async function GET() {
  const supabase = await createSupabaseServerClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const db = adminDb()

  const { data: feeds, error: feedsErr } = await db
    .from('feeds')
    .select('id')
    .eq('user_id', user.id)

  if (feedsErr) {
    return NextResponse.json({ error: feedsErr.message }, { status: 500 })
  }

  const feedIds = (feeds ?? []).map((f) => f.id)

  const results = await Promise.allSettled(
    feedIds.map(async (id) => [id, await countFilteredProducts(id)] as const)
  )

  const counts = results
    .map((r) => {
      if (r.status === 'fulfilled') {
        const [feedId, c] = r.value
        return {
          feedId,
          included: c.included,
          excluded: Math.max(0, c.total - c.included),
        }
      }
      console.error('[/api/feeds/counts] countFilteredProducts failed:', r.reason)
      return null
    })
    .filter((x): x is { feedId: string; included: number; excluded: number } => x !== null)

  return NextResponse.json({ counts })
}
