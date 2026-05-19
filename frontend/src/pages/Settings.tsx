import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Link, useNavigate } from 'react-router-dom'
import { useMutation, useQueryClient } from '@tanstack/react-query'

import { useAuth } from '../auth/AuthProvider'
import { useMe, useUpdateMeSettings } from '../hooks/useMe'
import { PageContainer } from '../layout/PageContainer'
import { PageHeader } from '../layout/PageHeader'
import { api } from '../lib/api'
import { supabase } from '../lib/supabase'

const TERM_OPTIONS = [2, 3, 4] as const

const PRIMARY_BTN =
  'inline-flex items-center px-4 py-2 rounded-lg bg-amber-500 hover:bg-amber-600 active:bg-amber-700 text-white text-sm font-medium shadow-sm transition-colors disabled:bg-slate-300 disabled:cursor-not-allowed'

const SECONDARY_BTN =
  'inline-flex items-center px-4 py-2 rounded-lg bg-white border border-slate-200 hover:border-slate-300 hover:bg-slate-50 text-slate-700 text-sm font-medium shadow-sm transition-colors disabled:opacity-60'

const DANGER_BTN =
  'inline-flex items-center px-4 py-2 rounded-lg bg-rose-600 hover:bg-rose-700 text-white text-sm font-medium shadow-sm transition-colors disabled:bg-slate-300 disabled:cursor-not-allowed'

