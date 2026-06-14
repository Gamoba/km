import { redirect, notFound } from 'next/navigation'
import { createSupabaseServerClient } from '@/lib/supabase-server'
import { getOwnedFeed } from '@/lib/feeds'
import { getOptimizationSettings, getOptimizationFilters } from '@/lib/titleOptimizationService'
import { OptimizeClient } from '@/app/optimize/OptimizeClient'

export default async function FeedOptimizePage({
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

  const [settings, filters] = await Promise.all([
    getOptimizationSettings(feedId),
    getOptimizationFilters(feedId),
  ])

  return (
    <OptimizeClient
      feedId={feedId}
      feedName={feed.name}
      initialSettings={settings}
      initialInclude={filters.include}
      initialExclude={filters.exclude}
    />
  )
}
