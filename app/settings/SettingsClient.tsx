'use client'

import { useEffect, useState } from 'react'
import type { ShopifyMarket, ShopifyMarketLocale } from '@/lib/shopify'
import { saveFeedMode } from '@/app/dashboard/actions'

type SavedSettings = {
  selected_market_id: string | null
  selected_locale: string
  selected_country: string
  currency: string
  market_url: string | null
}

type SyncState = 'idle' | 'running' | 'done' | 'error'

// ── MarketCard ─────────────────────────────────────────────────────────────────

function MarketCard({
  market,
  selected,
  onSelect,
}: {
  market: ShopifyMarket
  selected: boolean
  onSelect: () => void
}) {
  const allLocales = [
    ...(market.defaultLocale ? [market.defaultLocale] : []),
    ...market.alternateLocales,
  ]
  const isPrimary = market.type === 'PRIMARY'
  const isActive = market.status === 'ACTIVE'

  return (
    <label
      className="flex items-start gap-2.5 p-3 cursor-pointer transition-colors"
      style={{
        background: selected ? 'var(--color-badge-accent-bg)' : '#ffffff',
        border: `1px solid ${selected ? 'var(--color-accent)' : 'var(--color-border-tertiary)'}`,
        borderRadius: '6px',
      }}
    >
      <input
        type="radio"
        checked={selected}
        onChange={onSelect}
        className="mt-0.5 shrink-0"
        style={{ accentColor: '#6c5ce7' }}
      />
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2 flex-wrap">
          <span style={{ fontSize: '12px', fontWeight: 500, color: 'var(--color-text-primary)' }}>
            {market.name}
          </span>
          {isPrimary && <span className="ff-badge ff-badge-accent">Primær</span>}
          {!isActive && <span className="ff-badge ff-badge-neutral">Kladde</span>}
        </div>
        <div
          className="mt-1 flex flex-wrap gap-x-3 gap-y-0.5"
          style={{ fontSize: '11px', color: 'var(--color-text-tertiary)' }}
        >
          <span>
            <span style={{ fontWeight: 500, color: 'var(--color-text-secondary)' }}>Valuta:</span>{' '}
            {market.currency} — {market.currencyName}
          </span>
          {allLocales.length > 0 && (
            <span>
              <span style={{ fontWeight: 500, color: 'var(--color-text-secondary)' }}>Sprog:</span>{' '}
              {allLocales.map((l) => `${l.name} (${l.locale})`).join(', ')}
            </span>
          )}
        </div>
      </div>
    </label>
  )
}

// ── Main component ─────────────────────────────────────────────────────────────

