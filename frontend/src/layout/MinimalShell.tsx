import { useTranslation } from 'react-i18next'
import { Outlet, useLocation } from 'react-router-dom'

import { useAuth } from '../auth/AuthProvider'
import { ErrorBoundary } from '../components/ErrorBoundary'
import { useMe } from '../hooks/useMe'
import { supabase } from '../lib/supabase'

/**
 * Chrome for pages that live OUTSIDE the teacher `AppShell` (#261): the
 * student 小老師 page (`/assistant`) and the no-access page (`/no-access`).
 * A single top bar — logo, who's signed in, language toggle, sign out — and
 * no sidebar, because these users have none of the teacher features.
 *
 * Layout route, like `AppShell`: mounted once in `App.tsx`; pages render
 * only their content (`<PageContainer>` / `<PageHeader>`) via `<Outlet />`.
 */
export function MinimalShell() {
  const { t, i18n } = useTranslation()
  const { session } = useAuth()
  const { data: me } = useMe()
  const location = useLocation()
  const toggleLang = () =>
    i18n.changeLanguage(i18n.language === 'zh-TW' ? 'en' : 'zh-TW')

  // On the 小老師 page show "name（小老師）"; elsewhere the app title.
  const onAssistant = location.pathname.startsWith('/assistant')
  const studentName = me?.identity.assistant_contexts.find(
    (c) => c.student_name,
  )?.student_name
  const label = onAssistant
    ? studentName
      ? t('assistant.header', { name: studentName })
      : t('assistant.role')
    : t('app.title')

  return (
    <div className="min-h-screen bg-slate-50 flex flex-col">
      <header className="bg-slate-900 text-slate-200 sticky top-0 z-10">
        <div className="max-w-6xl mx-auto px-4 sm:px-8 h-14 flex items-center gap-3">
          <div className="w-8 h-8 rounded-lg bg-amber-500 flex items-center justify-center shrink-0">
            <span className="text-white font-bold text-sm">G</span>
          </div>
          <div className="min-w-0 flex-1">
            <div className="text-sm font-semibold text-white truncate">{label}</div>
            {session?.user.email && (
              <div className="text-xs text-slate-400 truncate">
                {session.user.email}
              </div>
            )}
          </div>
          <button
            type="button"
            onClick={toggleLang}
            className="min-h-[44px] px-3 rounded-md text-sm text-slate-300 hover:text-white hover:bg-slate-800/60 transition-colors"
          >
            {t('app.switch_lang')}
          </button>
          <button
            type="button"
            onClick={() => supabase.auth.signOut()}
            className="min-h-[44px] px-3 rounded-md text-sm text-slate-300 hover:text-rose-300 hover:bg-rose-500/10 transition-colors"
          >
            {t('auth.sign_out')}
          </button>
        </div>
      </header>
      <main className="flex-1 px-4 sm:px-8 lg:px-12 py-8 lg:py-10">
        <ErrorBoundary resetKey={location.pathname}>
          <Outlet />
        </ErrorBoundary>
      </main>
    </div>
  )
}
