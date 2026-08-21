import { redirect, notFound } from 'next/navigation'
import { createSupabaseServerClient } from '@/lib/supabase-server'
import { adminDb, getOwnedFeed } from '@/lib/feeds'
import { getFeedSettings } from '@/lib/feedGoogleAds'
import { listBuckets, type BucketLevel } from '@/lib/googleAdsBuckets'
import { BucketsClient, type MemberRow } from './BucketsClient'

// How many assigned entities to render in the preview table. The point of that
// table is to sanity-check the rules, not to be a catalogue browser — a few
// hundred rows answers "did this land where I expected" without shipping the
// whole membership to the browser.
const PREVIEW_LIMIT = 300

export default async function BucketsPage({
  params,
}: {
  params: Promise<{ feedId: string }>
}) {
  const { feedId } = await params

  const supabase = await createSupabaseServerClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  const feed = await getOwnedFeed(user.id, feedId)
  if (!feed) notFound()

  const db = adminDb()
  const settings = await getFeedSettings(db, feedId)

  if (!settings?.customer_id) {
    return (
      <BucketsClient
        feedId={feedId}
        feedName={feed.name}
        connected={false}
        level="product"
        windowDays={30}
        computedAt={null}
        currency={null}
        roasAction={null}
        poasAction={null}
        buckets={[]}
        counts={{}}
        members={[]}
        totalMembers={0}
      />
    )
  }

  const buckets = await listBuckets(db, feedId)

  // Counts come from the membership table rather than being recomputed, so the
  // page reflects what was last committed — not a fresh evaluation that might
  // disagree with what the labels actually say.
  const { data: memberRows } = await db
    .from('google_ads_bucket_members')
    .select('ref, bucket_id, product_ref')
    .eq('feed_id', feedId)

  const all = (memberRows ?? []) as { ref: string; bucket_id: string; product_ref: string | null }[]
  const counts: Record<string, number> = {}
  for (const m of all) counts[m.bucket_id] = (counts[m.bucket_id] ?? 0) + 1

  // Titles for the preview slice only.
  const slice = all.slice(0, PREVIEW_LIMIT)
  const productRefs = [...new Set(slice.map((m) => m.product_ref).filter(Boolean))] as string[]
  const titles = new Map<string, string>()
  const CHUNK = 200
  for (let i = 0; i < productRefs.length; i += CHUNK) {
    const { data } = await db
      .from('products')
      .select('shopify_id, title')
      .eq('feed_id', feedId)
      .in('shopify_id', productRefs.slice(i, i + CHUNK))
    for (const p of (data ?? []) as { shopify_id: string; title: string | null }[]) {
      if (p.title) titles.set(p.shopify_id, p.title)
    }
  }

  const members: MemberRow[] = slice.map((m) => ({
    ref: m.ref,
    bucketId: m.bucket_id,
    title: m.product_ref ? (titles.get(m.product_ref) ?? null) : null,
  }))

  return (
    <BucketsClient
      feedId={feedId}
      feedName={feed.name}
      connected
      level={(settings.bucket_level ?? 'product') as BucketLevel}
      windowDays={settings.bucket_window_days ?? 30}
      computedAt={settings.buckets_computed_at}
      currency={settings.currency_code}
      roasAction={settings.roas_conversion_action}
      poasAction={settings.poas_conversion_action}
      buckets={buckets}
      counts={counts}
      members={members}
      totalMembers={all.length}
    />
  )
}
