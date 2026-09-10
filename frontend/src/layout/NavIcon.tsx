import type { NavItem } from './navItems'

/**
 * Sidebar / breadcrumb section icon. Lives outside AppShell so the breadcrumb's
 * first-level switcher can show the same glyphs as the sidebar (#254).
 */
export function NavIcon({ kind }: { kind: NavItem['icon'] }) {
  const common = 'shrink-0'
  if (kind === 'alerts') {
    return (
      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className={common}>
        <path d="M10.29 3.86 1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z" />
        <line x1="12" y1="9" x2="12" y2="13" />
        <line x1="12" y1="17" x2="12.01" y2="17" />
      </svg>
    )
  }
  if (kind === 'home') {
    return (
      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className={common}>
        <path d="M3 10.5L12 3l9 7.5V21a1 1 0 0 1-1 1h-5v-7h-6v7H4a1 1 0 0 1-1-1V10.5z" />
      </svg>
    )
  }
  if (kind === 'classes') {
    return (
      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className={common}>
        <rect x="3" y="5" width="18" height="14" rx="2" />
        <path d="M3 10h18" />
        <path d="M8 5v14" />
      </svg>
    )
  }
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className={common}>
      <path d="M3 6h13" />
      <path d="M3 12h13" />
      <path d="M3 18h13" />
      <circle cx="20" cy="6" r="1.5" />
      <circle cx="20" cy="12" r="1.5" />
      <circle cx="20" cy="18" r="1.5" />
    </svg>
  )
}
