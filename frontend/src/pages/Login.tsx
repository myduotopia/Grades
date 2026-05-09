import { useTranslation } from 'react-i18next'
import { Navigate } from 'react-router-dom'

import { useAuth } from '../auth/AuthProvider'
import { supabase } from '../lib/supabase'

export function Login() {
  const { t } = useTranslation()
  const { session, loading } = useAuth()

  if (loading) return null
  if (session) return <Navigate to="/" replace />

  const handleSignIn = async () => {
    await supabase.auth.signInWithOAuth({
      provider: 'google',
      options: {
        redirectTo: `${window.location.origin}/auth/callback`,
      },
    })
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-gray-50 p-4">
      <div className="bg-white p-8 rounded-lg shadow-md max-w-md w-full text-center">
        <h1 className="text-3xl font-bold text-gray-900 mb-2">{t('app.title')}</h1>
        <p className="text-gray-600 mb-8">{t('app.tagline')}</p>

        <button
          onClick={handleSignIn}
          className="w-full px-4 py-3 bg-white border border-gray-300 hover:bg-gray-50 active:bg-gray-100 text-gray-800 rounded font-medium transition-colors flex items-center justify-center gap-3"
        >
          <span aria-hidden="true">G</span>
          {t('auth.sign_in_with_google')}
        </button>
      </div>
    </div>
  )
}
