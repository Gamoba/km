import { redirect, notFound } from 'next/navigation'
import { createSupabaseServerClient } from '@/lib/supabase-server'
import { adminDb, getOwnedFeed } from '@/lib/feeds'
import MappingClient from '@/app/mapping/MappingClient'

export default async function FeedMappingPage({
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

  const [mappingsRes, settingsRes, uniqueMetafields] = await Promise.all([
    db
      .from('feed_mappings')
      .select('google_field, mapping_type, config')
      .eq('feed_id', feedId),
    db
      .from('feed_settings')
      .select('feed_mode')
      .eq('feed_id', feedId)
      .maybeSingle(),
    fetchAllUniqueMetafieldKeys(db, feedId),
  ])

  if (mappingsRes.error) {
    console.error('Fejl ved hentning af mappings:', mappingsRes.error)
  }

  const feedMode = (settingsRes.data?.feed_mode as 'product' | 'variant') ?? 'product'

  return (
    <MappingClient
      feedId={feedId}
      feedName={feed.name}
      feedMode={feedMode}
      initialMappings={mappingsRes.data ?? []}
      metafields={uniqueMetafields}
    />
  )
}

// PostgREST defaults to a 1000-row cap on product_metafields for this feed.
// Without paging, a feed whose metafield rows count above 1000 returns a
// truncated slice — which can collapse to a tiny set of unique (namespace,
// key) pairs after dedup, and the dropdown ends up showing only a handful
// of metafields. Page through with .range() and dedup as we go so memory
// stays bounded by the count of unique keys, not total rows.
async function fetchAllUniqueMetafieldKeys(
  db: ReturnType<typeof adminDb>,
  feedId: string
): Promise<{ namespace: string; key: string }[]> {
  const PAGE_SIZE = 1000
  const seen = new Set<string>()
  const out: { namespace: string; key: string }[] = []
  let from = 0
  let totalRows = 0

  while (true) {
    const { data, error } = await db
      .from('product_metafields')
      .select('namespace, key')
      .eq('feed_id', feedId)
      .order('namespace')
      .order('key')
      .range(from, from + PAGE_SIZE - 1)

    if (error) {
      console.error(
        `[mapping] product_metafields page ${from}-${from + PAGE_SIZE - 1} fejlede:`,
        error.message
      )
      break
    }
    if (!data || data.length === 0) break

    totalRows += data.length
    for (const mf of data) {
      const k = `${mf.namespace}.${mf.key}`
      if (!seen.has(k)) {
        seen.add(k)
        out.push(mf)
      }
    }

    if (data.length < PAGE_SIZE) break
    from += PAGE_SIZE
  }

  console.log(
    `[mapping] feed=${feedId}: scanned ${totalRows} product_metafields rows → ${out.length} unique (namespace, key) pairs`
  )
  return out
}
