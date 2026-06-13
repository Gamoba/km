import { NextResponse } from 'next/server'
import { createSupabaseServerClient } from '@/lib/supabase-server'
import { adminDb, getOwnedProject } from '@/lib/feeds'
import { createShopifyClient } from '@/lib/shopify'
import { encryptToken } from '@/lib/crypto'

// Strip protocol and any path so we store the bare *.myshopify.com domain that
// lib/shopify.ts expects (it builds `https://${shopUrl}/admin/...`).
function normalizeShopUrl(input: string): string {
  return input
    .trim()
    .replace(/^https?:\/\//i, '')
    .replace(/\/.*$/, '')
}

type ProbeBody = {
  data?: {
    shop?: { name?: string; myshopifyDomain?: string } | null
    currentAppInstallation?: { accessScopes?: Array<{ handle: string }> }
  }
  errors?: Array<{ message?: string }>
}

// POST — configure (or rotate) a project's Shopify connection.
// Probes the supplied credentials BEFORE persisting; only stores the token
// (encrypted) when the probe authenticates. The plaintext token never leaves
// this server-side handler.
export async function POST(
  req: Request,
  { params }: { params: Promise<{ projectId: string }> }
) {
  const { projectId } = await params

  const supabase = await createSupabaseServerClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const owned = await getOwnedProject(user.id, projectId)
  if (!owned) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  const body = (await req.json().catch(() => ({}))) as {
    shop_url?: string
    access_token?: string
  }
  const shopUrl = normalizeShopUrl(body.shop_url ?? '')
  const accessToken = (body.access_token ?? '').trim()

  if (!shopUrl) return NextResponse.json({ error: 'shop_url er påkrævet' }, { status: 400 })
  if (!accessToken) return NextResponse.json({ error: 'access_token er påkrævet' }, { status: 400 })

  // ── Probe before persisting ────────────────────────────────────────────────
  const shopify = createShopifyClient({ shopUrl, accessToken })

  let probe
  try {
    probe = await shopify.probeShopifyAccess()
  } catch (err) {
    return NextResponse.json(
      {
        error: `Kunne ikke nå Shopify — tjek shop-URL'en. (${err instanceof Error ? err.message : 'netværksfejl'})`,
      },
      { status: 400 }
    )
  }

  let parsed: ProbeBody = {}
  try {
    parsed = JSON.parse(probe.rawBody) as ProbeBody
  } catch {
    // fall through — handled by the success check below
  }

  const authenticated = probe.httpStatus === 200 && !!parsed.data?.shop && !parsed.errors?.length

  if (!authenticated) {
    const detail =
      parsed.errors?.[0]?.message ??
      (probe.httpStatus === 401 || probe.httpStatus === 403
        ? 'access token afvist'
        : `HTTP ${probe.httpStatus}`)
    return NextResponse.json(
      { error: `Forbindelsen kunne ikke verificeres — ${detail}. Intet blev gemt.` },
      { status: 400 }
    )
  }

  const scopes = parsed.data?.currentAppInstallation?.accessScopes?.map((s) => s.handle) ?? []
  const readMarketsMissing = !scopes.includes('read_markets')

  // ── Persist (encrypted) on success ──────────────────────────────────────────
  const enc = encryptToken(accessToken)
  const now = new Date().toISOString()

  const db = adminDb()
  const { error: updateErr } = await db
    .from('projects')
    .update({
      shop_url: shopUrl,
      access_token_ciphertext: enc.ciphertext,
      access_token_iv: enc.iv,
      access_token_tag: enc.tag,
      connection_status: 'connected',
      last_verified_at: now,
      updated_at: now,
    })
    .eq('id', projectId)
    .eq('user_id', user.id)

  if (updateErr) {
    return NextResponse.json({ error: updateErr.message }, { status: 500 })
  }

  return NextResponse.json({
    ok: true,
    connection_status: 'connected',
    last_verified_at: now,
    shop: parsed.data?.shop?.myshopifyDomain ?? parsed.data?.shop?.name ?? shopUrl,
    // Non-blocking: the connection works, but markets won't load without this
    // scope. The UI should surface it as a warning.
    readMarketsMissing,
    grantedScopes: scopes,
  })
}
