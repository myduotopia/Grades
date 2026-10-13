import { useTranslation } from 'react-i18next'

import { useAuth } from '../auth/AuthProvider'
import { MinimalShell } from '../layout/MinimalShell'
import { PageContainer } from '../layout/PageContainer'
import { PageHeader } from '../layout/PageHeader'
import { supabase } from '../lib/supabase'

const SECONDARY_BTN =
  'inline-flex items-center min-h-[44px] px-4 py-2 rounded-lg bg-white border border-slate-200 hover:border-slate-300 hover:bg-slate-50 text-slate-700 text-sm font-medium shadow-sm transition-colors'

/**
 * Shown to a signed-in student who is on a roster but isn't a 小老師 in any
 * class (#261). No teacher data is reachable from here.
 */
export function NoAccess() {
  const { t } = useTranslation()
  const { session } = useAuth()
  const email = session?.user.email ?? ''

  return (
    <MinimalShell>
      <PageContainer>
        <PageHeader title={t('no_access.title')} breadcrumb={false} />
        <div className="bg-white border border-slate-200 rounded-xl p-6 lg:p-8 max-w-2xl">
          <p className="text-slate-700 leading-relaxed">{t('no_access.body')}</p>
          {email && (
            <p className="text-sm text-slate-500 mt-4 break-all">
              {t('no_access.signed_in_as', { email })}
            </p>
          )}
          <button
            type="button"
            onClick={() => supabase.auth.signOut()}
            className={`${SECONDARY_BTN} mt-6`}
          >
            {t('no_access.switch_account')}
          </button>
        </div>
      </PageContainer>
    </MinimalShell>
  )
}
