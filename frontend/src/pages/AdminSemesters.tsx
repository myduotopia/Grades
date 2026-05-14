import { useState } from 'react'
import { useTranslation } from 'react-i18next'

import { formatSemester } from '../components/SemesterSwitcher'
import {
  useCreateSemester,
  useSemesters,
  useSetCurrentSemester,
} from '../hooks/useSemesters'
import { useMe, useUpdateMeSettings } from '../hooks/useMe'
import { PageContainer } from '../layout/PageContainer'
import { PageHeader } from '../layout/PageHeader'

const PRIMARY_BTN =
  'inline-flex items-center px-4 py-2 rounded-lg bg-amber-500 hover:bg-amber-600 active:bg-amber-700 text-white text-sm font-medium shadow-sm transition-colors disabled:bg-slate-300 disabled:shadow-none disabled:cursor-not-allowed'

const TERM_OPTIONS = [2, 3, 4] as const

export function AdminSemesters() {
  const { t } = useTranslation()
  const meQ = useMe()
  const semestersQ = useSemesters()
  const createSem = useCreateSemester()
  const setCurrent = useSetCurrentSemester()
  const updateSettings = useUpdateMeSettings()
  const [savedFlash, setSavedFlash] = useState(false)

  const termsPerYear = meQ.data?.terms_per_year ?? 2
  const semesters = semestersQ.data?.data ?? []

  function onTermsChange(n: 2 | 3 | 4) {
    updateSettings.mutate(
      { terms_per_year: n },
      {
        onSuccess: () => {
          setSavedFlash(true)
          setTimeout(() => setSavedFlash(false), 1500)
        },
      },
    )
  }

  return (
    <PageContainer>
      <PageHeader
        title={t('admin_semesters.title')}
        subtitle={t('admin_semesters.subtitle')}
      />

      <section className="bg-white border border-slate-200 rounded-xl shadow-sm p-5 mb-6">
        <div className="flex items-center justify-between gap-4 flex-wrap">
          <div>
            <label className="block text-sm font-medium text-slate-700">
              {t('admin_semesters.terms_per_year_label')}
            </label>
            <p className="text-xs text-slate-500 mt-0.5">
              {t('admin_semesters.terms_per_year_hint')}
            </p>
          </div>
          <div className="flex items-center gap-3">
            <select
              value={termsPerYear}
              onChange={(e) =>
                onTermsChange(Number(e.target.value) as 2 | 3 | 4)
              }
              disabled={meQ.isLoading || updateSettings.isPending}
              className="border border-slate-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-amber-500"
            >
              {TERM_OPTIONS.map((n) => (
                <option key={n} value={n}>
                  {t(`admin_semesters.terms_per_year.${n}`)}
                </option>
              ))}
            </select>
            {savedFlash && (
              <span className="text-sm text-emerald-600">
                {t('common.saved')}
              </span>
            )}
          </div>
        </div>
      </section>

      <section className="bg-white border border-slate-200 rounded-xl shadow-sm overflow-hidden">
        <div className="px-5 py-4 border-b border-slate-100 flex items-center justify-between">
          <h2 className="text-sm font-semibold text-slate-700">
            {t('admin_semesters.list_title')}
          </h2>
          <button
            onClick={() => createSem.mutate()}
            disabled={createSem.isPending}
            className={PRIMARY_BTN}
          >
            {createSem.isPending
              ? t('common.saving')
              : t('admin_semesters.add')}
          </button>
        </div>

        {semestersQ.isLoading && (
          <div className="text-center text-slate-400 py-10">
            {t('common.loading')}
          </div>
        )}

        {!semestersQ.isLoading && semesters.length === 0 && (
          <div className="text-center text-slate-400 py-10">
            {t('admin_semesters.empty')}
          </div>
        )}

        {!semestersQ.isLoading && semesters.length > 0 && (
          <ul role="radiogroup" aria-label={t('admin_semesters.list_title')}>
            {semesters.map((s) => (
              <li
                key={s.id}
                className="border-b border-slate-100 last:border-b-0"
              >
                <label className="flex items-center gap-3 px-5 py-3 cursor-pointer hover:bg-slate-50">
                  <input
                    type="radio"
                    name="current_semester"
                    checked={s.is_current}
                    disabled={setCurrent.isPending}
                    onChange={() => {
                      if (!s.is_current) setCurrent.mutate(s.id)
                    }}
                    className="w-4 h-4 text-amber-500 focus:ring-amber-500"
                  />
                  <span className="text-slate-900 font-medium">
                    {formatSemester(s)}
                  </span>
                  {s.is_current && (
                    <span className="text-[10px] uppercase tracking-wider text-amber-700 bg-amber-50 rounded-full px-2 py-0.5">
                      {t('admin_semesters.current_badge')}
                    </span>
                  )}
                </label>
              </li>
            ))}
          </ul>
        )}
      </section>
    </PageContainer>
  )
}
