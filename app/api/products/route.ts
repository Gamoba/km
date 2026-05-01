import { createSupabaseServerClient } from '@/lib/supabase-server'
import { adminDb, getOwnedFeed } from '@/lib/feeds'
import { toShopifyData, type SupabaseProduct } from '@/lib/sync'

const ALLOWED_PAGE_SIZES = [25, 50, 100, 200] as const
const DEFAULT_PAGE_SIZE = 25

export async function GET(req: Request) {
  const supabase = await createSupabaseServerClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()

  if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 })

  const url = new URL(req.url)
  const feedId = url.searchParams.get('feedId')
  if (!feedId) return Response.json({ error: 'feedId mangler' }, { status: 400 })

  const owned = await getOwnedFeed(user.id, feedId)
  if (!owned) return Response.json({ error: 'Feed ikke fundet' }, { status: 404 })

  // Pagination params — clamp to safe values so the URL can't request 100k/page.
  const pageRaw = parseInt(url.searchParams.get('page') ?? '1', 10)
  const page = Number.isFinite(pageRaw) && pageRaw > 0 ? pageRaw : 1

  const pageSizeRaw = parseInt(url.searchParams.get('pageSize') ?? String(DEFAULT_PAGE_SIZE), 10)
  const pageSize = (ALLOWED_PAGE_SIZES as readonly number[]).includes(pageSizeRaw)
    ? pageSizeRaw
    : DEFAULT_PAGE_SIZE

  // Server-side search across title/vendor/handle/tags. We strip characters
  // that break PostgREST's .or() DSL (commas, parens, asterisks); the input
  // is otherwise free-form and case-insensitive via ilike.
  const searchRaw = (url.searchParams.get('search') ?? '').trim()
  const search = searchRaw.replace(/[,()*]/g, '')

  try {
    const db = adminDb()
    const from = (page - 1) * pageSize
    const to = from + pageSize - 1

    let query = db
      .from('products')
      .select('*, metafields:product_metafields(*)', { count: 'exact' })
      .eq('feed_id', feedId)
      .order('created_at', { ascending: true })
      .range(from, to)

    if (search) {
      const pattern = `*${search}*`
      query = query.or(
        `title.ilike.${pattern},vendor.ilike.${pattern},handle.ilike.${pattern},tags.ilike.${pattern}`
      )
    }

    const { data, error, count } = await query
    if (error) throw new Error(error.message)

    const products = toShopifyData((data ?? []) as SupabaseProduct[]).products
    const total = count ?? 0
    const totalPages = Math.max(1, Math.ceil(total / pageSize))

    return Response.json({
      products,
      total,
      page,
      pageSize,
      totalPages,
    })
  } catch (err) {
    return Response.json(
      { error: err instanceof Error ? err.message : 'Ukendt fejl' },
      { status: 500 }
    )
  }
}
