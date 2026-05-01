import { redirect, notFound } from 'next/navigation'
import { createSupabaseServerClient } from '@/lib/supabase-server'
import { adminDb, getOwnedFeed } from '@/lib/feeds'
import MappingClient from '@/app/mapping/MappingClient'

export default async function FeedMappingPage({
  params,
}: {
  params: Promise<{ feedId: string }>
}) {
  const { feedId } = await params

  const supabase = await createSupabaseServerClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  const feed = await getOwnedFeed(user.id, feedId)
  if (!feed) notFound()

  const db = adminDb()

  const [mappingsRes, metafieldsRes, settingsRes] = await Promise.all([
    db
      .from('feed_mappings')
      .select('google_field, mapping_type, config')
      .eq('feed_id', feedId),
    db
      .from('product_metafields')
      .select('namespace, key')
      .eq('feed_id', feedId)
      .order('namespace')
      .order('key'),
    db
      .from('feed_settings')
      .select('feed_mode')
      .eq('feed_id', feedId)
      .maybeSingle(),
  ])

  if (mappingsRes.error) {
    console.error('Fejl ved hentning af mappings:', mappingsRes.error)
  }

  const seen = new Set<string>()
  const uniqueMetafields: { namespace: string; key: string }[] = []
  for (const mf of metafieldsRes.data ?? []) {
    const k = `${mf.namespace}.${mf.key}`
    if (!seen.has(k)) {
      seen.add(k)
      uniqueMetafields.push(mf)
    }
  }

  const feedMode = (settingsRes.data?.feed_mode as 'product' | 'variant') ?? 'product'

  return (
    <MappingClient
      feedId={feedId}
      feedName={feed.name}
      feedMode={feedMode}
      initialMappings={mappingsRes.data ?? []}
      metafields={uniqueMetafields}
    />
  )
}
