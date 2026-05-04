export const colors = {
  sidebar: {
    bg: '#13111f',
    border: '#1e1c2e',
    textInactive: 'rgba(255,255,255,0.4)',
    textActive: 'white',
    activeBorder: '#6c5ce7',
    activeBg: 'rgba(108,92,231,0.15)',
    marketBg: 'rgba(108,92,231,0.1)',
    marketText: '#6c5ce7',
  },
  accent: '#6c5ce7',
  accentHover: '#5a4bd1',
  badge: {
    success: { bg: 'rgba(63,153,34,0.1)', text: '#3b6d11' },
    warning: { bg: 'rgba(186,117,23,0.1)', text: '#854f0b' },
    danger: { bg: 'rgba(226,75,74,0.1)', text: '#a32d2d' },
    accent: { bg: 'rgba(108,92,231,0.1)', text: '#534ab7' },
  },
} as const

export const typography = {
  fontMono: 'var(--font-mono)',
  fontSans: 'var(--font-sans)',
  sizes: {
    label: '10px',
    body: '12px',
    bodyMd: '13px',
    mono: '11px',
  },
  labelStyle: {
    fontSize: '10px',
    textTransform: 'uppercase' as const,
    letterSpacing: '0.6px',
  },
} as const

export const layout = {
  sidebarWidth: '210px',
  topbarHeight: '44px',
  contentPadding: '16px',
  panelRadius: '6px',
  badgeRadius: '3px',
  buttonRadius: '4px',
} as const

export const borders = {
  panel: '1px solid var(--color-border-tertiary)',
  subtle: '0.5px solid var(--color-border-tertiary)',
} as const

// ── Interactive states ────────────────────────────────────────────────────
// Reusable Tailwind class fragments for cursors, transitions, focus rings and
// disabled treatments. Prefer these over hard-coding equivalent classes so we
// can tune them centrally.
export const interactive = {
  cursor: {
    pointer: 'cursor-pointer',
    notAllowed: 'cursor-not-allowed',
    grab: 'cursor-grab',
    grabbing: 'cursor-grabbing',
    wait: 'cursor-wait',
    text: 'cursor-text',
  },
  transition: {
    colors: 'transition-colors duration-150',
    all: 'transition-all duration-150',
    opacity: 'transition-opacity duration-150',
  },
  focus: {
    ring: 'focus:outline-none focus:ring-2 focus:ring-[#6c5ce7] focus:ring-offset-1',
  },
  disabled: {
    base: 'disabled:opacity-50 disabled:cursor-not-allowed',
  },
} as const

// Hover treatments grouped by component family. Most call sites should use the
// matching ff-* CSS class instead (ff-btn-primary, ff-card, ff-table-row,
// ff-nav-item, ff-chip-close) — these tokens cover the few inline spots where
// adding a class isn't practical.
export const hover = {
  button: {
    primary: 'hover:bg-[#5a4bd1] active:bg-[#4a3bc1]',
    secondary: 'hover:bg-[var(--color-background-secondary)]',
    danger: 'hover:bg-red-50',
    ghost: 'hover:bg-[var(--color-background-secondary)]',
  },
  row: 'hover:bg-[var(--color-background-secondary)]',
  card: 'hover:shadow-md hover:-translate-y-0.5 transition-all duration-150',
  navItem: 'hover:bg-[rgba(108,92,231,0.1)] hover:text-white',
  chip: 'hover:opacity-80',
} as const
