import { NextResponse } from 'next/server'
import { createSupabaseServerClient } from '@/lib/supabase-server'
import { adminDb, getOwnedFeed } from '@/lib/feeds'
import { recomputeBuckets } from '@/lib/googleAdsBuckets'
import { errorResponse } from '@/lib/errors'

// POST — re-evaluate every bucket rule against the stored metrics.
//
// Not rate-limited: this touches no external API. It reads data already synced
// and rewrites membership, so it is cheap and safe to run on every rule edit.
export async function POST(_req: Request, { params }: { params: Promise<{ feedId: string }> }) {
  try {
    const { feedId } = await params

    const supabase = await createSupabaseServerClient()
    const {
      data: { user },
    } = await supabase.auth.getUser()
    if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

    const feed = await getOwnedFeed(user.id, feedId)
    if (!feed) return NextResponse.json({ error: 'Not found' }, { status: 404 })

    return NextResponse.json({ ok: true, result: await recomputeBuckets(adminDb(), feedId) })
  } catch (err) {
    return errorResponse(err, 'POST /api/google-ads/[feedId]/buckets/recompute')
  }
}