export function Settings() {
  const { t, i18n } = useTranslation()
  const { session } = useAuth()
  const meQ = useMe()
  const updateSettings = useUpdateMeSettings()
  const navigate = useNavigate()
  const qc = useQueryClient()

  const user = session?.user
  const userMeta = (user?.user_metadata ?? {}) as {
    full_name?: string
    avatar_url?: string
  }
  const termsPerYear = meQ.data?.terms_per_year ?? 2

  const [dangerOpen, setDangerOpen] = useState(false)
  const [resetConfirm, setResetConfirm] = useState('')
  const [resetErr, setResetErr] = useState<string | null>(null)

  const resetMut = useMutation({
    mutationFn: () => api.me.reset(),
    onSuccess: () => {
      qc.clear()
      navigate('/')
    },
    onError: (err) => {
      setResetErr(err instanceof Error ? err.message : 'unknown')
    },
  })

  function onResetConfirm() {
    setResetErr(null)
    resetMut.mutate()
  }

  return (
    <PageContainer>
      <PageHeader
        title={t('settings.title')}
        subtitle={t('settings.subtitle')}
      />

      {/* Account */}
      <Section title={t('settings.account.heading')}>
        <div className="flex items-center gap-4">
          {userMeta.avatar_url ? (
            <img
              src={userMeta.avatar_url}
              alt=""
              className="w-12 h-12 rounded-full border border-slate-200"
            />
          ) : (
            <div className="w-12 h-12 rounded-full bg-slate-200 flex items-center justify-center text-slate-500 text-lg font-semibold">
              {(user?.email ?? '?').charAt(0).toUpperCase()}
            </div>
          )}
          <div className="flex-1 min-w-0">
            <div className="text-base font-medium text-slate-900 truncate">
              {userMeta.full_name ?? user?.email ?? '—'}
            </div>
            {userMeta.full_name && (
              <div className="text-sm text-slate-500 truncate">
                {user?.email}
              </div>
            )}
          </div>
          <button
            onClick={() => supabase.auth.signOut()}
            className={SECONDARY_BTN}
          >
            {t('auth.sign_out')}
          </button>
        </div>
      </Section>

      {/* UI */}
      <Section title={t('settings.ui.heading')}>
        <div className="flex items-center justify-between gap-4">
          <div>
            <div className="text-sm font-medium text-slate-900">
              {t('settings.ui.language')}
            </div>
            <p className="text-xs text-slate-500 mt-1">
              {t('settings.ui.language_hint')}
            </p>
          </div>
          <select
            value={i18n.language}
            onChange={(e) => i18n.changeLanguage(e.target.value)}
            className="border border-slate-300 rounded-lg px-3 py-2 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-amber-500"
          >
            <option value="zh-TW">中文</option>
            <option value="en">English</option>
          </select>
        </div>
      </Section>

      {/* Semester */}
      <Section title={t('settings.semester.heading')}>
        <div>
          <div className="text-sm font-medium text-slate-900 mb-2">
            {t('settings.semester.terms_per_year')}
          </div>
          <p className="text-xs text-slate-500 mb-3">
            {t('settings.semester.terms_per_year_hint')}
          </p>
          <div className="flex flex-wrap gap-2">
            {TERM_OPTIONS.map((n) => (
              <label
                key={n}
                className={`px-4 py-2 rounded-lg border text-sm cursor-pointer ${
                  termsPerYear === n
                    ? 'bg-amber-50 border-amber-300 text-amber-800 font-medium'
                    : 'bg-white border-slate-200 text-slate-700 hover:bg-slate-50'
                }`}
              >
                <input
                  type="radio"
                  name="terms_per_year"
                  value={n}
                  checked={termsPerYear === n}
                  onChange={() =>
                    updateSettings.mutate({ terms_per_year: n })
                  }
                  className="sr-only"
                />
                {t(`admin_semesters.terms_per_year.${n}`)}
              </label>
            ))}
          </div>
          <Link
            to="/admin/semesters"
            className="inline-block mt-4 text-sm text-amber-700 hover:text-amber-800 font-medium"
          >
            {t('settings.semester.manage_link')} →
          </Link>
        </div>
      </Section>

      {/* Integrations (informational placeholders) */}
      <Section title={t('settings.integrations.heading')}>
        <ul className="divide-y divide-slate-100">
          <li className="flex items-center justify-between py-3">
            <div>
              <div className="text-sm font-medium text-slate-900">
                Duotopia
              </div>
              <p className="text-xs text-slate-500">
                {t('settings.integrations.duotopia_status')}
              </p>
            </div>
            <span className="text-xs text-slate-400">
              {t('settings.integrations.coming_soon')}
            </span>
          </li>
          <li className="flex items-center justify-between py-3">
            <div>
              <div className="text-sm font-medium text-slate-900">
                Google Classroom
              </div>
              <p className="text-xs text-slate-500">
                {t('settings.integrations.classroom_status')}
              </p>
            </div>
            <span className="text-xs text-slate-400">
              {t('settings.integrations.coming_soon')}
            </span>
          </li>
        </ul>
      </Section>

      {/* Danger zone */}
      <section className="mb-6 rounded-xl border border-rose-200 bg-rose-50/40">
        <button
          onClick={() => setDangerOpen((v) => !v)}
          className="w-full text-left px-5 py-4 flex items-center justify-between"
        >
          <span className="text-base font-semibold text-rose-700">
            {t('settings.danger.heading')}
          </span>
          <span className="text-rose-500 text-sm">
            {dangerOpen ? '▾' : '▸'}
          </span>
        </button>
        {dangerOpen && (
          <div className="px-5 pb-5 space-y-3">
            <p className="text-sm text-rose-800">
              {t('settings.danger.warning')}
            </p>
            <ul className="list-disc list-inside text-sm text-rose-800 space-y-1">
              <li>{t('settings.danger.bullets.classrooms')}</li>
              <li>{t('settings.danger.bullets.items_grades')}</li>
              <li>{t('settings.danger.bullets.points')}</li>
              <li>{t('settings.danger.bullets.standards')}</li>
              <li>{t('settings.danger.bullets.weights')}</li>
              <li>{t('settings.danger.bullets.custom_subjects')}</li>
            </ul>
            <p className="text-sm text-rose-800 font-medium">
              {t('settings.danger.confirm_prompt')}
            </p>
            <input
              value={resetConfirm}
              onChange={(e) => setResetConfirm(e.target.value)}
              placeholder="DELETE"
              className="w-full sm:w-64 border border-rose-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-rose-500"
            />
            {resetErr && (
              <p className="text-sm text-rose-700">{resetErr}</p>
            )}
            <div>
              <button
                onClick={onResetConfirm}
                disabled={resetConfirm !== 'DELETE' || resetMut.isPending}
                className={DANGER_BTN}
              >
                {resetMut.isPending
                  ? t('common.saving')
                  : t('settings.danger.button')}
              </button>
            </div>
          </div>
        )}
      </section>
    </PageContainer>
  )
}

function Section({
  title,
  children,
}: {
  title: string
  children: React.ReactNode
}) {
  return (
    <section className="mb-6 bg-white border border-slate-200 rounded-xl shadow-sm p-5">
      <h2 className="text-sm font-semibold text-slate-500 uppercase tracking-wide mb-4">
        {title}
      </h2>
      {children}
    </section>
  )
}

// Help linter find the PRIMARY_BTN constant if a future edit uses it.
export const _SETTINGS_PRIMARY_BTN = PRIMARY_BTN
