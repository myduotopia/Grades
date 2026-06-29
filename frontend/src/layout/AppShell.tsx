import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { NavLink, Outlet } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'

import { useAuth } from '../auth/AuthProvider'
import { supabase } from '../lib/supabase'
import { SemesterSwitcher } from '../components/SemesterSwitcher'
import { api } from '../lib/api'

type NavItem = {
  to: string
  key: string
  icon: 'home' | 'classes' | 'categories' | 'alerts'
  badgeKey?: 'alerts'
}

// Daily-use surfaces (homepage + the two roll-up admin views).
const NAV_PRIMARY: NavItem[] = [
  { to: '/', key: 'nav.home', icon: 'home' },
  { to: '/classes', key: 'nav.classes', icon: 'classes' },
  { to: '/points', key: 'nav.points', icon: 'classes' },
  { to: '/lottery', key: 'nav.lottery', icon: 'classes' },
  { to: '/snapshots', key: 'nav.snapshots', icon: 'classes' },
  { to: '/alerts', key: 'nav.alerts', icon: 'alerts', badgeKey: 'alerts' },
]

// Configuration / settings — separated from the primary group by a divider.
const NAV_SETTINGS: NavItem[] = [
  { to: '/admin/subjects', key: 'nav.admin_subjects', icon: 'categories' },
  { to: '/admin/items', key: 'nav.admin_items', icon: 'categories' },
  { to: '/admin/reasons', key: 'nav.admin_reasons', icon: 'categories' },
  { to: '/admin/semesters', key: 'nav.admin_semesters', icon: 'categories' },
  { to: '/settings', key: 'nav.settings', icon: 'categories' },
]

const COLLAPSE_KEY = 'appshell.sidebar_collapsed'

