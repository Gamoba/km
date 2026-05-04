// Route-level skeleton for the settings page. Mirrors the topbar + market
// selection (4 cards) + language section + feed mode (2 cards).
const SKELETON_BG = 'var(--color-background-secondary)'

function Bar({ className, style }: { className?: string; style?: React.CSSProperties }) {
  return (
    <div
      className={`animate-pulse ${className ?? ''}`}
      style={{ background: SKELETON_BG, borderRadius: '4px', ...style }}
    />
  )
}

function MarketCardSkeleton() {
  return (
    <div
      className="flex items-start gap-2.5 p-3"
      style={{
        background: '#ffffff',
        border: '1px solid var(--color-border-tertiary)',
        borderRadius: '6px',
      }}
    >
      <Bar
        className="mt-0.5 shrink-0"
        style={{ width: '14px', height: '14px', borderRadius: '50%' }}
      />
      <div className="flex-1 min-w-0 space-y-1.5">
        <Bar className="h-3" style={{ width: '140px' }} />
        <Bar className="h-2.5" style={{ width: '70%' }} />
      </div>
    </div>
  )
}

function ModeCardSkeleton() {
  return (
    <div
      className="p-4"
      style={{
        background: '#ffffff',
        border: '1px solid var(--color-border-tertiary)',
        borderRadius: '6px',
      }}
    >
      <div className="flex items-center gap-2 mb-2">
        <Bar
          className="shrink-0"
          style={{ width: '14px', height: '14px', borderRadius: '50%' }}
        />
        <Bar className="h-3.5" style={{ width: '72px' }} />
      </div>
      <Bar className="h-2.5 mb-1.5" style={{ width: '90%' }} />
      <Bar className="h-2.5" style={{ width: '55%' }} />
    </div>
  )
}

export default function Loading() {
  return (
    <div className="min-h-screen">
      <header className="ff-topbar">
        <div className="flex items-center gap-3">
          <Bar className="h-4" style={{ width: '200px' }} />
          <Bar className="h-3" style={{ width: '180px' }} />
        </div>
        <div className="flex items-center gap-2">
          <Bar className="h-7" style={{ width: '64px' }} />
          <Bar className="h-7" style={{ width: '140px' }} />
        </div>
      </header>

      <main className="px-4 py-4 max-w-3xl space-y-3">
        {/* Market section */}
        <div className="ff-panel">
          <div className="ff-panel-header">
            <Bar className="h-3" style={{ width: '120px' }} />
          </div>
          <div className="p-3.5 space-y-2">
            <MarketCardSkeleton />
            <MarketCardSkeleton />
            <MarketCardSkeleton />
            <MarketCardSkeleton />
          </div>
        </div>

        {/* Language section */}
        <div className="ff-panel">
          <div className="ff-panel-header">
            <Bar className="h-3" style={{ width: '90px' }} />
          </div>
          <div className="p-3.5 grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Bar className="h-2.5" style={{ width: '60px' }} />
              <Bar className="h-8" />
            </div>
            <div className="space-y-1.5">
              <Bar className="h-2.5" style={{ width: '60px' }} />
              <Bar
                className="h-12"
                style={{
                  background: 'var(--color-background-tertiary)',
                  border: '1px solid var(--color-border-tertiary)',
                }}
              />
            </div>
          </div>
        </div>

        {/* Feed mode section */}
        <div className="ff-panel">
          <div className="ff-panel-header">
            <Bar className="h-3" style={{ width: '100px' }} />
          </div>
          <div className="p-3.5 grid grid-cols-2 gap-3">
            <ModeCardSkeleton />
            <ModeCardSkeleton />
          </div>
        </div>
      </main>
    </div>
  )
}
