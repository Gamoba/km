import { createSupabaseServerClient } from '@/lib/supabase-server'
import { generateFeed } from '@/lib/feedGenerator'
import { validateFeed, type ValidationResult } from '@/lib/feedValidator'
import { adminDb, getOwnedFeed } from '@/lib/feeds'

const CACHE_TTL_MS = 6 * 60 * 60 * 1000 // 6 hours

function xmlResponse(body: string, status = 200) {
  return new Response(body, {
    status,
    headers: { 'Content-Type': 'application/xml; charset=utf-8' },
  })
}

// GET — public XML output for a specific feed (cached)
export async function GET(
  _req: Request,
  { params }: { params: Promise<{ feedId: string }> }
) {
  const { feedId } = await params
  const db = adminDb()

  // Confirm the feed exists (no auth check — feed XML endpoints are public)
  const { data: feedRow } = await db.from('feeds').select('id').eq('id', feedId).maybeSingle()
  if (!feedRow) {
    return xmlResponse('<?xml version="1.0" encoding="UTF-8"?><error>Feed ikke fundet</error>', 404)
  }

  const { data: cached } = await db
    .from('feed_cache')
    .select('xml_content, generated_at')
    .eq('feed_id', feedId)
    .maybeSingle()

  if (cached) {
    const ageMs = Date.now() - new Date(cached.generated_at as string).getTime()
    if (ageMs < CACHE_TTL_MS) {
      return xmlResponse(cached.xml_content as string)
    }
  }

  try {
    const [{ xml, productCount }, validation] = await Promise.all([
      generateFeed(feedId),
      validateFeed(feedId).catch((err) => {
        console.error('Validation fejlede under public feed-generering:', err)
        return null as ValidationResult | null
      }),
    ])

    await db.from('feed_cache').upsert(
      {
        feed_id: feedId,
        xml_content: xml,
        generated_at: new Date().toISOString(),
        product_count: productCount,
        validation_status: validation?.status ?? null,
        validation_errors: validation?.issues ?? null,
      },
      { onConflict: 'feed_id' }
    )

    return xmlResponse(xml)
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'Ukendt fejl'
    return xmlResponse(
      `<?xml version="1.0" encoding="UTF-8"?><error>${msg}</error>`,
      500
    )
  }
}

// POST — protected force-regenerate; returns cache info
export async function POST(
  _req: Request,
  { params }: { params: Promise<{ feedId: string }> }
) {
  const { feedId } = await params

  const supabase = await createSupabaseServerClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()

  if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 })

  const owned = await getOwnedFeed(user.id, feedId)
  if (!owned) return Response.json({ error: 'Feed ikke fundet' }, { status: 404 })

  try {
    const [{ xml, productCount }, validation] = await Promise.all([
      generateFeed(feedId),
      validateFeed(feedId).catch((err) => {
        console.error('Validation fejlede under feed-regenerering:', err)
        return null as ValidationResult | null
      }),
    ])
    const generatedAt = new Date().toISOString()
    const db = adminDb()

    const { error: upsertErr } = await db.from('feed_cache').upsert(
      {
        feed_id: feedId,
        xml_content: xml,
        generated_at: generatedAt,
        product_count: productCount,
        validation_status: validation?.status ?? null,
        validation_errors: validation?.issues ?? null,
      },
      { onConflict: 'feed_id' }
    )

    if (upsertErr) {
      return Response.json({ error: upsertErr.message }, { status: 500 })
    }

    return Response.json({
      generated_at: generatedAt,
      product_count: productCount,
      validation_status: validation?.status ?? null,
      validation_errors: validation?.issues ?? null,
    })
  } catch (err) {
    return Response.json(
      { error: err instanceof Error ? err.message : 'Ukendt fejl' },
      { status: 500 }
    )
  }
}
