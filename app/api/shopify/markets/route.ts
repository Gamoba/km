import { NextResponse } from 'next/server'
import { createSupabaseServerClient } from '@/lib/supabase-server'
import { fetchMarkets, probeShopifyAccess } from '@/lib/shopify'

export async function GET() {
  const supabase = await createSupabaseServerClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()

  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  // Diagnostic probe — verifies access, lists granted scopes from currentAppInstallation,
  // and introspects the Market + MarketWebPresence types so we can see the actual schema
  // for the API version Shopify serves us (which may differ from the version we request).
  console.log('───── /api/shopify/markets diagnostic probe ─────')
  try {
    const probe = await probeShopifyAccess()
    console.log(`[probe] HTTP ${probe.httpStatus}`)
    console.log(`[probe] x-shopify-api-version: ${probe.apiVersionHeader ?? '(header mangler)'}`)
    console.log(`[probe] raw body: ${probe.rawBody.slice(0, 8000)}`)

    type ProbeBody = {
      data?: {
        currentAppInstallation?: { accessScopes?: Array<{ handle: string }> }
        Market?: { fields?: Array<{ name: string }> } | null
        MarketWebPresence?: { fields?: Array<{ name: string }> } | null
      }
    }
    const parsed = JSON.parse(probe.rawBody) as ProbeBody
    const scopes = parsed.data?.currentAppInstallation?.accessScopes?.map((s) => s.handle) ?? []
    if (scopes.includes('read_markets')) {
      console.log(`[probe] ✓ read_markets er givet`)
    } else {
      console.log(`[probe] ⚠️  read_markets MANGLER blandt access scopes (${scopes.length} scopes givet)`)
    }
    const marketFields = parsed.data?.Market?.fields?.map((f) => f.name) ?? []
    const presenceFields = parsed.data?.MarketWebPresence?.fields?.map((f) => f.name) ?? []
    console.log(`[probe] Market-felter (${marketFields.length}): ${marketFields.join(', ')}`)
    console.log(`[probe] MarketWebPresence-felter (${presenceFields.length}): ${presenceFields.join(', ')}`)
  } catch (err) {
    console.log(`[probe] FEJL — ${err}`)
  }
  console.log('───── slut på probe — kalder fetchMarkets ─────')

  const markets = await fetchMarkets()
  console.log(`/api/shopify/markets: returnerer ${markets.length} markets til UI`)
  return NextResponse.json({ markets })
}
