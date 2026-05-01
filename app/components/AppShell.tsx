'use client'

import { usePathname } from 'next/navigation'
import { Sidebar } from './Sidebar'

const NO_SIDEBAR = ['/login', '/']

export function AppShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname()
  const showSidebar = !NO_SIDEBAR.includes(pathname)

  if (!showSidebar) return <>{children}</>

  return (
    <div className="flex h-screen">
      <Sidebar />
      <div
        className="flex-1 min-w-0 overflow-y-auto"
        style={{ background: 'var(--color-background-tertiary)' }}
      >
        {children}
      </div>
    </div>
  )
}
