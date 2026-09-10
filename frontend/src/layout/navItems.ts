/**
 * The app's sidebar sections — the single source of truth for both the
 * sidebar itself (AppShell) and the breadcrumb's first level (#254).
 *
 * Adding a section here makes it appear in both places at once; that shared
 * list is the whole point of this module living outside AppShell.
 */
export type NavItem = {
  to: string
  key: string
  icon: 'home' | 'classes' | 'categories' | 'alerts'
  badgeKey?: 'alerts'
}

/** Daily-use surfaces (homepage + the two roll-up admin views). */
export const NAV_PRIMARY: NavItem[] = [
  { to: '/', key: 'nav.home', icon: 'home' },
  { to: '/classes', key: 'nav.classes', icon: 'classes' },
  { to: '/points', key: 'nav.points', icon: 'classes' },
  { to: '/lottery', key: 'nav.lottery', icon: 'classes' },
  { to: '/snapshots', key: 'nav.snapshots', icon: 'classes' },
  { to: '/alerts', key: 'nav.alerts', icon: 'alerts', badgeKey: 'alerts' },
]

/** Configuration / settings — separated from the primary group by a divider. */
export const NAV_SETTINGS: NavItem[] = [
  { to: '/admin/subjects', key: 'nav.admin_subjects', icon: 'categories' },
  { to: '/admin/items', key: 'nav.admin_items', icon: 'categories' },
  { to: '/admin/reasons', key: 'nav.admin_reasons', icon: 'categories' },
  { to: '/admin/semesters', key: 'nav.admin_semesters', icon: 'categories' },
  { to: '/settings', key: 'nav.settings', icon: 'categories' },
]

/**
 * Which sidebar section a pathname belongs to.
 *
 * Longest-prefix wins, so `/classes/abc/students` resolves to the Classes
 * section without needing its own entry. `/` would prefix-match everything, so
 * it only counts on an exact match.
 *
 * Returns null for routes outside the shell (e.g. /classes/print, /login).
 */
export function findNavSection(
  pathname: string,
): { item: NavItem; group: 'primary' | 'settings' } | null {
  let best: { item: NavItem; group: 'primary' | 'settings' } | null = null

  const consider = (item: NavItem, group: 'primary' | 'settings') => {
    const hit =
      item.to === '/'
        ? pathname === '/'
        : pathname === item.to || pathname.startsWith(`${item.to}/`)
    if (!hit) return
    if (!best || item.to.length > best.item.to.length) best = { item, group }
  }

  NAV_PRIMARY.forEach((i) => consider(i, 'primary'))
  NAV_SETTINGS.forEach((i) => consider(i, 'settings'))
  return best
}
