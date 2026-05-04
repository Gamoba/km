'use client'

import Link from 'next/link'
import { usePathname, useRouter } from 'next/navigation'
import { useEffect, useState } from 'react'
import { supabase } from '@/lib/supabase'
import { colors, layout } from '@/lib/design-tokens'

// ── Nav items ──────────────────────────────────────────────────────────────

// Per-feed nav rendered when a feedId is in the URL. Hrefs are built relative
// to /feed/[feedId]/ at render time.
const FEED_NAV = [
  { label: 'Overview', href: '', icon: 'rss' },
  { label: 'Products', href: 'products', icon: 'box' },
  { label: 'Mapping', href: 'mapping', icon: 'sliders' },
  { label: 'Filters', href: 'filters', icon: 'filter' },
  { label: 'Preview', href: 'preview', icon: 'eye' },
  { label: 'Settings', href: 'settings', icon: 'settings' },
] as const

const TOP_NAV = [
  { label: 'Feeds', href: '/', icon: 'grid' },
] as const

function active(pathname: string, href: string) {
  if (href === '/') return pathname === '/'
  return pathname === href || pathname.startsWith(href + '/')
}

// Extracts the feedId from /feed/[feedId][/...]
function feedIdFromPath(pathname: string): string | null {
  const m = pathname.match(/^\/feed\/([^/]+)/)
  return m ? m[1] : null
}

// ── Icons ──────────────────────────────────────────────────────────────────

const svg = (cls: string, children: React.ReactNode) => (
  <svg
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="2"
    strokeLinecap="round"
    strokeLinejoin="round"
    className={cls}
  >
    {children}
  </svg>
)

function NavIcon({ name }: { name: string }) {
  const cls = 'w-[14px] h-[14px] shrink-0'
  switch (name) {
    case 'grid':
      return svg(cls, <>
        <rect x="3" y="3" width="7" height="7" rx="1"/>
        <rect x="14" y="3" width="7" height="7" rx="1"/>
        <rect x="3" y="14" width="7" height="7" rx="1"/>
        <rect x="14" y="14" width="7" height="7" rx="1"/>
      </>)
    case 'box':
      return svg(cls, <>
        <path d="M21 16V8a2 2 0 00-1-1.73l-7-4a2 2 0 00-2 0l-7 4A2 2 0 003 8v8a2 2 0 001 1.73l7 4a2 2 0 002 0l7-4A2 2 0 0021 16z"/>
        <polyline points="3.27,6.96 12,12.01 20.73,6.96"/>
        <line x1="12" y1="22.08" x2="12" y2="12"/>
      </>)
    case 'sliders':
      return svg(cls, <>
        <line x1="4" y1="21" x2="4" y2="14"/>
        <line x1="4" y1="6" x2="4" y2="3"/>
        <line x1="12" y1="21" x2="12" y2="12"/>
        <line x1="12" y1="4" x2="12" y2="3"/>
        <line x1="20" y1="21" x2="20" y2="16"/>
        <line x1="20" y1="8" x2="20" y2="3"/>
        <line x1="1" y1="14" x2="7" y2="14"/>
        <line x1="9" y1="4" x2="15" y2="4"/>
        <line x1="17" y1="16" x2="23" y2="16"/>
      </>)
    case 'filter':
      return svg(cls, <>
        <polygon points="22,3 2,3 10,12.46 10,19 14,21 14,12.46"/>
      </>)
    case 'eye':
      return svg(cls, <>
        <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/>
        <circle cx="12" cy="12" r="3"/>
      </>)
    case 'rss':
      return svg(cls, <>
        <path d="M4 11a9 9 0 019 9"/>
        <path d="M4 4a16 16 0 0116 16"/>
        <circle cx="5" cy="19" r="1" fill="currentColor" stroke="none"/>
      </>)
    case 'settings':
      return svg(cls, <>
        <circle cx="12" cy="12" r="3"/>
        <path d="M19.4 15a1.65 1.65 0 00.33 1.82l.06.06a2 2 0 010 2.83 2 2 0 01-2.83 0l-.06-.06a1.65 1.65 0 00-1.82-.33 1.65 1.65 0 00-1 1.51V21a2 2 0 01-4 0v-.09A1.65 1.65 0 009 19.4a1.65 1.65 0 00-1.82.33l-.06.06a2 2 0 01-2.83-2.83l.06-.06A1.65 1.65 0 004.68 15a1.65 1.65 0 00-1.51-1H3a2 2 0 010-4h.09A1.65 1.65 0 004.6 9a1.65 1.65 0 00-.33-1.82l-.06-.06a2 2 0 012.83-2.83l.06.06A1.65 1.65 0 009 4.68a1.65 1.65 0 001-1.51V3a2 2 0 014 0v.09a1.65 1.65 0 001 1.51 1.65 1.65 0 001.82-.33l.06-.06a2 2 0 012.83 2.83l-.06.06A1.65 1.65 0 0019.4 9a1.65 1.65 0 001.51 1H21a2 2 0 010 4h-.09a1.65 1.65 0 00-1.51 1z"/>
      </>)
    default:
      return null
  }
}

function LogOutIcon() {
  return svg('w-[14px] h-[14px] shrink-0', <>
    <path d="M9 21H5a2 2 0 01-2-2V5a2 2 0 012-2h4"/>
    <polyline points="16,17 21,12 16,7"/>
    <line x1="21" y1="12" x2="9" y2="12"/>
  </>)
}

