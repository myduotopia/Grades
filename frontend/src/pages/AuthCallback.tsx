import { useEffect } from 'react'
import { useTranslation } from 'react-i18next'
import { useNavigate } from 'react-router-dom'

import { supabase } from '../lib/supabase'

/**
 * The OAuth redirect target. Supabase JS auto-extracts the session from the
 * URL hash on mount; we just wait briefly then redirect home.
 */
export function AuthCallback() {
  const { t } = useTranslation()
  const navigate = useNavigate()

  useEffect(() => {
    supabase.auth.getSession().then(() => {
      navigate('/', { replace: true })
    })
  }, [navigate])

  return (
    <div className="min-h-screen flex items-center justify-center text-gray-500">
      {t('auth.signing_in')}
    </div>
  )
}
