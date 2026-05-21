import { useState } from 'react'
import { useTranslation } from 'react-i18next'

import { formatSemester } from '../components/SemesterSwitcher'
import {
  useCreateSemester,
  useDeleteSemester,
  useSemesters,
  useSetCurrentSemester,
  useUpdateSemester,
} from '../hooks/useSemesters'
import { useMe, useUpdateMeSettings } from '../hooks/useMe'
import { PageContainer } from '../layout/PageContainer'
import { PageHeader } from '../layout/PageHeader'
import { ApiError, type Semester } from '../lib/api'
import { defaultSemesterDates } from '../lib/semesterDates'
import { formatDateRange } from '../lib/semesterFormat'

const PRIMARY_BTN =
  'inline-flex items-center px-4 py-2 rounded-lg bg-amber-500 hover:bg-amber-600 active:bg-amber-700 text-white text-sm font-medium shadow-sm transition-colors disabled:bg-slate-300 disabled:shadow-none disabled:cursor-not-allowed'

const TERM_OPTIONS = [2, 3, 4] as const

type ModalState =
  | { kind: 'closed' }
  | { kind: 'add' }
  | { kind: 'edit'; semester: Semester }

/** Suggest defaults for a new semester based on today's date.
 *  Taiwan 學年度 starts Aug 1; the Minguo year of a (Feb–Jul) date is LAST
 *  August's Minguo number, not today.year - 1911 (see issue #142). */
function suggestedDefaults(termsPerYear: 2 | 3 | 4): {
  academic_year: number
  term: 1 | 2 | 3 | 4
  start_date: string
  end_date: string
} {
  const today = new Date()
  const y = today.getFullYear()
  const m = today.getMonth() + 1 // 1-12
  const academicGregYear = m >= 8 ? y : y - 1
  const taiwanYear = academicGregYear - 1911
  const monthsPerTerm = 12 / termsPerYear
  const monthsFromAug = m >= 8 ? m - 8 : m + 4 // 0..11
  const term = (Math.floor(monthsFromAug / monthsPerTerm) + 1) as 1 | 2 | 3 | 4
  const { start_date, end_date } = defaultSemesterDates(taiwanYear, term, termsPerYear)
  return { academic_year: taiwanYear, term, start_date, end_date }
}

export function AdminSemesters() {
  const { t } = useTranslation()
  const meQ = useMe()
  const semestersQ = useSemesters()
  const setCurrent = useSetCurrentSemester()
  const deleteSem = useDeleteSemester()
  const updateSettings = useUpdateMeSettings()
  const [savedFlash, setSavedFlash] = useState(false)
  const [modal, setModal] = useState<ModalState>({ kind: 'closed' })
  const [actionErr, setActionErr] = useState<string | null>(null)

  const termsPerYear = (meQ.data?.terms_per_year ?? 2) as 2 | 3 | 4
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
            onClick={() => setModal({ kind: 'add' })}
            className={PRIMARY_BTN}
          >
            {t('admin_semesters.add')}
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
                className="border-b border-slate-100 last:border-b-0 flex items-center justify-between px-5 py-3 hover:bg-slate-50"
              >
                <label className="flex items-center gap-3 cursor-pointer flex-1">
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
                  <div className="flex flex-col">
                    <div className="flex items-center gap-2">
                      <span className="text-slate-900 font-medium">
                        {formatSemester(s)}
                      </span>
                      {s.is_current && (
                        <span className="text-[10px] uppercase tracking-wider text-amber-700 bg-amber-50 rounded-full px-2 py-0.5">
                          {t('admin_semesters.current_badge')}
                        </span>
                      )}
                    </div>
                    <span className="text-xs text-slate-500 mt-0.5 font-mono">
                      {s.start_date} ~ {s.end_date}
                    </span>
                  </div>
                </label>
                <div className="flex items-center gap-3 text-sm">
                  <button
                    onClick={() => {
                      setActionErr(null)
                      setModal({ kind: 'edit', semester: s })
                    }}
                    className="text-slate-600 hover:text-slate-900 font-medium"
                  >
                    {t('admin_semesters.edit')}
                  </button>
                  <button
                    onClick={() => {
                      if (
                        !window.confirm(
                          t('admin_semesters.confirm_delete', {
                            label: formatSemester(s),
                          }),
                        )
                      )
                        return
                      setActionErr(null)
                      deleteSem.mutate(s.id, {
                        onError: (err) => {
                          if (err instanceof ApiError && err.body?.message_key) {
                            setActionErr(err.body.message_key)
                          } else {
                            setActionErr('common.error_generic')
                          }
                        },
                      })
                    }}
                    disabled={deleteSem.isPending}
                    className="text-rose-600 hover:text-rose-800 font-medium disabled:opacity-50"
                  >
                    {t('common.delete')}
                  </button>
                </div>
              </li>
            ))}
          </ul>
        )}

        {actionErr && (
          <div className="border-t border-rose-100 bg-rose-50 px-5 py-3 text-sm text-rose-700">
            {t(actionErr)}
          </div>
        )}
      </section>

      {modal.kind !== 'closed' && (
        <SemesterModal
          mode={modal.kind}
          semester={modal.kind === 'edit' ? modal.semester : undefined}
          defaults={
            modal.kind === 'add' ? suggestedDefaults(termsPerYear) : undefined
          }
          termsPerYear={termsPerYear}
          onClose={() => setModal({ kind: 'closed' })}
        />
      )}
    </PageContainer>
  )
}

