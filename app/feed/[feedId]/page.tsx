import { redirect, notFound } from 'next/navigation'
import { createSupabaseServerClient } from '@/lib/supabase-server'
import { adminDb, getOwnedFeed } from '@/lib/feeds'
import { FeedClient } from '@/app/feed/FeedClient'
import { countFilteredProducts } from '@/lib/feedGenerator'
import type { ValidationIssue, ValidationResult } from '@/lib/feedValidator'

// Total Google Shopping fields the mapping UI exposes (8 sections in
// MappingClient.SECTIONS). The progress bar on the dashboard reads
// "X af TOTAL_GOOGLE_FIELDS felter mappet".
const TOTAL_GOOGLE_FIELDS = 39

export default async function FeedDetailPage({
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

  const [
    { data: settingsData },
    { data: cacheInfo },
    mappingsCountRes,
    filteredCounts,
    { data: lastSyncRow },
  ] = await Promise.all([
    db.from('feed_settings').select('feed_mode').eq('feed_id', feedId).maybeSingle(),
    db
      .from('feed_cache')
      .select('generated_at, product_count, validation_status, validation_errors')
      .eq('feed_id', feedId)
      .maybeSingle(),
    db
      .from('feed_mappings')
      .select('feed_id', { count: 'exact', head: true })
      .eq('feed_id', feedId)
      .neq('mapping_type', ''),
    countFilteredProducts(feedId),
    db
      .from('products')
      .select('synced_at')
      .eq('feed_id', feedId)
      .not('synced_at', 'is', null)
      .order('synced_at', { ascending: false })
      .limit(1)
      .maybeSingle(),
  ])

  // Auto-insert default feed_settings row if missing — keeps the invariant
  // that every feed has a settings row before downstream pages need it.
  if (!settingsData) {
    await db.from('feed_settings').insert({
      feed_id: feedId,
      user_id: user.id,
      feed_mode: 'product',
    })
  }

  // Reconstruct a ValidationResult from the cached columns. productsChecked
  // isn't persisted, so it reads as 0 here; FeedValidation treats that as
  // "loaded from cache" and adjusts its subtitle accordingly.
  const cachedStatus = cacheInfo?.validation_status as ValidationResult['status'] | null | undefined
  const cachedIssues = cacheInfo?.validation_errors as ValidationIssue[] | null | undefined
  const initialValidation: ValidationResult | null =
    cachedStatus && cachedIssues
      ? { status: cachedStatus, issues: cachedIssues, productsChecked: 0 }
      : null

  const total = filteredCounts.total
  const included = filteredCounts.included
  const excluded = Math.max(0, total - included)

  return (
    <FeedClient
      feedId={feedId}
      feedName={feed.name}
      initialCacheInfo={cacheInfo ?? null}
      initialValidation={initialValidation}
      mappingCount={mappingsCountRes.count ?? 0}
      totalFields={TOTAL_GOOGLE_FIELDS}
      includedCount={included}
      excludedCount={excluded}
      lastSynced={lastSyncRow?.synced_at ?? null}
    />
  )
}
