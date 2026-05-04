// Route-level skeleton for the filters page. Mirrors the topbar + two
// section panels (Include / Exclude) each with three placeholder rule rows.
const SKELETON_BG = 'var(--color-background-secondary)'

function Bar({ className, style }: { className?: string; style?: React.CSSProperties }) {
  return (
    <div
      className={`animate-pulse ${className ?? ''}`}
      style={{ background: SKELETON_BG, borderRadius: '4px', ...style }}
    />
  )
}

function RuleRowSkeleton() {
  return (
    <div className="flex items-center gap-2">
      <Bar className="h-8" style={{ width: '176px', flex: 'none' }} />
      <Bar className="h-8" style={{ width: '176px', flex: 'none' }} />
      <Bar className="h-8" style={{ flex: 1 }} />
      <Bar className="h-6 w-6" style={{ flex: 'none', borderRadius: '4px' }} />
    </div>
  )
}

function FilterSectionSkeleton() {
  return (
    <div className="ff-panel">
      <div
        className="ff-panel-header"
        style={{ alignItems: 'flex-start', padding: '10px 14px' }}
      >
        <div className="flex items-start gap-2.5">
          <Bar className="h-4" style={{ width: '64px' }} />
          <div className="space-y-1">
            <Bar className="h-3" style={{ width: '120px' }} />
            <Bar className="h-2.5" style={{ width: '220px' }} />
          </div>
        </div>
      </div>
      <div className="p-3.5 space-y-2">
        <RuleRowSkeleton />
        <RuleRowSkeleton />
        <RuleRowSkeleton />
        <Bar className="h-3 mt-2" style={{ width: '80px' }} />
      </div>
    </div>
  )
}

export default function Loading() {
  return (
    <div className="min-h-screen">
      <header className="ff-topbar">
        <div className="flex items-center gap-3">
          <Bar className="h-4" style={{ width: '180px' }} />
          <Bar className="h-3" style={{ width: '160px' }} />
        </div>
        <Bar className="h-7" style={{ width: '90px' }} />
      </header>

      <main className="px-4 py-4 max-w-4xl space-y-3">
        <FilterSectionSkeleton />
        <FilterSectionSkeleton />
      </main>
    </div>
  )
}
