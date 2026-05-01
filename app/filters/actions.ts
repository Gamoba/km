'use server'

import { createSupabaseServerClient } from '@/lib/supabase-server'
import { adminDb, getOwnedFeed } from '@/lib/feeds'

export type FilterRule = { field: string; operator: string; value: string }
export type FilterConfig = { operator: 'AND' | 'OR'; rules: FilterRule[] }

export async function saveFilters(
  feedId: string,
  include: FilterConfig,
  exclude: FilterConfig
): Promise<{ error?: string }> {
  const supabase = await createSupabaseServerClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return { error: 'Unauthorized' }

  const owned = await getOwnedFeed(user.id, feedId)
  if (!owned) return { error: 'Feed ikke fundet' }

  const db = adminDb()
  const { error } = await db.from('feed_filters').upsert(
    [
      { feed_id: feedId, user_id: user.id, filter_type: 'include', operator: include.operator, rules: include.rules },
      { feed_id: feedId, user_id: user.id, filter_type: 'exclude', operator: exclude.operator, rules: exclude.rules },
    ],
    { onConflict: 'feed_id,filter_type' }
  )

  if (error) return { error: error.message }
  return {}
}