export function SettingsClient({
  feedId,
  feedName,
  initialSettings,
  initialFeedMode,
}: {
  feedId: string
  feedName: string
  initialSettings: SavedSettings | null
  initialFeedMode: 'product' | 'variant'
}) {
  const [markets, setMarkets] = useState<ShopifyMarket[]>([])
  const [loadingMarkets, setLoadingMarkets] = useState(true)
  const [marketsError, setMarketsError] = useState<string | null>(null)

  const [selectedMarketId, setSelectedMarketId] = useState<string>(
    initialSettings?.selected_market_id ?? ''
  )
  const [selectedLocale, setSelectedLocale] = useState<string>(
    initialSettings?.selected_locale ?? 'en'
  )
  const [selectedCountry, setSelectedCountry] = useState<string>(
    initialSettings?.selected_country ?? ''
  )
  const [currency, setCurrency] = useState<string>(initialSettings?.currency ?? 'USD')
  const [marketUrl, setMarketUrl] = useState<string | null>(initialSettings?.market_url ?? null)
  const [feedMode, setFeedMode] = useState<'product' | 'variant'>(initialFeedMode)

  // Last-saved baselines for dirty-tracking. Updated after a successful save
  // so the buttons re-disable until the user changes something else.
  const [savedMarketId, setSavedMarketId] = useState<string>(
    initialSettings?.selected_market_id ?? ''
  )
  const [savedLocale, setSavedLocale] = useState<string>(initialSettings?.selected_locale ?? 'en')
  const [savedFeedMode, setSavedFeedMode] = useState<'product' | 'variant'>(initialFeedMode)

  const [saving, setSaving] = useState(false)
  const [saveStatus, setSaveStatus] = useState<'idle' | 'saved' | 'error'>('idle')
  const [saveError, setSaveError] = useState<string | null>(null)
  const [syncState, setSyncState] = useState<SyncState>('idle')
  const [syncMsg, setSyncMsg] = useState<string>('')

  const shopSettingsDirty =
    selectedMarketId !== savedMarketId || selectedLocale !== savedLocale
  const feedModeDirty = feedMode !== savedFeedMode
  const dirty = shopSettingsDirty || feedModeDirty

  useEffect(() => {
    fetch('/api/shopify/markets')
      .then((r) => r.json())
      .then((data: { markets?: ShopifyMarket[]; error?: string }) => {
        if (data.error) throw new Error(data.error)
        const fetched = data.markets ?? []
        setMarkets(fetched)
        // Hydrér marketUrl + selectedCountry fra det allerede-valgte market hvis
        // DB-værdierne manglede. Uden dette ville en gemt selected_market_id
        // sende null/tom tilbage ved næste gem, fordi selectMarket() kun kører
        // på et nyt klik.
        const initialId = initialSettings?.selected_market_id ?? ''
        const match = initialId ? fetched.find((m) => m.id === initialId) : null
        setMarketUrl((current) => current ?? match?.marketUrl ?? null)
        setSelectedCountry((current) => current || match?.countryCodes[0] || '')
      })
      .catch((err: unknown) => {
        setMarketsError(err instanceof Error ? err.message : 'Kunne ikke hente markets')
      })
      .finally(() => setLoadingMarkets(false))
  }, [initialSettings])

  function selectMarket(market: ShopifyMarket) {
    setSelectedMarketId(market.id)
    setCurrency(market.currency)
    setMarketUrl(market.marketUrl ?? null)
    setSelectedCountry(market.countryCodes[0] ?? '')
    if (market.defaultLocale) {
      setSelectedLocale(market.defaultLocale.locale)
    }
  }

  const selectedMarket = markets.find((m) => m.id === selectedMarketId) ?? null

  const availableLocales: ShopifyMarketLocale[] = selectedMarket
    ? [
        ...(selectedMarket.defaultLocale ? [selectedMarket.defaultLocale] : []),
        ...selectedMarket.alternateLocales,
      ]
    : []

  async function saveSettings() {
    setSaving(true)
    setSaveStatus('idle')
    setSaveError(null)
    try {
      // shop_settings only when something in that section changed.
      if (shopSettingsDirty) {
        const res = await fetch('/api/settings', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            feed_id: feedId,
            selected_market_id: selectedMarketId || null,
            selected_locale: selectedLocale,
            selected_country: selectedCountry,
            currency,
            market_url: marketUrl,
          }),
        })
        const data = (await res.json()) as { ok?: boolean; error?: string }
        if (data.error) throw new Error(data.error)
      }

      // feed_mode only when changed.
      if (feedModeDirty) {
        const result = await saveFeedMode(feedId, feedMode)
        if (result.error) throw new Error(result.error)
      }

      // Update baselines so the buttons go back to disabled until next change.
      setSavedMarketId(selectedMarketId)
      setSavedLocale(selectedLocale)
      setSavedFeedMode(feedMode)

      setSaveStatus('saved')
      setTimeout(() => setSaveStatus('idle'), 2500)
    } catch (err) {
      setSaveError(err instanceof Error ? err.message : 'Gem fejlede')
      setSaveStatus('error')
    } finally {
      setSaving(false)
    }
  }

  async function saveAndSync() {
    await saveSettings()
    setSyncState('running')
    setSyncMsg('')
    try {
      const res = await fetch(`/api/shopify/sync?feedId=${encodeURIComponent(feedId)}`, { method: 'POST' })
      const data = (await res.json()) as { synced?: number; durationMs?: number; error?: string }
      if (data.error) throw new Error(data.error)
      setSyncMsg(`Synkronisering færdig — ${data.synced ?? 0} produkter på ${((data.durationMs ?? 0) / 1000).toFixed(1)}s`)
      setSyncState('done')
    } catch (err) {
      setSyncMsg(err instanceof Error ? err.message : 'Sync fejlede')
      setSyncState('error')
    }
  }

  return (
    <div className="min-h-screen">
      <header className="ff-topbar">
        <div className="flex items-center gap-3">
          <h1 className="ff-topbar-title">{feedName} · Indstillinger</h1>
          <span style={{ fontSize: '11px', color: 'var(--color-text-tertiary)' }}>
            Market og sprog til dette feed
          </span>
        </div>
        <div className="flex items-center gap-2">
          {saveStatus === 'saved' && (
            <span style={{ fontSize: '11px', fontWeight: 500, color: 'var(--color-badge-success-text)' }}>
              Gemt
            </span>
          )}
          {saveStatus === 'error' && (
            <span style={{ fontSize: '11px', color: 'var(--color-badge-danger-text)' }}>{saveError}</span>
          )}
          {syncState === 'done' && (
            <span style={{ fontSize: '11px', fontWeight: 500, color: 'var(--color-badge-success-text)' }}>
              {syncMsg}
            </span>
          )}
          {syncState === 'error' && (
            <span style={{ fontSize: '11px', color: 'var(--color-badge-danger-text)' }}>{syncMsg}</span>
          )}
          <button
            onClick={saveSettings}
            disabled={saving || syncState === 'running' || !selectedMarket || !dirty}
            className="ff-btn-secondary"
          >
            {saving ? 'Gemmer…' : 'Gem'}
          </button>
          <button
            onClick={saveAndSync}
            disabled={saving || syncState === 'running' || !selectedMarket || !dirty}
            className="ff-btn-primary"
          >
            {syncState === 'running' ? (
              <>
                <svg className="w-3.5 h-3.5 animate-spin" fill="none" viewBox="0 0 24 24">
                  <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                  <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8H4z" />
                </svg>
                Synkroniserer…
              </>
            ) : (
              'Gem og synkroniser'
            )}
          </button>
        </div>
      </header>

      <main className="px-4 py-4 max-w-3xl space-y-3">

        {/* Step 1: Select market */}
        <div className="ff-panel">
          <div className="ff-panel-header" style={{ textTransform: 'none', letterSpacing: 0, fontSize: '11px' }}>
            <div>
              <span style={{ fontSize: '12px', fontWeight: 500, color: 'var(--color-text-primary)' }}>Market</span>
              <span className="ml-2" style={{ fontSize: '11px', color: 'var(--color-text-tertiary)' }}>
                Vælg Shopify market
              </span>
            </div>
          </div>

          <div className="p-3.5">
            {loadingMarkets && (
              <div
                className="flex items-center gap-2"
                style={{ fontSize: '12px', color: 'var(--color-text-tertiary)' }}
              >
                <svg className="w-3.5 h-3.5 animate-spin" fill="none" viewBox="0 0 24 24">
                  <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                  <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8H4z" />
                </svg>
                Henter markets fra Shopify…
              </div>
            )}

            {marketsError && (
              <div
                className="p-2.5"
                style={{
                  background: 'var(--color-badge-danger-bg)',
                  border: '1px solid var(--color-badge-danger-text)',
                  borderRadius: '4px',
                }}
              >
                <p style={{ fontSize: '12px', fontWeight: 500, color: 'var(--color-badge-danger-text)' }}>
                  Kunne ikke hente markets
                </p>
                <p
                  className="ff-mono mt-1"
                  style={{ fontSize: '11px', color: 'var(--color-badge-danger-text)' }}
                >
                  {marketsError}
                </p>
              </div>
            )}

            {!loadingMarkets && !marketsError && markets.length === 0 && (
              <p style={{ fontSize: '12px', color: 'var(--color-text-tertiary)' }}>
                Ingen markets fundet — din butik har muligvis ikke Shopify Markets aktiveret.
              </p>
            )}

            {markets.length > 0 && (
              <div className="space-y-2">
                {markets.map((market) => (
                  <MarketCard
                    key={market.id}
                    market={market}
                    selected={selectedMarketId === market.id}
                    onSelect={() => selectMarket(market)}
                  />
                ))}
              </div>
            )}
          </div>
        </div>

        {/* Step 2: Locale — only when a market with locales is selected */}
        {selectedMarket && availableLocales.length > 0 && (
          <div className="ff-panel">
            <div className="ff-panel-header" style={{ textTransform: 'none', letterSpacing: 0, fontSize: '11px' }}>
              <div>
                <span style={{ fontSize: '12px', fontWeight: 500, color: 'var(--color-text-primary)' }}>Sprog</span>
                <span className="ml-2" style={{ fontSize: '11px', color: 'var(--color-text-tertiary)' }}>
                  Tilknyttet {selectedMarket.name}
                </span>
              </div>
            </div>

            <div className="p-3.5 space-y-3">
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="ff-label block mb-1.5">Sprog</label>
                  <select
                    value={selectedLocale}
                    onChange={(e) => setSelectedLocale(e.target.value)}
                    className="ff-select"
                  >
                    {availableLocales.map((l) => (
                      <option key={l.locale} value={l.locale}>
                        {l.name} ({l.locale}){l.primary ? ' — standard' : ''}
                      </option>
                    ))}
                  </select>
                </div>

                <div className="flex flex-col justify-end">
                  <div
                    className="px-3 py-2"
                    style={{
                      background: 'var(--color-background-secondary)',
                      border: '1px solid var(--color-border-tertiary)',
                      borderRadius: '4px',
                    }}
                  >
                    <p className="ff-label">Valuta</p>
                    <p className="mt-0.5" style={{ fontSize: '12px', fontWeight: 500, color: 'var(--color-text-primary)' }}>
                      {currency} — {selectedMarket.currencyName}
                    </p>
                  </div>
                </div>
              </div>

              <div
                className="flex items-start gap-2 p-2.5"
                style={{
                  background: 'var(--color-badge-warning-bg)',
                  border: '1px solid var(--color-badge-warning-text)',
                  borderRadius: '4px',
                }}
              >
                <svg
                  className="w-3.5 h-3.5 shrink-0 mt-0.5"
                  style={{ color: 'var(--color-badge-warning-text)' }}
                  fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}
                >
                  <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v2m0 4h.01M10.29 3.86L1.82 18a2 2 0 001.71 3h16.94a2 2 0 001.71-3L13.71 3.86a2 2 0 00-3.42 0z" />
                </svg>
                <p style={{ fontSize: '11px', color: 'var(--color-badge-warning-text)' }}>
                  Ændring af sprog kræver en ny synkronisering — produkttitler og beskrivelser hentes på det valgte sprog via Shopifys oversættelses-API.
                </p>
              </div>
            </div>
          </div>
        )}

        {/* Feed mode */}
        <div className="ff-panel">
          <div className="ff-panel-header" style={{ textTransform: 'none', letterSpacing: 0, fontSize: '11px' }}>
            <div>
              <span style={{ fontSize: '12px', fontWeight: 500, color: 'var(--color-text-primary)' }}>Feed mode</span>
              <span className="ml-2" style={{ fontSize: '11px', color: 'var(--color-text-tertiary)' }}>
                Hvordan feedet struktureres
              </span>
            </div>
          </div>

          <div className="p-3.5">
            <div className="grid grid-cols-2 gap-3">
              <FeedModeCard
                selected={feedMode === 'product'}
                title="Produkt"
                description="Ét feed item per produkt. Bruger første variants data."
                onClick={() => setFeedMode('product')}
              />
              <FeedModeCard
                selected={feedMode === 'variant'}
                title="Variant"
                description="Ét feed item per variant. Grupperer varianter med item_group_id."
                onClick={() => setFeedMode('variant')}
              />
            </div>
          </div>
        </div>

      </main>
    </div>
  )
}

