import { NextResponse } from 'next/server'
import { createSupabaseServerClient } from '@/lib/supabase-server'
import { adminDb, getOwnedFeed } from '@/lib/feeds'
import { saveFeedSettings } from '@/lib/feedGoogleAds'
import {
  listBuckets,
  saveBucket,
  deleteBucket,
  starterBuckets,
  type Bucket,
  type BucketLevel,
} from '@/lib/googleAdsBuckets'
import { errorResponse } from '@/lib/errors'

async function guard(feedId: string) {
  const supabase = await createSupabaseServerClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return { error: NextResponse.json({ error: 'Unauthorized' }, { status: 401 }) }
  const feed = await getOwnedFeed(user.id, feedId)
  if (!feed) return { error: NextResponse.json({ error: 'Not found' }, { status: 404 }) }
  return { user, feed }
}

// GET — the feed's buckets, in evaluation order.
export async function GET(_req: Request, { params }: { params: Promise<{ feedId: string }> }) {
  try {
    const { feedId } = await params
    const g = await guard(feedId)
    if ('error' in g) return g.error
    return NextResponse.json({ buckets: await listBuckets(adminDb(), feedId) })
  } catch (err) {
    return errorResponse(err, 'GET /api/google-ads/[feedId]/buckets')
  }
}

type Body = {
  /** 'save' upserts one bucket, 'seed' creates the starter set, 'settings' updates level/window. */
  action?: 'save' | 'seed' | 'settings'
  bucket?: Partial<Bucket>
  level?: BucketLevel
  windowDays?: number
}

export async function POST(req: Request, { params }: { params: Promise<{ feedId: string }> }) {
  try {
    const { feedId } = await params
    const g = await guard(feedId)
    if ('error' in g) return g.error

    const db = adminDb()
    const body = (await req.json().catch(() => ({}))) as Body

    if (body.action === 'seed') {
      const existing = await listBuckets(db, feedId)
      // Refuse rather than merge: seeding on top of a hand-tuned set would
      // duplicate names and scramble priorities.
      if (existing.length) {
        return NextResponse.json(
          { error: 'This feed already has buckets. Delete them first to seed the starter set.' },
          { status: 400 }
        )
      }
      for (const b of starterBuckets()) await saveBucket(db, feedId, b)
      return NextResponse.json({ buckets: await listBuckets(db, feedId) })
    }

    if (body.action === 'settings') {
      await saveFeedSettings(db, feedId, {
        ...(body.level ? { bucket_level: body.level } : {}),
        ...(body.windowDays ? { bucket_window_days: body.windowDays } : {}),
      })
      return NextResponse.json({ ok: true })
    }

    if (!body.bucket) {
      return NextResponse.json({ error: 'bucket is required' }, { status: 400 })
    }
    const saved = await saveBucket(db, feedId, body.bucket)
    return NextResponse.json({ bucket: saved })
  } catch (err) {
    return errorResponse(err, 'POST /api/google-ads/[feedId]/buckets')
  }
}

export async function DELETE(req: Request, { params }: { params: Promise<{ feedId: string }> }) {
  try {
    const { feedId } = await params
    const g = await guard(feedId)
    if ('error' in g) return g.error

    const id = new URL(req.url).searchParams.get('id')
    if (!id) return NextResponse.json({ error: 'id is required' }, { status: 400 })

    await deleteBucket(adminDb(), feedId, id)
    return NextResponse.json({ ok: true })
  } catch (err) {
    return errorResponse(err, 'DELETE /api/google-ads/[feedId]/buckets')
  }
}
