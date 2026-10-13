import { useTranslation } from 'react-i18next'
import { Navigate, Outlet } from 'react-router-dom'

import { useMe } from '../hooks/useMe'
import type { MeIdentity } from '../lib/api'
import { supabase } from '../lib/supabase'

export type Area = 'teacher' | 'assistant' | 'no_access'

/**
 * Where a signed-in user belongs (#261):
 * - owns a class → teacher app (a teacher who is ALSO someone's 小老師 may
 *   still open /assistant);
 * - roster student with ≥1 小老師 class → /assistant;
 * - roster student without one → /no-access;
 * - matches no roster at all → teacher app (new-teacher onboarding, as before).
 *
 * This is navigation only, not security: the backend filters every teacher
 * endpoint by ownership and enforces 小老師 rights on /api/assistant/*.
 */
export function homeAreaFor(identity: MeIdentity | undefined): Area {
  if (!identity || identity.is_teacher || !identity.is_student) return 'teacher'
  return identity.assistant_contexts.length > 0 ? 'assistant' : 'no_access'
}

export const AREA_PATH: Record<Area, string> = {
  teacher: '/',
  assistant: '/assistant',
  no_access: '/no-access',
}

function canEnter(area: Area, identity: MeIdentity | undefined): boolean {
  const home = homeAreaFor(identity)
  if (area === home) return true
  // Teachers can also open the 小老師 page when they have assignments.
  return (
    area === 'assistant' &&
    home === 'teacher' &&
    (identity?.assistant_contexts.length ?? 0) > 0
  )
}

/** Layout route: renders children only when the user belongs to `area`. */
export function IdentityGate({ area }: { area: Area }) {
  const { t } = useTranslation()
  const { data, isLoading, isError, isFetching, refetch } = useMe()

  if (isLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center text-slate-500">
        {t('common.loading')}
      </div>
    )
  }
  // /api/me failed: we don't know who this is, so don't guess — letting
  // them into the teacher AppShell would onboard a student as a new teacher.
  // Show an error with retry (and sign-out, in case the session is broken).
  if (isError || !data) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-slate-50 px-4">
        <div className="bg-white border border-slate-200 rounded-xl p-6 max-w-md w-full text-center">
          <p className="text-sm text-slate-700 mb-4" role="alert">
            {t('auth.identity_error')}
          </p>
          <div className="flex items-center justify-center gap-3">
            <button
              type="button"
              onClick={() => void refetch()}
              disabled={isFetching}
              className="inline-flex items-center justify-center min-h-[44px] px-4 py-2 rounded-lg bg-amber-500 hover:bg-amber-600 active:bg-amber-700 text-white text-sm font-medium shadow-sm transition-colors disabled:bg-slate-300 disabled:shadow-none disabled:cursor-not-allowed"
            >
              {isFetching ? t('common.loading') : t('common.retry')}
            </button>
            <button
              type="button"
              onClick={() => void supabase.auth.signOut()}
              className="inline-flex items-center min-h-[44px] px-4 py-2 rounded-lg bg-white border border-slate-200 hover:border-slate-300 hover:bg-slate-50 text-slate-700 text-sm font-medium shadow-sm transition-colors"
            >
              {t('auth.sign_out')}
            </button>
          </div>
        </div>
      </div>
    )
  }

  const identity = data.identity
  if (!canEnter(area, identity)) {
    return <Navigate to={AREA_PATH[homeAreaFor(identity)]} replace />
  }
  return <Outlet />
}
