import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { NavLink, Outlet } from 'react-router-dom'

import { useAuth } from '../auth/AuthProvider'
import { supabase } from '../lib/supabase'
import { SemesterSwitcher } from '../components/SemesterSwitcher'

const NAV: { to: string; key: string; icon: 'home' | 'classes' | 'categories' }[] = [
  { to: '/', key: 'nav.home', icon: 'home' },
  { to: '/classes', key: 'nav.classes', icon: 'classes' },
  { to: '/admin/subjects', key: 'nav.admin_subjects', icon: 'categories' },
  { to: '/admin/semesters', key: 'nav.admin_semesters', icon: 'categories' },
]

export function AppShell() {
  const { t, i18n } = useTranslation()
  const { session } = useAuth()
  const [drawerOpen, setDrawerOpen] = useState(false)

  const toggleLang = () =>
    i18n.changeLanguage(i18n.language === 'zh-TW' ? 'en' : 'zh-TW')
  const handleSignOut = () => supabase.auth.signOut()

  return (
    <div className="min-h-screen bg-slate-50 md:flex">
      <aside
        className={`fixed md:static inset-y-0 left-0 z-30 w-64 bg-slate-900 text-slate-200 transform transition-transform duration-200 md:translate-x-0 ${
          drawerOpen ? 'translate-x-0' : '-translate-x-full'
        }`}
      >
        <div className="h-full flex flex-col">
          <div className="px-5 pt-6 pb-4">
            <div className="flex items-center gap-2">
              <div className="w-8 h-8 rounded-lg bg-amber-500 flex items-center justify-center">
                <span className="text-white font-bold text-sm">G</span>
              </div>
              <span className="text-base font-semibold text-white tracking-tight">
                {t('app.title')}
              </span>
            </div>
          </div>

          <nav className="flex-1 px-3 py-2 space-y-0.5">
            {NAV.map((item) => (
              <NavLink
                key={item.to}
                to={item.to}
                end={item.to === '/'}
                onClick={() => setDrawerOpen(false)}
                className={({ isActive }) =>
                  `flex items-center gap-3 px-3 py-2 rounded-md text-sm font-medium transition-colors ${
                    isActive
                      ? 'bg-slate-800 text-white'
                      : 'text-slate-400 hover:text-white hover:bg-slate-800/60'
                  }`
                }
              >
                <NavIcon kind={item.icon} />
                <span>{t(item.key)}</span>
              </NavLink>
            ))}
          </nav>

          <div className="px-3 py-3 border-t border-slate-800 space-y-0.5">
            <div className="px-3 py-1.5 text-xs text-slate-500 truncate">
              {session?.user.email}
            </div>
            <button
              onClick={toggleLang}
              className="w-full text-left px-3 py-2 rounded-md text-sm text-slate-400 hover:text-white hover:bg-slate-800/60 transition-colors"
            >
              {t('app.switch_lang')}
            </button>
            <button
              onClick={handleSignOut}
              className="w-full text-left px-3 py-2 rounded-md text-sm text-slate-400 hover:text-rose-300 hover:bg-rose-500/10 transition-colors"
            >
              {t('auth.sign_out')}
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

function NavIcon({ kind }: { kind: 'home' | 'classes' | 'categories' }) {
  const common = 'shrink-0'
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
