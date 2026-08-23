import { NextResponse } from 'next/server'
import { createSupabaseServerClient } from '@/lib/supabase-server'
import { adminDb, getOwnedFeed } from '@/lib/feeds'
import { getVariantPerformance } from '@/lib/googleAdsAnalytics'
import { errorResponse } from '@/lib/errors'

// GET — variant-level rows for one product, loaded when a row is expanded.
//
// On demand rather than shipped with the page: variant rows outnumber products
// several times over, and on a large catalogue sending them all up front would
// dwarf the payload for detail almost nobody opens.
export async function GET(
  req: Request,
  { params }: { params: Promise<{ feedId: string }> }
) {
  try {
    const { feedId } = await params

    const supabase = await createSupabaseServerClient()
    const {
      data: { user },
    } = await supabase.auth.getUser()
    if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

    const feed = await getOwnedFeed(user.id, feedId)
    if (!feed) return NextResponse.json({ error: 'Not found' }, { status: 404 })

    const url = new URL(req.url)
    const productRef = url.searchParams.get('product')
    const days = Number(url.searchParams.get('days') ?? 30)

    if (!productRef) {
      return NextResponse.json({ error: 'product is required' }, { status: 400 })
    }

    // The metric definition travels with the request: the page can be showing a
    // different action than the feed's saved default, and expanded rows must
    // agree with the parent row they came from.
    // Repeated params (?roas=A&roas=B) rather than a delimiter, because action
    // names are free text and may contain whatever separator we picked.
    const variants = await getVariantPerformance(adminDb(), feedId, days, productRef, {
      roas: url.searchParams.getAll('roas').filter(Boolean),
      poas: url.searchParams.getAll('poas').filter(Boolean),
    })
    return NextResponse.json({ variants })
  } catch (err) {
    return errorResponse(err, 'GET /api/google-ads/[feedId]/variants')
  }
}
