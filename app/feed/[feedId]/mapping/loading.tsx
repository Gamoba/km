// Route-level skeleton for the mapping page. Mirrors the topbar + Required
// section layout (8 rows: field name + mapping-type dropdown + config) so the
// transition to live content is seamless.
const SKELETON_BG = 'var(--color-background-secondary)'
const REQUIRED_ROWS = 8

function Bar({ className, style }: { className?: string; style?: React.CSSProperties }) {
  return (
    <div
      className={`animate-pulse ${className ?? ''}`}
      style={{ background: SKELETON_BG, borderRadius: '4px', ...style }}
    />
  )
}

export default function Loading() {
  return (
    <div className="min-h-screen">
      <header className="ff-topbar">
        <div className="flex items-center gap-3">
          <Bar className="h-4" style={{ width: '180px' }} />
          <Bar className="h-3" style={{ width: '140px' }} />
        </div>
        <div className="flex items-center gap-2">
          <Bar className="h-7" style={{ width: '110px' }} />
          <Bar className="h-7" style={{ width: '130px' }} />
          <Bar className="h-7" style={{ width: '110px' }} />
          <Bar className="h-7" style={{ width: '110px' }} />
        </div>
      </header>

      <main className="px-4 py-4 max-w-6xl">
        <div className="ff-panel">
          <div className="ff-panel-header">
            <Bar className="h-3" style={{ width: '90px' }} />
            <Bar className="h-3" style={{ width: '60px' }} />
          </div>
          <div className="divide-y divide-[var(--color-border-tertiary)]">
            {Array.from({ length: REQUIRED_ROWS }).map((_, i) => (
              <div key={i} className="px-3.5 py-2.5">
                <div className="flex items-start gap-3">
                  <div className="w-52 pt-1.5 shrink-0">
                    <Bar className="h-3.5" style={{ width: '70%' }} />
                  </div>
                  <div className="w-40 shrink-0">
                    <Bar className="h-8" />
                  </div>
                  <div className="flex-1 min-w-0">
                    <Bar className="h-8" />
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>
      </main>
    </div>
  )
}
