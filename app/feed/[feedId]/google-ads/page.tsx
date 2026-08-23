import { redirect, notFound } from 'next/navigation'
import { createSupabaseServerClient } from '@/lib/supabase-server'
import { adminDb, getOwnedFeed } from '@/lib/feeds'
import { getFeedSettings } from '@/lib/feedGoogleAds'
import { missingSetup } from '@/lib/googleAdsSync'
import {
  getAvailableActions,
  getProductPerformance,
  resolveActions,
  type Window,
} from '@/lib/googleAdsAnalytics'
import { getProductMargins, marginCoverage } from '@/lib/variantCosts'
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
    // Repeated params: ?roas=A&roas=B. Next hands those over as an array, and as
    // a bare string when there is exactly one.
    roas?: string | string[]
    poas?: string | string[]
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
                roasActions: settings.roas_conversion_actions ?? [],
                poasActions: settings.poas_conversion_actions ?? [],
                lastSyncedAt: null,
                lastSyncError: null,
                feedLabel: settings.feed_label,
              }
            : null
        }
        availableActions={[]}
        activeActions={{ roas: [], poas: [] }}
        rows={[]}
        margins={{}}
        marginCoverage={{ withMargin: 0, products: 0 }}
        totals={null}
        from=""
        to=""
      />
    )
  }

  const actions = resolveActions({ roas: roasParam, poas: poasParam }, settings)

  const [{ rows, totals, from, to }, availableActions, margins] = await Promise.all([
    getProductPerformance(db, feedId, days, actions),
    getAvailableActions(db, feedId, days),
    getProductMargins(db, feedId),
  ])

  // Sent as a plain lookup rather than merged into the rows, so the analytics
  // layer stays unaware that costs exist. Products with no cost are simply
  // absent, and the client renders those as unknown rather than as zero margin.
  const marginByRef: Record<string, { margin: number | null; coverage: number }> = {}
  for (const [ref, m] of margins) {
    marginByRef[ref] = { margin: m.margin, coverage: m.coverage }
  }
  const coverage = marginCoverage(margins)

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
        roasActions: settings?.roas_conversion_actions ?? [],
        poasActions: settings?.poas_conversion_actions ?? [],
        lastSyncedAt: settings?.last_synced_at ?? null,
        lastSyncError: settings?.last_sync_error ?? null,
        feedLabel: settings?.feed_label ?? null,
      }}
      availableActions={availableActions}
      activeActions={actions}
      rows={rows}
      margins={marginByRef}
      marginCoverage={{ withMargin: coverage.withMargin, products: coverage.products }}
      totals={totals}
      from={from}
      to={to}
    />
  )
}
