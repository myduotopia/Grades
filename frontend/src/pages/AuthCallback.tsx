import { useQueryClient } from '@tanstack/react-query'
import { useEffect } from 'react'
import { useTranslation } from 'react-i18next'
import { useNavigate } from 'react-router-dom'

import { AREA_PATH, homeAreaFor } from '../auth/IdentityGate'
import { meKey } from '../hooks/useMe'
import { api } from '../lib/api'
import { supabase } from '../lib/supabase'

/**
 * The OAuth redirect target. Supabase JS auto-extracts the session from the
 * URL hash on mount; we then ask /api/me who this is (#261):
 * - a roster student who owns no class goes straight to /assistant or
 *   /no-access and is NOT seeded — seeding would onboard them as a teacher;
 * - everyone else gets the idempotent /api/me/seed (first-time teachers get
 *   the default categories + a current semester) and lands on home.
 */
export function AuthCallback() {
  const { t } = useTranslation()
  const navigate = useNavigate()
  const qc = useQueryClient()

  useEffect(() => {
    let cancelled = false
    async function run() {
      await supabase.auth.getSession()
      let target = '/'
      try {
        const me = await api.me.get()
        qc.setQueryData(meKey, me)
        const area = homeAreaFor(me.identity)
        if (area !== 'teacher') target = AREA_PATH[area]
      } catch (err) {
        console.warn('identity lookup failed (non-fatal):', err)
      }
      if (target === '/') {
        await api.me.seed().catch((err) => {
          console.warn('seed failed (non-fatal):', err)
        })
        // Seeding may have changed setup flags — refetch on next use.
        void qc.invalidateQueries({ queryKey: meKey })
      }
      if (!cancelled) navigate(target, { replace: true })
    }
    void run()
    return () => {
      cancelled = true
    }
  }, [navigate, qc])

  return (
    <div className="min-h-screen flex items-center justify-center text-gray-500">
      {t('auth.signing_in')}
    </div>
  )
}