function LogoIcon() {
  return svg('w-3.5 h-3.5 text-white', <>
    <path d="M4 11a9 9 0 019 9"/>
    <path d="M4 4a16 16 0 0116 16"/>
    <circle cx="5" cy="19" r="1" fill="currentColor" stroke="none"/>
  </>)
}

// ── Sidebar ────────────────────────────────────────────────────────────────

type FeedSummary = { id: string; name: string }

export function Sidebar() {
  const pathname = usePathname()
  const router = useRouter()
  const [userEmail, setUserEmail] = useState<string>('')
  const [marketLabel, setMarketLabel] = useState<string>('')
  const [feeds, setFeeds] = useState<FeedSummary[]>([])

  const activeFeedId = feedIdFromPath(pathname)
  const activeFeed = feeds.find((f) => f.id === activeFeedId) ?? null

  useEffect(() => {
    supabase.auth.getUser().then(({ data }) => {
      setUserEmail(data.user?.email ?? '')
    })
    fetch('/api/feeds')
      .then((r) => r.json())
      .then((data: { feeds?: FeedSummary[] }) => {
        setFeeds(data.feeds ?? [])
      })
      .catch(() => {})
  }, [])

  // Refetch market label whenever the active feed changes — settings are now
  // per-feed, so the badge only shows when we're inside a feed.
  useEffect(() => {
    if (!activeFeedId) {
      setMarketLabel('')
      return
    }
    fetch(`/api/settings?feedId=${encodeURIComponent(activeFeedId)}`)
      .then((r) => r.json())
      .then((data: { settings?: { selected_country?: string | null; currency?: string | null } | null }) => {
        const s = data.settings
        if (!s) {
          setMarketLabel('')
          return
        }
        const parts = [s.selected_country, s.currency].filter(Boolean)
        setMarketLabel(parts.join(' · '))
      })
      .catch(() => setMarketLabel(''))
  }, [activeFeedId])

  async function handleSignOut() {
    await supabase.auth.signOut()
    router.push('/login')
  }

  const navLink = (href: string, icon: string, label: string) => {
    const isActive = active(pathname, href)
    return (
      <Link
        key={href}
        href={href}
        className="flex items-center gap-2.5 px-3 py-2 transition-colors"
        style={{
          fontSize: '12px',
          fontWeight: 400,
          borderRadius: '5px',
          borderLeft: `2px solid ${isActive ? colors.sidebar.activeBorder : 'transparent'}`,
          paddingLeft: '10px',
          background: isActive ? colors.sidebar.activeBg : 'transparent',
          color: isActive ? colors.sidebar.textActive : colors.sidebar.textInactive,
        }}
      >
        <NavIcon name={icon} />
        <span>{label}</span>
      </Link>
    )
  }

  // Per-feed nav appears only when we're inside /feed/[feedId]/...
  const feedNavSection = activeFeedId ? (
    <>
      <div
        className="mt-3 mb-1 px-3"
        style={{
          fontSize: '10px',
          textTransform: 'uppercase',
          letterSpacing: '0.6px',
          color: 'rgba(255,255,255,0.3)',
        }}
      >
        {activeFeed?.name ?? 'Feed'}
      </div>
      {FEED_NAV.map((item) => {
        const fullHref = item.href
          ? `/feed/${activeFeedId}/${item.href}`
          : `/feed/${activeFeedId}`
        return navLink(fullHref, item.icon, item.label)
      })}
    </>
  ) : null

  return (
    <aside
      className="flex-none flex flex-col h-full"
      style={{
        width: layout.sidebarWidth,
        background: colors.sidebar.bg,
        borderRight: `1px solid ${colors.sidebar.border}`,
      }}
    >
      {/* Logo */}
      <div
        className="px-4 py-4 shrink-0 flex items-center gap-2"
        style={{ borderBottom: `1px solid ${colors.sidebar.border}` }}
      >
        <div
          className="w-6 h-6 flex items-center justify-center shrink-0"
          style={{ background: colors.accent, borderRadius: '5px' }}
        >
          <LogoIcon />
        </div>
        <span
          style={{
            color: colors.sidebar.textActive,
            fontSize: '13px',
            fontWeight: 500,
            letterSpacing: '-0.01em',
          }}
        >
          FeedFlow
        </span>
      </div>

      {/* Nav */}
      <nav className="flex-1 px-2 py-3 space-y-0.5 overflow-y-auto">
        {TOP_NAV.map((item) => navLink(item.href, item.icon, item.label))}
        {feedNavSection}
      </nav>

      {/* Footer */}
      <div
        className="px-3 py-3 shrink-0 space-y-2"
        style={{ borderTop: `1px solid ${colors.sidebar.border}` }}
      >
        {marketLabel && (
          <div
            className="inline-flex px-2 py-0.5"
            style={{
              background: colors.sidebar.marketBg,
              color: colors.sidebar.marketText,
              fontFamily: 'var(--font-mono)',
              fontSize: '10px',
              letterSpacing: '0.4px',
              borderRadius: '3px',
            }}
          >
            {marketLabel}
          </div>
        )}
        {userEmail && (
          <div
            className="truncate"
            style={{
              color: colors.sidebar.textInactive,
              fontSize: '11px',
            }}
          >
            {userEmail}
          </div>
        )}
        <button
          onClick={handleSignOut}
          className="w-full flex items-center gap-2.5 px-2 py-1.5 transition-colors"
          style={{
            fontSize: '12px',
            color: colors.sidebar.textInactive,
            borderRadius: '5px',
          }}
        >
          <LogOutIcon />
          Log out
        </button>
      </div>
    </aside>
  )
}
