/**
 * Subject picker + download for the class-grades Excel export (#221). Opened
 * from the /classes bulk bar with the selected class ids. Builds the union of
 * data-bearing subjects across those classes (same source as the print page),
 * lets the teacher narrow the set, then downloads one workbook with one sheet
 * per class via GET /api/grades/export.xlsx.
 */
import { useEffect, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useQueries } from '@tanstack/react-query'

import { api, ApiError, type ClassGradeCardsView, type GradeCardSubject } from '../lib/api'

const PRIMARY_BTN =
  'inline-flex items-center px-4 py-2 rounded-lg bg-amber-500 hover:bg-amber-600 active:bg-amber-700 text-white text-sm font-medium shadow-sm transition-colors disabled:bg-slate-300 disabled:cursor-not-allowed'

const SECONDARY_BTN =
  'inline-flex items-center px-4 py-2 rounded-lg bg-white border border-slate-200 hover:border-slate-300 hover:bg-slate-50 text-slate-700 text-sm font-medium shadow-sm transition-colors disabled:opacity-60'

export function GradeExcelExportModal({
  ids,
  semesterId,
  filename,
  onClose,
}: {
  ids: string[]
  semesterId?: string
  filename: string
  onClose: () => void
}) {
  const { t } = useTranslation()

  const results = useQueries({
    queries: ids.map((id) => ({
      queryKey: ['grade-cards', id, semesterId ?? 'current'],
      queryFn: () => api.grades.gradeCards(id, semesterId),
    })),
  })

  const loading = results.some((r) => r.isLoading)
  const classes = results
    .map((r) => r.data)
    .filter((d): d is ClassGradeCardsView => !!d)

  // Union of subjects across the selected classes, de-duped by id. Only
  // data-bearing subjects appear (grade-cards lists subjects that have grades).
  const allSubjects = useMemo(() => {
    const seen = new Map<string, GradeCardSubject>()
    for (const c of classes) {
      for (const s of c.subjects)
        if (!seen.has(s.subject_id)) seen.set(s.subject_id, s)
    }
    return [...seen.values()]
  }, [classes])

  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [inited, setInited] = useState(false)
  useEffect(() => {
    if (!inited && allSubjects.length > 0) {
      setSelected(new Set(allSubjects.map((s) => s.subject_id)))
      setInited(true)
    }
  }, [allSubjects, inited])

  const [pending, setPending] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const subjectLabel = (s: GradeCardSubject) =>
    s.subject_system_key
      ? t(`subject.${s.subject_system_key}`)
      : (s.subject_display_name ?? '—')

  function toggle(id: string) {
    setSelected((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  const allChecked =
    allSubjects.length > 0 && allSubjects.every((s) => selected.has(s.subject_id))
  function toggleAll() {
    setSelected(
      allChecked ? new Set() : new Set(allSubjects.map((s) => s.subject_id)),
    )
  }

  async function download() {
    setPending(true)
    setError(null)
    try {
      await api.grades.exportExcel(ids, [...selected], semesterId, filename)
      onClose()
    } catch (e) {
      setError(
        e instanceof ApiError && e.body?.message
          ? e.body.message
          : t('common.error_generic'),
      )
    } finally {
      setPending(false)
    }
  }

  const canDownload = !pending && !loading && selected.size > 0

  return (
    <div
      className="fixed inset-0 bg-slate-900/50 backdrop-blur-sm flex items-center justify-center p-4 z-50"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget && !pending) onClose()
      }}
    >
      <div className="bg-white rounded-2xl shadow-xl border border-slate-200 p-6 w-full max-w-md">
        <h2 className="text-lg font-semibold tracking-tight mb-1 text-slate-900">
          {t('classes.export.title')}
        </h2>
        <p className="text-sm text-slate-500 mb-4">
          {t('classes.export.subtitle', { count: ids.length })}
        </p>

        {loading && (
          <div className="py-8 text-center text-sm text-slate-400">
            {t('common.loading')}
          </div>
        )}

        {!loading && allSubjects.length === 0 && (
          <div className="py-8 text-center text-sm text-slate-500">
            {t('classes.export.no_subjects')}
          </div>
        )}

        {!loading && allSubjects.length > 0 && (
          <>
            <div className="flex items-center justify-between mb-2">
              <span className="text-sm font-medium text-slate-700">
                {t('classes.export.select_subjects')}
              </span>
              <button
                type="button"
                onClick={toggleAll}
                className="text-xs text-amber-700 hover:text-amber-800 font-medium"
              >
                {allChecked
                  ? t('classes.export.clear_all')
                  : t('classes.export.select_all')}
              </button>
            </div>
            <div className="flex flex-wrap gap-x-4 gap-y-2 mb-4 max-h-48 overflow-y-auto">
              {allSubjects.map((s) => (
                <label
                  key={s.subject_id}
                  className="inline-flex items-center gap-1.5 text-sm cursor-pointer"
                >
                  <input
                    type="checkbox"
                    checked={selected.has(s.subject_id)}
                    onChange={() => toggle(s.subject_id)}
                  />
                  {subjectLabel(s)}
                </label>
              ))}
            </div>
          </>
        )}

        {error && (
          <div className="mb-3 rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-700">
            {error}
          </div>
        )}

        <div className="flex justify-end gap-2">
          <button
            type="button"
            onClick={onClose}
            disabled={pending}
            className={SECONDARY_BTN}
          >
            {t('common.cancel')}
          </button>
          <button
            type="button"
            onClick={download}
            disabled={!canDownload}
            className={PRIMARY_BTN}
          >
            {pending
              ? t('classes.export.exporting')
              : t('classes.export.download')}
          </button>
        </div>
      </div>
    </div>
  )
}