export function AppShell() {
  const { t, i18n } = useTranslation()
  const { session } = useAuth()
  // Alerts badge counter (issue #161). Refetched every 60s so a teacher
  // who's been on the same surface for a while still sees new 0-scores
  // show up. Visiting /alerts marks them viewed and the count drops.
  const alertsSummaryQ = useQuery({
    queryKey: ['home-alerts-summary'],
    queryFn: () => api.home.alertsSummary(),
    refetchInterval: 60000,
    refetchOnWindowFocus: true,
  })
  const alertCount = alertsSummaryQ.data?.new_count ?? 0
  // Mobile drawer state (slides in from off-screen)
  const [drawerOpen, setDrawerOpen] = useState(false)
  // Desktop collapse state (icons-only rail vs. full sidebar). Persisted so
  // the teacher's preference survives reloads.
  const [collapsed, setCollapsed] = useState<boolean>(() => {
    if (typeof window === 'undefined') return false
    return localStorage.getItem(COLLAPSE_KEY) === '1'
  })
  useEffect(() => {
    try {
      localStorage.setItem(COLLAPSE_KEY, collapsed ? '1' : '0')
    } catch {
      // Ignore quota / privacy-mode errors.
    }
  }, [collapsed])

  const toggleLang = () =>
    i18n.changeLanguage(i18n.language === 'zh-TW' ? 'en' : 'zh-TW')
  const handleSignOut = () => supabase.auth.signOut()

  const widthClass = collapsed ? 'md:w-16' : 'md:w-64'
  // Mobile: full-screen drawer (fixed). Desktop: sticky 100vh column so
  // the sidebar height is independent of main content — long pages don't
  // stretch / push the sidebar (#173).
  const asideClass = `fixed md:sticky md:top-0 md:h-screen inset-y-0 left-0 z-30 w-64 ${widthClass} bg-slate-900 text-slate-200 transform transition-[transform,width] duration-200 md:translate-x-0 ${
    drawerOpen ? 'translate-x-0' : '-translate-x-full'
  }`

  return (
    <div className="min-h-screen bg-slate-50 md:flex">
      <aside className={asideClass}>
        <div className="h-full flex flex-col">
          <div className="px-3 pt-4 pb-3 flex items-center gap-2">
            <div className="w-8 h-8 rounded-lg bg-amber-500 flex items-center justify-center shrink-0">
              <span className="text-white font-bold text-sm">G</span>
            </div>
            {!collapsed && (
              <span className="text-base font-semibold text-white tracking-tight flex-1 truncate">
                {t('app.title')}
              </span>
            )}
            {/* Collapse / expand button (desktop only). On mobile this row
                stays simple — the drawer closes via the backdrop. */}
            <button
              onClick={() => setCollapsed((v) => !v)}
              className="hidden md:flex w-7 h-7 items-center justify-center rounded text-slate-400 hover:text-white hover:bg-slate-800/60"
              aria-label={
                collapsed
                  ? t('nav.expand_sidebar')
                  : t('nav.collapse_sidebar')
              }
              title={
                collapsed
                  ? t('nav.expand_sidebar')
                  : t('nav.collapse_sidebar')
              }
            >
              <CollapseChevron collapsed={collapsed} />
            </button>
          </div>

          <nav className="flex-1 px-2 py-2 space-y-0.5 overflow-y-auto">
            {NAV_PRIMARY.map((item) => {
              const showBadge =
                item.badgeKey === 'alerts' && alertCount > 0
              return (
                <NavLink
                  key={item.to}
                  to={item.to}
                  end={item.to === '/'}
                  onClick={() => setDrawerOpen(false)}
                  title={collapsed ? t(item.key) : undefined}
                  className={({ isActive }) =>
                    `relative flex items-center ${
                      collapsed ? 'justify-center' : 'gap-3'
                    } px-3 py-2 rounded-md text-sm font-medium transition-colors ${
                      isActive
                        ? 'bg-slate-800 text-white'
                        : 'text-slate-400 hover:text-white hover:bg-slate-800/60'
                    }`
                  }
                >
                  <NavIcon kind={item.icon} />
                  {!collapsed && (
                    <span className="truncate flex-1">{t(item.key)}</span>
                  )}
                  {showBadge && (
                    <span
                      className={`${
                        collapsed
                          ? 'absolute top-1 right-1 min-w-[1.1rem] h-[1.1rem] px-1 text-[10px]'
                          : 'min-w-[1.25rem] h-5 px-1.5 text-[11px]'
                      } inline-flex items-center justify-center rounded-full bg-rose-600 text-white font-semibold leading-none`}
                      aria-label={t('nav.alerts_badge', { count: alertCount })}
                    >
                      {alertCount > 99 ? '99+' : alertCount}
                    </span>
                  )}
                </NavLink>
              )
            })}
            <div className="my-2 border-t border-slate-800 mx-2" aria-hidden />
            {NAV_SETTINGS.map((item) => (
              <NavLink
                key={item.to}
                to={item.to}
                end={item.to === '/'}
                onClick={() => setDrawerOpen(false)}
                title={collapsed ? t(item.key) : undefined}
                className={({ isActive }) =>
                  `flex items-center ${
                    collapsed ? 'justify-center' : 'gap-3'
                  } px-3 py-2 rounded-md text-sm font-medium transition-colors ${
                    isActive
                      ? 'bg-slate-800 text-white'
                      : 'text-slate-400 hover:text-white hover:bg-slate-800/60'
                  }`
                }
              >
                <NavIcon kind={item.icon} />
                {!collapsed && <span className="truncate">{t(item.key)}</span>}
              </NavLink>
            ))}
          </nav>

          <div className="px-2 py-3 border-t border-slate-800 space-y-0.5">
            {!collapsed && (
              <div className="px-3 py-1.5 text-xs text-slate-500 truncate">
                {session?.user.email}
              </div>
            )}
            <button
              onClick={toggleLang}
              title={collapsed ? t('app.switch_lang') : undefined}
              className={`w-full ${
                collapsed ? 'flex justify-center' : 'text-left'
              } px-3 py-2 rounded-md text-sm text-slate-400 hover:text-white hover:bg-slate-800/60 transition-colors`}
            >
              {collapsed ? '🌐' : t('app.switch_lang')}
            </button>
            <button
              onClick={handleSignOut}
              title={collapsed ? t('auth.sign_out') : undefined}
              className={`w-full ${
                collapsed ? 'flex justify-center' : 'text-left'
              } px-3 py-2 rounded-md text-sm text-slate-400 hover:text-rose-300 hover:bg-rose-500/10 transition-colors`}
            >
              {collapsed ? (
                <SignOutIcon />
              ) : (
                t('auth.sign_out')
              )}
            </button>
          </div>
        </div>
      </aside>

      {drawerOpen && (
        <div
          className="fixed inset-0 bg-black/40 z-20 md:hidden backdrop-blur-sm"
          onClick={() => setDrawerOpen(false)}
          aria-hidden
        />
      )}

      <div className="flex-1 min-w-0 flex flex-col">
        <header className="md:hidden bg-white/80 backdrop-blur border-b border-slate-200 px-4 py-3 flex items-center justify-between sticky top-0 z-10">
          <button
            onClick={() => setDrawerOpen(true)}
            className="p-2 -ml-2 text-slate-700 hover:bg-slate-100 rounded"
            aria-label={t('nav.open_menu')}
          >
            <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
              <line x1="4" y1="6" x2="20" y2="6" />
              <line x1="4" y1="12" x2="20" y2="12" />
              <line x1="4" y1="18" x2="20" y2="18" />
            </svg>
          </button>
          <SemesterSwitcher />
        </header>

        <div className="hidden md:flex h-12 border-b border-slate-200 bg-white items-center justify-end px-6 sticky top-0 z-10">
          <SemesterSwitcher />
        </div>

        <main className="flex-1 px-4 sm:px-8 lg:px-12 py-8 lg:py-10">
          <Outlet />
        </main>
      </div>
    </div>
  )
}

function CollapseChevron({ collapsed }: { collapsed: boolean }) {
  return (
    <svg
      width="16"
      height="16"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      style={{ transform: collapsed ? 'rotate(180deg)' : undefined }}
    >
      <polyline points="15 18 9 12 15 6" />
    </svg>
  )
}

function SignOutIcon() {
  return (
    <svg
      width="16"
      height="16"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4" />
      <polyline points="16 17 21 12 16 7" />
      <line x1="21" y1="12" x2="9" y2="12" />
    </svg>
  )
}

function NavIcon({ kind }: { kind: 'home' | 'classes' | 'categories' | 'alerts' }) {
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
