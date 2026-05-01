import { redirect, notFound } from 'next/navigation'
import { createSupabaseServerClient } from '@/lib/supabase-server'
import { getOwnedFeed } from '@/lib/feeds'
import { generatePreview } from '@/lib/feedGenerator'
import { PreviewClient } from '@/app/preview/PreviewClient'

export default async function FeedPreviewPage({
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

  const data = await generatePreview(feedId)

  return <PreviewClient feedId={feedId} feedName={feed.name} data={data} />
}
