import { createSupabaseServerClient } from '@/lib/supabase-server'
import { syncProducts } from '@/lib/sync'
import { getOwnedFeed } from '@/lib/feeds'

export async function POST(req: Request) {
  const supabase = await createSupabaseServerClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()

  if (!user) {
    return Response.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const url = new URL(req.url)
  const feedId = url.searchParams.get('feedId')
  if (!feedId) {
    return Response.json({ error: 'feedId mangler' }, { status: 400 })
  }

  const owned = await getOwnedFeed(user.id, feedId)
  if (!owned) {
    return Response.json({ error: 'Feed ikke fundet' }, { status: 404 })
  }

  try {
    const result = await syncProducts(feedId)
    return Response.json(result)
  } catch (err) {
    return Response.json(
      { error: err instanceof Error ? err.message : 'Ukendt fejl' },
      { status: 500 }
    )
  }
}
