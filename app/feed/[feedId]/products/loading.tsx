// Route-level skeleton: matches the ProductsClient layout (topbar + search +
// 20 rows + pagination) so the transition to live content is seamless.
const SKELETON_BG = 'var(--color-background-secondary)'
const ROW_COUNT = 20

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
          <Bar className="h-3" style={{ width: '120px' }} />
        </div>
        <div className="flex items-center gap-2">
          <Bar className="h-7" style={{ width: '100px' }} />
        </div>
      </header>

      <main className="px-4 py-4 max-w-6xl">
        <Bar className="h-9 mb-3" />

        <div className="space-y-1.5">
          {Array.from({ length: ROW_COUNT }).map((_, i) => (
            <div key={i} className="ff-panel">
              <div className="flex items-center gap-3 px-3.5 py-2">
                <Bar
                  className="w-9 h-9 shrink-0"
                  style={{ borderRadius: '4px' }}
                />
                <div className="flex-1 min-w-0 space-y-1.5">
                  <Bar className="h-3" style={{ width: '60%' }} />
                  <Bar className="h-2.5" style={{ width: '40%' }} />
                </div>
                <Bar className="h-3 shrink-0" style={{ width: '64px' }} />
                <Bar
                  className="h-3 w-3 shrink-0"
                  style={{ borderRadius: '2px' }}
                />
              </div>
            </div>
          ))}
        </div>

        <div
          className="flex items-center justify-between gap-3 mt-3 px-3.5 py-2.5"
          style={{
            border: '1px solid var(--color-border-tertiary)',
            borderRadius: '4px',
            background: 'var(--color-background-tertiary)',
          }}
        >
          <Bar className="h-7" style={{ width: '100px' }} />
          <div className="flex items-center gap-2">
            <Bar className="h-7" style={{ width: '72px' }} />
            <Bar className="h-7" style={{ width: '72px' }} />
          </div>
          <Bar className="h-3" style={{ width: '80px' }} />
        </div>
      </main>
    </div>
  )
}
