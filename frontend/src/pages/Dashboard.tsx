import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'

import { useAuth } from '../auth/AuthProvider'
import { api, type MeResponse } from '../lib/api'
import { supabase } from '../lib/supabase'

export function Dashboard() {
  const { t, i18n } = useTranslation()
  const { session } = useAuth()
  const [me, setMe] = useState<MeResponse | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!session?.access_token) return
    api
      .me(session.access_token)
      .then(setMe)
      .catch((e: Error) => setError(e.message))
  }, [session?.access_token])

  const handleSignOut = () => supabase.auth.signOut()
  const toggleLang = () =>
    i18n.changeLanguage(i18n.language === 'zh-TW' ? 'en' : 'zh-TW')

  return (
    <div className="min-h-screen bg-gray-50 p-4">
      <div className="max-w-2xl mx-auto bg-white p-8 rounded-lg shadow-md">
        <div className="flex justify-between items-start mb-6">
          <div>
            <h1 className="text-3xl font-bold text-gray-900">{t('app.title')}</h1>
            <p className="text-gray-600">{t('app.tagline')}</p>
          </div>
          <button
            onClick={handleSignOut}
            className="text-sm text-gray-500 hover:text-red-600 font-medium"
          >
            {t('auth.sign_out')}
          </button>
        </div>

        <div className="border-t pt-4 space-y-2 text-sm">
          <div>
            <span className="font-semibold">{t('auth.signed_in_as')}:</span>{' '}
            <span className="text-gray-700">{session?.user.email}</span>
          </div>

          {error && (
            <div className="text-red-600">
              {t('app.backend_error')}: {error}
            </div>
          )}

          {me && (
            <>
              <div>
                <span className="font-semibold">{t('app.backend_says')}:</span>{' '}
                <span className="text-green-600">user.id = {me.user.id}</span>
              </div>
              <div className="text-xs text-gray-500">
                setup: {JSON.stringify(me.setup)}
              </div>
            </>
          )}
        </div>

        <button
          onClick={toggleLang}
          className="mt-6 px-4 py-2 bg-blue-600 hover:bg-blue-700 active:bg-blue-800 text-white rounded font-medium transition-colors"
        >
          {t('app.switch_lang')}
        </button>
      </div>
    </div>
  )
}
