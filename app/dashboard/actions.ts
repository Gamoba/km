'use server'

import { createSupabaseServerClient } from '@/lib/supabase-server'
import { adminDb, getOwnedFeed } from '@/lib/feeds'

export async function saveFeedMode(
  feedId: string,
  mode: 'product' | 'variant'
): Promise<{ error?: string }> {
  const supabase = await createSupabaseServerClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return { error: 'Unauthorized' }

  const owned = await getOwnedFeed(user.id, feedId)
  if (!owned) return { error: 'Feed ikke fundet' }

  const db = adminDb()
  const { error } = await db
    .from('feed_settings')
    .upsert(
      { feed_id: feedId, user_id: user.id, feed_mode: mode },
      { onConflict: 'feed_id' }
    )

  if (error) return { error: error.message }
  return {}
}
