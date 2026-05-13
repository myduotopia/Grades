import { useState } from 'react'
import { useTranslation } from 'react-i18next'

import {
  api,
  ApiError,
  SYSTEM_SUBJECT_KEYS,
  type GradeImportResult,
  type SystemSubjectKey,
} from '../lib/api'

const PRIMARY_BTN =
  'inline-flex items-center px-4 py-2 rounded-lg bg-amber-500 hover:bg-amber-600 active:bg-amber-700 text-white text-sm font-medium shadow-sm transition-colors disabled:bg-slate-300'

const SECONDARY_BTN =
  'inline-flex items-center px-4 py-2 rounded-lg bg-white border border-slate-200 hover:border-slate-300 hover:bg-slate-50 text-slate-700 text-sm font-medium shadow-sm transition-colors disabled:opacity-60'

interface Props {
  classroomId: string
  onClose: () => void
  onComplete?: () => void
}

export function GradeImportModal({ classroomId, onClose, onComplete }: Props) {
  const { t } = useTranslation()
  const [file, setFile] = useState<File | null>(null)
  const [preview, setPreview] = useState<GradeImportResult | null>(null)
  const [subjects, setSubjects] = useState<Record<number, SystemSubjectKey | ''>>({})
  const [busy, setBusy] = useState(false)
  const [errKey, setErrKey] = useState<string | null>(null)
  const [errMessage, setErrMessage] = useState<string | null>(null)

  async function onPreview() {
    if (!file) return
    setBusy(true)
    setErrKey(null)
    setErrMessage(null)
    try {
      const result = await api.grades.preview(classroomId, file)
      setPreview(result)
      // Reset subjects keyed by column_index — only non-error columns need one.
      const next: Record<number, SystemSubjectKey | ''> = {}
      for (const c of result.columns) {
        if (c.errors.length === 0) next[c.column_index] = ''
      }
      setSubjects(next)
    } catch (err) {
      _captureError(err, setErrKey, setErrMessage)
    } finally {
      setBusy(false)
    }
  }

  async function onConfirm() {
    if (!file || !preview) return
    // Filter to only column_index → chosen subject (no '' entries)
    const chosen: Record<number, SystemSubjectKey> = {}
    for (const [k, v] of Object.entries(subjects)) {
      if (v) chosen[Number(k)] = v
    }
    setBusy(true)
    setErrKey(null)
    setErrMessage(null)
    try {
      await api.grades.commit(classroomId, file, chosen)
      onComplete?.()
      onClose()
    } catch (err) {
      _captureError(err, setErrKey, setErrMessage)
    } finally {
      setBusy(false)
    }
  }

  async function onDownloadTemplate() {
    try {
      await api.grades.downloadTemplate(classroomId)
    } catch {
      setErrKey('common.error_generic')
    }
  }

  const hasErrors = (preview?.summary.errors ?? 0) > 0
  const allSubjectsPicked = preview
    ? preview.columns.every(
        (c) => c.errors.length > 0 || (subjects[c.column_index] ?? '') !== '',
      )
    : false

  return (
    <div
      className="fixed inset-0 bg-slate-900/50 backdrop-blur-sm flex items-center justify-center p-4 z-50"
      onClick={onClose}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className="bg-white rounded-2xl shadow-xl border border-slate-200 p-6 w-full max-w-4xl max-h-[90vh] overflow-y-auto"
      >
        <h2 className="text-lg font-semibold tracking-tight mb-4 text-slate-900">
          {t('grades.import.title')}
        </h2>

        {!preview && (
          <>
            <p className="text-sm text-slate-600 mb-4">
              {t('grades.import.intro')}
            </p>
            <button
              type="button"
              onClick={onDownloadTemplate}
              className="text-sm text-amber-700 hover:text-amber-900 underline mb-4"
            >
              {t('grades.import.download_template')}
            </button>
            <label className="block">
              <span className="text-sm font-medium text-slate-700 mb-1.5 block">
                {t('grades.import.file_label')}
              </span>
              <input
                type="file"
                accept=".xlsx"
                onChange={(e) => setFile(e.target.files?.[0] ?? null)}
                className="block w-full text-sm text-slate-600 file:mr-4 file:py-2 file:px-4 file:rounded-lg file:border-0 file:text-sm file:font-medium file:bg-slate-100 file:text-slate-700 hover:file:bg-slate-200"
              />
            </label>
          </>
        )}

        {preview && (
          <PreviewSection
            result={preview}
            subjects={subjects}
            onSubjectChange={(col, key) =>
              setSubjects((s) => ({ ...s, [col]: key }))
            }
          />
        )}

        {errKey && (
          <p className="mt-3 text-sm text-rose-600">
            {t(errKey)}
            {errMessage && (
              <span className="block text-rose-500/80 mt-0.5">{errMessage}</span>
            )}
          </p>
        )}

        <div className="mt-6 flex justify-end gap-2">
          <button
            type="button"
            onClick={onClose}
            disabled={busy}
            className="px-4 py-2 text-slate-700 hover:bg-slate-100 rounded-lg text-sm font-medium"
          >
            {t('common.cancel')}
          </button>
          {!preview && (
            <button
              type="button"
              onClick={onPreview}
              disabled={!file || busy}
              className={PRIMARY_BTN}
            >
              {t('grades.import.preview')}
            </button>
          )}
          {preview && (
            <>
              <button
                type="button"
                onClick={() => {
                  setPreview(null)
                  setSubjects({})
                }}
                disabled={busy}
                className={SECONDARY_BTN}
              >
                {t('grades.import.choose_another')}
              </button>
              <button
                type="button"
                onClick={onConfirm}
                disabled={busy || hasErrors || !allSubjectsPicked}
                title={
                  !allSubjectsPicked
                    ? t('grades.import.subject_missing_hint')
                    : undefined
                }
                className={PRIMARY_BTN}
              >
                {t('grades.import.confirm')}
              </button>
            </>
          )}
        </div>
      </div>
    </div>
  )
}