function SemesterModal({
  mode,
  semester,
  defaults,
  termsPerYear,
  onClose,
}: {
  mode: 'add' | 'edit'
  semester?: Semester
  defaults?: {
    academic_year: number
    term: 1 | 2 | 3 | 4
    start_date: string
    end_date: string
  }
  termsPerYear: 2 | 3 | 4
  onClose: () => void
}) {
  const { t } = useTranslation()
  const update = useUpdateSemester()
  const create = useCreateSemester()
  const init = semester ?? defaults!
  const [year, setYear] = useState(init.academic_year)
  const [term, setTerm] = useState<1 | 2 | 3 | 4>(init.term as 1 | 2 | 3 | 4)
  const [errKey, setErrKey] = useState<string | null>(null)

  // Dates are derived from (year, term, termsPerYear) — not user-editable.
  // Backend enforces the same formula (#142), so an out-of-range or typo'd
  // year can no longer silently create a semester pointing into the future.
  const computed = (() => {
    try {
      return defaultSemesterDates(year, term, termsPerYear)
    } catch {
      return null
    }
  })()
  const startDate = computed?.start_date ?? ''
  const endDate = computed?.end_date ?? ''

  const pending = mode === 'edit' ? update.isPending : create.isPending

  function onSubmit(e: React.FormEvent) {
    e.preventDefault()
    setErrKey(null)
    const body = {
      academic_year: year,
      term,
      start_date: startDate,
      end_date: endDate,
    }
    const opts = {
      onSuccess: () => onClose(),
      onError: (err: Error) => {
        if (err instanceof ApiError && err.body?.message_key) {
          setErrKey(err.body.message_key)
        } else if (err instanceof ApiError && err.status === 409) {
          setErrKey('admin_semesters.duplicate_slot')
        } else {
          setErrKey('common.error_generic')
        }
      },
    }
    if (mode === 'edit' && semester) {
      update.mutate({ id: semester.id, ...body }, opts)
    } else {
      create.mutate(body, opts)
    }
  }

  return (
    <div
      className="fixed inset-0 bg-slate-900/50 backdrop-blur-sm flex items-center justify-center p-4 z-50"
      onClick={onClose}
    >
      <form
        onSubmit={onSubmit}
        onClick={(e) => e.stopPropagation()}
        className="bg-white rounded-2xl shadow-xl border border-slate-200 p-6 w-full max-w-md"
      >
        <h2 className="text-lg font-semibold tracking-tight mb-4 text-slate-900">
          {t(
            mode === 'add'
              ? 'admin_semesters.add_title'
              : 'admin_semesters.edit_title',
          )}
        </h2>

        <label className="block text-sm font-medium text-slate-700 mb-1.5">
          {t('admin_semesters.year_label')}
        </label>
        <input
          type="number"
          inputMode="numeric"
          min={1}
          max={999}
          autoFocus
          value={year}
          onChange={(e) => setYear(Number(e.target.value))}
          className="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-amber-500"
        />

        <label className="block text-sm font-medium text-slate-700 mb-1.5 mt-4">
          {t('admin_semesters.term_label')}
        </label>
        <select
          value={term}
          onChange={(e) => setTerm(Number(e.target.value) as 1 | 2 | 3 | 4)}
          className="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-amber-500"
        >
          {Array.from({ length: termsPerYear }, (_, i) => i + 1).map((n) => (
            <option key={n} value={n}>
              {t('admin_semesters.term_option', { n })}
            </option>
          ))}
        </select>

        <div className="mt-4 rounded-lg border border-slate-200 bg-slate-50 px-3 py-2.5">
          <div className="text-xs text-slate-500 mb-0.5">
            {t('admin_semesters.computed_range_label')}
          </div>
          <div className="text-sm font-medium text-slate-800">
            {computed
              ? formatDateRange(startDate, endDate)
              : t('admin_semesters.computed_range_invalid')}
          </div>
        </div>

        {errKey && (
          <p className="mt-3 text-sm text-rose-600">{t(errKey)}</p>
        )}

        <div className="mt-6 flex justify-end gap-2">
          <button
            type="button"
            onClick={onClose}
            className="px-4 py-2 text-slate-700 hover:bg-slate-100 rounded-lg text-sm font-medium"
          >
            {t('common.cancel')}
          </button>
          <button
            type="submit"
            disabled={pending || year < 1 || year > 999 || !computed}
            className="inline-flex items-center px-4 py-2 rounded-lg bg-amber-500 hover:bg-amber-600 text-white text-sm font-medium shadow-sm disabled:bg-slate-300 disabled:cursor-not-allowed"
          >
            {pending ? t('common.saving') : t('common.save')}
          </button>
        </div>
      </form>
    </div>
  )
}
