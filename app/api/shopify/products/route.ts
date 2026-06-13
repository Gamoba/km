import { createSupabaseServerClient } from '@/lib/supabase-server'
import { adminDb, getOwnedProject } from '@/lib/feeds'
import { createShopifyClientForProject } from '@/lib/projectShopify'

export async function GET(req: Request) {
  const supabase = await createSupabaseServerClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()

  if (!user) {
    return Response.json({ error: 'Unauthorized' }, { status: 401 })
  }

  // Diagnostic products fetch — credentials come from a project, so projectId
  // is required (no global env fallback).
  const projectId = new URL(req.url).searchParams.get('projectId')
  if (!projectId) {
    return Response.json({ error: 'projectId er påkrævet' }, { status: 400 })
  }
  const owned = await getOwnedProject(user.id, projectId)
  if (!owned) {
    return Response.json({ error: 'Project not found' }, { status: 404 })
  }

  try {
    const shopify = await createShopifyClientForProject(adminDb(), projectId)
    const data = await shopify.fetchProductsWithAllData()
    return Response.json(data)
  } catch (err) {
    return Response.json(
      { error: err instanceof Error ? err.message : 'Unknown error' },
      { status: 500 }
    )
  }
}