function PreviewSection({
  result,
  subjects,
  onSubjectChange,
}: {
  result: GradeImportResult
  subjects: Record<number, SystemSubjectKey | ''>
  onSubjectChange: (col: number, key: SystemSubjectKey | '') => void
}) {
  const { t } = useTranslation()
  const s = result.summary
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap gap-4 text-sm">
        <span className="text-slate-600">
          {t('grades.import.summary.columns', { n: s.column_total })}
        </span>
        <span className="text-slate-600">
          {t('grades.import.summary.rows', { n: s.row_total })}
        </span>
        <span className="text-emerald-700">
          {t('grades.import.summary.scores', { n: s.score_total })}
        </span>
        {s.errors > 0 && (
          <span className="text-rose-700 font-medium">
            {t('grades.import.summary.errors', { n: s.errors })}
          </span>
        )}
      </div>

      <section>
        <h3 className="text-sm font-semibold text-slate-700 mb-2">
          {t('grades.import.columns_heading')}
        </h3>
        <div className="overflow-x-auto border border-slate-200 rounded-lg">
          <table className="min-w-full text-xs">
            <thead className="bg-slate-50 text-slate-600">
              <tr>
                <th className="px-2 py-2 text-left font-medium">
                  {t('grades.import.col.column')}
                </th>
                <th className="px-2 py-2 text-left font-medium">
                  {t('grades.import.col.category')}
                </th>
                <th className="px-2 py-2 text-left font-medium">
                  {t('grades.import.col.date')}
                </th>
                <th className="px-2 py-2 text-left font-medium">
                  {t('grades.import.col.name')}
                </th>
                <th className="px-2 py-2 text-left font-medium">
                  {t('grades.import.col.subject')}
                </th>
                <th className="px-2 py-2 text-left font-medium">
                  {t('grades.import.errors')}
                </th>
              </tr>
            </thead>
            <tbody>
              {result.columns.map((c) => {
                const isErr = c.errors.length > 0
                return (
                  <tr
                    key={c.column_index}
                    className={`border-t border-slate-100 ${
                      isErr ? 'bg-rose-50' : ''
                    }`}
                  >
                    <td className="px-2 py-1.5 text-slate-500">
                      {colLetter(c.column_index)}
                    </td>
                    <td className="px-2 py-1.5 text-slate-700">
                      {c.category_input ?? '—'}
                    </td>
                    <td className="px-2 py-1.5 text-slate-500">
                      {c.exam_date ?? '—'}
                    </td>
                    <td className="px-2 py-1.5 text-slate-700">
                      {c.exam_name}
                    </td>
                    <td className="px-2 py-1.5">
                      {isErr ? (
                        <span className="text-slate-400">—</span>
                      ) : (
                        <select
                          value={subjects[c.column_index] ?? ''}
                          onChange={(e) =>
                            onSubjectChange(
                              c.column_index,
                              e.target.value as SystemSubjectKey | '',
                            )
                          }
                          className="border border-slate-300 rounded px-2 py-1 text-xs focus:outline-none focus:ring-2 focus:ring-amber-500 bg-white"
                        >
                          <option value="">
                            {t('grades.import.subject_picker')}
                          </option>
                          {SYSTEM_SUBJECT_KEYS.map((k) => (
                            <option key={k} value={k}>
                              {t(`subject.${k}`)}
                            </option>
                          ))}
                        </select>
                      )}
                    </td>
                    <td className="px-2 py-1.5 text-rose-700">
                      {c.errors.join('; ')}
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      </section>

      <section>
        <h3 className="text-sm font-semibold text-slate-700 mb-2">
          {t('grades.import.students_heading')}
        </h3>
        <div className="overflow-x-auto border border-slate-200 rounded-lg">
          <table className="min-w-full text-xs">
            <thead className="bg-slate-50 text-slate-600">
              <tr>
                <th className="px-2 py-2 text-left font-medium">#</th>
                <th className="px-2 py-2 text-left font-medium">
                  {t('students.col.seat')}
                </th>
                {result.columns.map((c) => (
                  <th
                    key={c.column_index}
                    className="px-2 py-2 text-left font-medium"
                  >
                    {c.exam_name}
                  </th>
                ))}
                <th className="px-2 py-2 text-left font-medium">
                  {t('grades.import.errors')}
                </th>
              </tr>
            </thead>
            <tbody>
              {result.students.map((r) => {
                const isErr = r.errors.length > 0
                return (
                  <tr
                    key={r.row_number}
                    className={`border-t border-slate-100 ${
                      isErr ? 'bg-rose-50' : ''
                    }`}
                  >
                    <td className="px-2 py-1.5 text-slate-500">
                      {r.row_number}
                    </td>
                    <td className="px-2 py-1.5 text-slate-700">
                      {r.seat_number ?? '—'}
                    </td>
                    {result.columns.map((c) => (
                      <td
                        key={c.column_index}
                        className="px-2 py-1.5 text-slate-700"
                      >
                        {r.scores[c.column_index] ?? '—'}
                      </td>
                    ))}
                    <td className="px-2 py-1.5 text-rose-700">
                      {r.errors.join('; ')}
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  )
}

function colLetter(index: number): string {
  let n = index
  let s = ''
  while (n >= 0) {
    s = String.fromCharCode((n % 26) + 65) + s
    n = Math.floor(n / 26) - 1
  }
  return s
}

function _captureError(
  err: unknown,
  setErrKey: (k: string) => void,
  setErrMessage: (m: string | null) => void,
) {
  if (err instanceof ApiError && err.body?.message_key) {
    setErrKey(err.body.message_key)
    setErrMessage(err.body.message || null)
  } else {
    setErrKey('common.error_generic')
    setErrMessage(null)
  }
}
