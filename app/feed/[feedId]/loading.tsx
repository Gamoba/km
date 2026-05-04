// Route-level skeleton for the feed overview page. Mirrors the topbar +
// status overview card + statistics grid + next steps + validation mini +
// feed URL section.
const SKELETON_BG = 'var(--color-background-secondary)'

function Bar({ className, style }: { className?: string; style?: React.CSSProperties }) {
  return (
    <div
      className={`animate-pulse ${className ?? ''}`}
      style={{ background: SKELETON_BG, borderRadius: '4px', ...style }}
    />
  )
}

function StatCardSkeleton() {
  return (
    <div
      style={{
        padding: '10px 12px',
        background: 'var(--color-background-tertiary)',
        border: '1px solid var(--color-border-tertiary)',
        borderRadius: '4px',
      }}
      className="space-y-1.5"
    >
      <Bar className="h-2.5" style={{ width: '70%' }} />
      <Bar className="h-4" style={{ width: '50%' }} />
    </div>
  )
}

export default function Loading() {
  return (
    <div className="min-h-screen">
      <header className="ff-topbar">
        <div className="flex items-center gap-3">
          <Bar className="h-4" style={{ width: '180px' }} />
          <Bar className="h-3" style={{ width: '200px' }} />
        </div>
      </header>

      <main className="px-4 py-4 max-w-4xl space-y-3">
        {/* Status overview */}
        <div className="ff-panel" style={{ padding: '16px' }}>
          <div className="flex items-center gap-3">
            <Bar
              className="shrink-0"
              style={{ width: '40px', height: '40px', borderRadius: '50%' }}
            />
            <div className="min-w-0 space-y-1.5">
              <Bar className="h-4" style={{ width: '160px' }} />
              <Bar className="h-2.5" style={{ width: '240px' }} />
            </div>
          </div>
          <div className="mt-4">
            <div className="flex items-center justify-between mb-1.5">
              <Bar className="h-2.5" style={{ width: '110px' }} />
              <Bar className="h-2.5" style={{ width: '120px' }} />
            </div>
            <Bar className="h-1.5" style={{ borderRadius: '999px' }} />
          </div>
        </div>

        {/* Statistics grid */}
        <div className="ff-panel">
          <div className="ff-panel-header">
            <Bar className="h-3" style={{ width: '90px' }} />
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3 p-3.5">
            <StatCardSkeleton />
            <StatCardSkeleton />
            <StatCardSkeleton />
            <StatCardSkeleton />
            <StatCardSkeleton />
          </div>
        </div>

        {/* Validation mini */}
        <div className="ff-panel">
          <div className="ff-panel-header">
            <Bar className="h-3" style={{ width: '110px' }} />
            <Bar className="h-7" style={{ width: '110px' }} />
          </div>
          <div className="p-3.5">
            <Bar className="h-3" style={{ width: '60%' }} />
          </div>
        </div>

        {/* Feed URL section */}
        <div className="ff-panel">
          <div className="ff-panel-header">
            <Bar className="h-3" style={{ width: '70px' }} />
          </div>
          <div className="p-3.5 flex gap-2">
            <Bar className="h-8" style={{ flex: 1 }} />
            <Bar className="h-8" style={{ width: '90px' }} />
            <Bar className="h-8" style={{ width: '120px' }} />
          </div>
        </div>
      </main>
    </div>
  )
}
