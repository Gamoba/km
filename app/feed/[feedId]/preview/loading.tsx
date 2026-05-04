// Route-level skeleton for the preview page. Mirrors the topbar + tab toggle
// + product-view layout with a sidebar and 8 placeholder XML/field rows.
const SKELETON_BG = 'var(--color-background-secondary)'

function Bar({ className, style }: { className?: string; style?: React.CSSProperties }) {
  return (
    <div
      className={`animate-pulse ${className ?? ''}`}
      style={{ background: SKELETON_BG, borderRadius: '4px', ...style }}
    />
  )
}

const ROW_WIDTHS = ['80%', '55%', '70%', '40%', '85%', '50%', '65%', '45%']

export default function Loading() {
  return (
    <div className="min-h-screen">
      <header className="ff-topbar">
        <div className="flex items-center gap-3">
          <Bar className="h-4" style={{ width: '200px' }} />
          <Bar className="h-3" style={{ width: '140px' }} />
        </div>
        <Bar className="h-7" style={{ width: '180px' }} />
      </header>

      <main className="px-4 py-4">
        <div className="flex gap-3 h-[calc(100vh-160px)]">
          {/* Product list pane */}
          <div className="w-64 flex-none flex flex-col ff-panel">
            <div
              className="p-2 shrink-0"
              style={{ borderBottom: '1px solid var(--color-border-tertiary)' }}
            >
              <Bar className="h-8" />
            </div>
            <div className="overflow-hidden flex-1 p-2 space-y-2">
              {Array.from({ length: 10 }).map((_, i) => (
                <div key={i} className="space-y-1">
                  <Bar className="h-3" style={{ width: '85%' }} />
                  <Bar className="h-2.5" style={{ width: '55%' }} />
                </div>
              ))}
            </div>
          </div>

          {/* Field values pane — XML-like grey lines of varying width. */}
          <div className="flex-1 ff-panel flex flex-col p-4 space-y-2.5">
            {ROW_WIDTHS.map((w, i) => (
              <Bar key={i} className="h-3" style={{ width: w }} />
            ))}
          </div>
        </div>
      </main>
    </div>
  )
}
