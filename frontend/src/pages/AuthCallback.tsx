import { useEffect } from 'react'
import { useTranslation } from 'react-i18next'
import { useNavigate } from 'react-router-dom'

import { api } from '../lib/api'
import { supabase } from '../lib/supabase'

/**
 * The OAuth redirect target. Supabase JS auto-extracts the session from the
 * URL hash on mount; we then fire the idempotent /api/me/seed (so first-time
 * users get the 7 default categories + a current semester) and redirect home.
 */
export function AuthCallback() {
  const { t } = useTranslation()
  const navigate = useNavigate()

  useEffect(() => {
    supabase.auth
      .getSession()
      .then(() =>
        api.me.seed().catch((err) => {
          console.warn('seed failed (non-fatal):', err)
        }),
      )
      .finally(() => navigate('/classes', { replace: true }))
  }, [navigate])

  return (
    <div className="min-h-screen flex items-center justify-center text-gray-500">
      {t('auth.signing_in')}
    </div>
  )
}
