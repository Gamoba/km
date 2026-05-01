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