function FeedModeCard({
  selected,
  title,
  description,
  onClick,
}: {
  selected: boolean
  title: string
  description: string
  onClick: () => void
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="text-left p-4 transition-colors"
      style={{
        background: selected ? 'var(--color-badge-accent-bg)' : '#ffffff',
        border: `1px solid ${selected ? 'var(--color-accent)' : 'var(--color-border-tertiary)'}`,
        borderRadius: '6px',
        cursor: 'pointer',
      }}
    >
      <div className="flex items-center gap-2 mb-1.5">
        <span
          className="inline-flex items-center justify-center shrink-0"
          style={{
            width: '14px',
            height: '14px',
            borderRadius: '50%',
            border: `2px solid ${selected ? 'var(--color-accent)' : 'var(--color-border-secondary)'}`,
            background: selected ? 'var(--color-accent)' : 'transparent',
          }}
        >
          {selected && (
            <span
              style={{
                width: '4px',
                height: '4px',
                borderRadius: '50%',
                background: '#ffffff',
              }}
            />
          )}
        </span>
        <span
          style={{
            fontSize: '13px',
            fontWeight: 600,
            color: 'var(--color-text-primary)',
            textTransform: 'uppercase',
            letterSpacing: '0.04em',
          }}
        >
          {title}
        </span>
      </div>
      <p style={{ fontSize: '11px', color: 'var(--color-text-secondary)', lineHeight: 1.5 }}>
        {description}
      </p>
    </button>
  )
}
