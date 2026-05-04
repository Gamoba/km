// Route-level skeleton for the dashboard (feed list). Mirrors the topbar
// + 3 feed card skeletons (title + 5 stat rows + footer button).
const SKELETON_BG = 'var(--color-background-secondary)'

function Bar({ className, style }: { className?: string; style?: React.CSSProperties }) {
  return (
    <div
      className={`animate-pulse ${className ?? ''}`}
      style={{ background: SKELETON_BG, borderRadius: '4px', ...style }}
    />
  )
}

function FeedCardSkeleton() {
  return (
    <div className="ff-panel">
      <div
        className="ff-panel-header"
        style={{ textTransform: 'none', letterSpacing: 0, fontSize: '12px', alignItems: 'flex-start' }}
      >
        <div className="min-w-0 space-y-1.5">
          <Bar className="h-3.5" style={{ width: '160px' }} />
          <Bar className="h-2.5" style={{ width: '210px' }} />
        </div>
        <div className="flex items-center gap-2 shrink-0">
          <Bar className="h-4" style={{ width: '60px' }} />
          <Bar className="h-4 w-4" style={{ borderRadius: '4px' }} />
        </div>
      </div>
      <div className="px-3.5 py-3 space-y-2">
        {Array.from({ length: 5 }).map((_, i) => (
          <div key={i} className="flex items-center justify-between gap-2">
            <Bar className="h-2.5" style={{ width: '120px' }} />
            <Bar className="h-3" style={{ width: '60px' }} />
          </div>
        ))}
      </div>
      <div className="px-3.5 py-2.5 flex items-center gap-2">
        <Bar className="h-7" style={{ width: '110px' }} />
      </div>
    </div>
  )
}

export default function Loading() {
  return (
    <div className="min-h-screen">
      <header className="ff-topbar">
        <div className="flex items-center gap-3">
          <Bar className="h-4" style={{ width: '60px' }} />
          <Bar className="h-3" style={{ width: '60px' }} />
        </div>
        <Bar className="h-7" style={{ width: '130px' }} />
      </header>

      <main className="px-4 py-4 max-w-6xl">
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
          <FeedCardSkeleton />
          <FeedCardSkeleton />
          <FeedCardSkeleton />
        </div>
      </main>
    </div>
  )
}
