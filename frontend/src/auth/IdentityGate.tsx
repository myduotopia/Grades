import { useTranslation } from 'react-i18next'
import { Navigate, Outlet } from 'react-router-dom'

import { useMe } from '../hooks/useMe'
import type { MeIdentity } from '../lib/api'

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
  const { data, isLoading, isError } = useMe()

  if (isLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center text-slate-500">
        {t('common.loading')}
      </div>
    )
  }
  // If /api/me itself failed, don't lock anyone out of the page they asked
  // for — each page surfaces its own API errors.
  if (isError) return <Outlet />

  const identity = data?.identity
  if (!canEnter(area, identity)) {
    return <Navigate to={AREA_PATH[homeAreaFor(identity)]} replace />
  }
  return <Outlet />
}
