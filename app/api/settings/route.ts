import { NextResponse } from 'next/server'
import { createSupabaseServerClient } from '@/lib/supabase-server'
import { adminDb, getOwnedFeed } from '@/lib/feeds'

type ShopSettingsBody = {
  feed_id: string
  selected_market_id?: string | null
  selected_locale?: string
  selected_country?: string
  currency?: string
  market_url?: string | null
}

export async function GET(req: Request) {
  const supabase = await createSupabaseServerClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const url = new URL(req.url)
  const feedId = url.searchParams.get('feedId')
  if (!feedId) return NextResponse.json({ error: 'feedId is missing' }, { status: 400 })

  const owned = await getOwnedFeed(user.id, feedId)
  if (!owned) return NextResponse.json({ error: 'Feed not found' }, { status: 404 })

  const db = adminDb()
  const { data } = await db
    .from('shop_settings')
    .select('selected_market_id, selected_locale, selected_country, currency, market_url')
    .eq('feed_id', feedId)
    .maybeSingle()

  return NextResponse.json({ settings: data ?? null })
}

export async function POST(req: Request) {
  const supabase = await createSupabaseServerClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const body = (await req.json()) as ShopSettingsBody
  if (!body.feed_id) return NextResponse.json({ error: 'feed_id is missing' }, { status: 400 })

  const owned = await getOwnedFeed(user.id, body.feed_id)
  if (!owned) return NextResponse.json({ error: 'Feed not found' }, { status: 404 })

  const db = adminDb()
  const { error } = await db.from('shop_settings').upsert(
    {
      feed_id: body.feed_id,
      user_id: user.id,
      selected_market_id: body.selected_market_id ?? null,
      selected_locale: body.selected_locale ?? 'en',
      selected_country: body.selected_country ?? 'US',
      currency: body.currency ?? 'USD',
      market_url: body.market_url ?? null,
      updated_at: new Date().toISOString(),
    },
    { onConflict: 'feed_id' }
  )

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ ok: true })
}
