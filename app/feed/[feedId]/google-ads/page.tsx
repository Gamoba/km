import { redirect, notFound } from 'next/navigation'
import { createSupabaseServerClient } from '@/lib/supabase-server'
import { adminDb, getOwnedFeed } from '@/lib/feeds'
import { getFeedSettings } from '@/lib/feedGoogleAds'
import { missingSetup } from '@/lib/googleAdsSync'
import {
  getAvailableActions,
  getProductPerformance,
  type Window,
} from '@/lib/googleAdsAnalytics'
import { GoogleAdsClient } from './GoogleAdsClient'

const WINDOWS: Window[] = [7, 14, 30, 90, 180, 365]
const DEFAULT_WINDOW: Window = 30

export default async function GoogleAdsPage({
  params,
  searchParams,
}: {
  params: Promise<{ feedId: string }>
  searchParams: Promise<{
    days?: string
    ga_connected?: string
    ga_error?: string
    roas?: string
    poas?: string
  }>
}) {
  const { feedId } = await params
  const {
    days: daysParam,
    ga_connected,
    ga_error,
    roas: roasParam,
    poas: poasParam,
  } = await searchParams

  const supabase = await createSupabaseServerClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  const feed = await getOwnedFeed(user.id, feedId)
  if (!feed) notFound()

  const parsed = Number(daysParam)
  const days: Window = WINDOWS.includes(parsed as Window) ? (parsed as Window) : DEFAULT_WINDOW

  const db = adminDb()
  const settings = await getFeedSettings(db, feedId)
  const setupIssues = missingSetup(settings)

  const hasConnection = !!settings?.connection_id
  const connected = !!settings?.customer_id

  if (!connected) {
    return (
      <GoogleAdsClient
        feedId={feedId}
        feedName={feed.name}
        days={days}
        windows={WINDOWS}
        connected={false}
        hasConnection={hasConnection}
        setupIssues={setupIssues}
        connectError={ga_error ?? null}
        justConnected={ga_connected === '1'}
        settings={
          settings
            ? {
                customerName: null,
                customerId: null,
                currency: settings.currency_code,
                roasAction: settings.roas_conversion_action,
                poasAction: settings.poas_conversion_action,
                lastSyncedAt: null,
                lastSyncError: null,
                feedLabel: settings.feed_label,
              }
            : null
        }
        availableActions={[]}
        activeActions={{ roas: null, poas: null }}
        rows={[]}
        totals={null}
        from=""
        to=""
      />
    )
  }

  // The chosen actions come from the URL when the user is switching definitions
  // on the page, and fall back to the feed's saved default. Storing a default
  // still matters — it's what a fresh visit, and the eventual bucket engine, use.
  const actions = {
    roas: roasParam ?? settings?.roas_conversion_action ?? null,
    poas: poasParam ?? settings?.poas_conversion_action ?? null,
  }

  const [{ rows, totals, from, to }, availableActions] = await Promise.all([
    getProductPerformance(db, feedId, days, actions),
    getAvailableActions(db, feedId, days),
  ])

  return (
    <GoogleAdsClient
      feedId={feedId}
      feedName={feed.name}
      days={days}
      windows={WINDOWS}
      connected
      hasConnection={hasConnection}
      setupIssues={setupIssues}
      connectError={ga_error ?? null}
      justConnected={ga_connected === '1'}
      settings={{
        customerName: settings?.customer_name ?? null,
        customerId: settings?.customer_id ?? null,
        currency: settings?.currency_code ?? null,
        roasAction: settings?.roas_conversion_action ?? null,
        poasAction: settings?.poas_conversion_action ?? null,
        lastSyncedAt: settings?.last_synced_at ?? null,
        lastSyncError: settings?.last_sync_error ?? null,
        feedLabel: settings?.feed_label ?? null,
      }}
      availableActions={availableActions}
      activeActions={actions}
      rows={rows}
      totals={totals}
      from={from}
      to={to}
    />
  )
}
