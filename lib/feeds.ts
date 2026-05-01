import { createClient, type SupabaseClient } from '@supabase/supabase-js'

export function adminDb(): SupabaseClient {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  )
}

export type FeedRow = {
  id: string
  user_id: string
  name: string
  description: string | null
  created_at: string
  updated_at: string
}

// Returns the feed if owned by userId, otherwise null. Use this at every API
// route / server action entry that takes a feedId from the client.
export async function getOwnedFeed(
  userId: string,
  feedId: string
): Promise<FeedRow | null> {
  const db = adminDb()
  const { data } = await db
    .from('feeds')
    .select('*')
    .eq('id', feedId)
    .eq('user_id', userId)
    .maybeSingle()
  return (data as FeedRow | null) ?? null
}

// Picks the user's first (oldest) feed. Used for backwards-compat at
// /api/feed/[userId] which still needs to resolve to one feed.
export async function getFirstFeed(userId: string): Promise<FeedRow | null> {
  const db = adminDb()
  const { data } = await db
    .from('feeds')
    .select('*')
    .eq('user_id', userId)
    .order('created_at', { ascending: true })
    .limit(1)
    .maybeSingle()
  return (data as FeedRow | null) ?? null
}
