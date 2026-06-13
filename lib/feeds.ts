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
  project_id: string | null
  created_at: string
  updated_at: string
}

// connection_status of a project's Shopify connection.
export type ProjectConnectionStatus = 'unverified' | 'connected' | 'error'

// A project row WITHOUT the encrypted token columns. Ownership checks and
// listings must never pull the secret material around — decryption happens
// only in lib/projectShopify.getProjectCredentials at call time.
export type ProjectRow = {
  id: string
  user_id: string
  name: string
  description: string | null
  shop_url: string | null
  connection_status: ProjectConnectionStatus
  last_verified_at: string | null
  created_at: string
  updated_at: string
}

const PROJECT_PUBLIC_COLUMNS =
  'id, user_id, name, description, shop_url, connection_status, last_verified_at, created_at, updated_at'

// Returns the feed if owned by userId, otherwise null. Use this at every API
// route / server action entry that takes a feedId from the client.
//
// Defense-in-depth: a feed's project must also be owned by the same user.
// feeds.project_id is NOT NULL, so the guard below normally always runs; the
// null-check is kept purely defensively.
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
  const feed = (data as FeedRow | null) ?? null
  if (!feed) return null

  if (feed.project_id) {
    const { data: project } = await db
      .from('projects')
      .select('id')
      .eq('id', feed.project_id)
      .eq('user_id', userId)
      .maybeSingle()
    if (!project) return null
  }

  return feed
}

// Returns the project if owned by userId, otherwise null. Mirrors getOwnedFeed.
// Never selects the encrypted token columns.
export async function getOwnedProject(
  userId: string,
  projectId: string
): Promise<ProjectRow | null> {
  const db = adminDb()
  const { data } = await db
    .from('projects')
    .select(PROJECT_PUBLIC_COLUMNS)
    .eq('id', projectId)
    .eq('user_id', userId)
    .maybeSingle()
  return (data as ProjectRow | null) ?? null
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
