import { NextResponse } from 'next/server'
import { createSupabaseServerClient } from '@/lib/supabase-server'
import { adminDb, getOwnedFeed } from '@/lib/feeds'
import { getVariantPerformance, windowRange } from '@/lib/googleAdsAnalytics'
import { getReturnsForFeed } from '@/lib/returnsAnalytics'
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
    const db = adminDb()
    const variants = await getVariantPerformance(db, feedId, days, productRef, {
      roas: url.searchParams.getAll('roas').filter(Boolean),
      poas: url.searchParams.getAll('poas').filter(Boolean),
    })

    // Returns ride along rather than being fetched separately by the client:
    // the drill-down must measure the same market and the same cohort as the
    // product row it opened from, and getReturnsForFeed is what guarantees it.
    //
    // Sent as a lookup keyed by variant_ref, mirroring how the product table
    // receives its own. A variant missing from it has an unknown return rate,
    // which is not a rate of zero.
    const { from, to } = windowRange(days)
    const returns = await getReturnsForFeed(db, feedId, { from, to })

    const returnsByVariant: Record<
      string,
      { returnRate: number | null; refundedInWindow: number; sampleUnits: number }
    > = {}
    for (const v of variants) {
      if (!v.variantRef) continue
      const r = returns.byVariant.get(v.variantRef)
      if (!r) continue
      returnsByVariant[v.variantRef] = {
        returnRate: r.returnRate,
        refundedInWindow: r.refundedInWindow,
        sampleUnits: r.sampleUnits,
      }
    }

    return NextResponse.json({ variants, returns: returnsByVariant })
  } catch (err) {
    return errorResponse(err, 'GET /api/google-ads/[feedId]/variants')
  }
}
