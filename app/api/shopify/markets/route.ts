import { NextResponse } from 'next/server'
import { createSupabaseServerClient } from '@/lib/supabase-server'
import { adminDb, getOwnedProject } from '@/lib/feeds'
import { createShopifyClientForProject } from '@/lib/projectShopify'

export async function GET(req: Request) {
  const supabase = await createSupabaseServerClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()

  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  // Markets come from the project's Shopify connection — projectId is required.
  const projectId = new URL(req.url).searchParams.get('projectId')
  if (!projectId) {
    return NextResponse.json({ error: 'projectId er påkrævet' }, { status: 400 })
  }
  const owned = await getOwnedProject(user.id, projectId)
  if (!owned) return NextResponse.json({ error: 'Project not found' }, { status: 404 })

  let shopify
  try {
    shopify = await createShopifyClientForProject(adminDb(), projectId)
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Kunne ikke oprette Shopify-forbindelse' },
      { status: 400 }
    )
  }

  // Diagnostic probe — verifies access, lists granted scopes from currentAppInstallation,
  // and introspects the Market + MarketWebPresence types so we can see the actual schema
  // for the API version Shopify serves us (which may differ from the version we request).
  console.log('───── /api/shopify/markets diagnostic probe ─────')
  try {
    const probe = await shopify.probeShopifyAccess()
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

  const markets = await shopify.fetchMarkets()
  console.log(`/api/shopify/markets: returnerer ${markets.length} markets til UI`)
  return NextResponse.json({ markets })
}
