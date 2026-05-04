import { createSupabaseServerClient } from '@/lib/supabase-server'
import { adminDb, getOwnedFeed } from '@/lib/feeds'

const PAGE_SIZE = 1000

// Returns the unique (namespace, key) metafield pairs for a feed. Backs the
// mapping page's LAG 2 fetch — kept out of the server component so the page
// renders the saved mappings without waiting on this paginated scan, which
// can take seconds for stores with thousands of metafield rows.
export async function GET(req: Request) {
  const supabase = await createSupabaseServerClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 })

  const url = new URL(req.url)
  const feedId = url.searchParams.get('feedId')
  if (!feedId) return Response.json({ error: 'feedId is missing' }, { status: 400 })

  const owned = await getOwnedFeed(user.id, feedId)
  if (!owned) return Response.json({ error: 'Feed not found' }, { status: 404 })

  const db = adminDb()
  const seen = new Set<string>()
  const metafields: { namespace: string; key: string }[] = []
  let from = 0

  while (true) {
    const { data, error } = await db
      .from('product_metafields')
      .select('namespace, key')
      .eq('feed_id', feedId)
      .order('namespace')
      .order('key')
      .range(from, from + PAGE_SIZE - 1)

    if (error) {
      return Response.json({ error: error.message }, { status: 500 })
    }
    if (!data || data.length === 0) break

    for (const mf of data as { namespace: string; key: string }[]) {
      const k = `${mf.namespace}.${mf.key}`
      if (!seen.has(k)) {
        seen.add(k)
        metafields.push(mf)
      }
    }
    if (data.length < PAGE_SIZE) break
    from += PAGE_SIZE
  }

  return Response.json({ metafields })
}
