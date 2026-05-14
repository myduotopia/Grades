import { useState } from 'react'
import { useTranslation } from 'react-i18next'

import { api, ApiError, type ImportResult } from '../lib/api'

const PRIMARY_BTN =
  'inline-flex items-center px-4 py-2 rounded-lg bg-amber-500 hover:bg-amber-600 active:bg-amber-700 text-white text-sm font-medium shadow-sm transition-colors disabled:bg-slate-300'

const SECONDARY_BTN =
  'inline-flex items-center px-4 py-2 rounded-lg bg-white border border-slate-200 hover:border-slate-300 hover:bg-slate-50 text-slate-700 text-sm font-medium shadow-sm transition-colors disabled:opacity-60'

interface Props {
  classroomId: string
  onClose: () => void
  onComplete?: () => void
}

export function StudentImportModal({ classroomId, onClose, onComplete }: Props) {
  const { t } = useTranslation()
  const [file, setFile] = useState<File | null>(null)
  const [preview, setPreview] = useState<ImportResult | null>(null)
  const [busy, setBusy] = useState(false)
  const [errKey, setErrKey] = useState<string | null>(null)

  async function onPreview() {
    if (!file) return
    setBusy(true)
    setErrKey(null)
    try {
      const result = await api.students.import(classroomId, file, true)
      setPreview(result)
    } catch (err) {
      if (err instanceof ApiError && err.body?.message_key) {
        setErrKey(err.body.message_key)
      } else {
        setErrKey('common.error_generic')
      }
    } finally {
      setBusy(false)
    }
  }

  async function onConfirm() {
    if (!file) return
    setBusy(true)
    setErrKey(null)
    try {
      await api.students.import(classroomId, file, false)
      onComplete?.()
      onClose()
    } catch (err) {
      if (err instanceof ApiError && err.body?.message_key) {
        setErrKey(err.body.message_key)
      } else {
        setErrKey('common.error_generic')
      }
    } finally {
      setBusy(false)
    }
  }

  async function onDownloadTemplate() {
    try {
      await api.students.downloadTemplate(classroomId)
    } catch {
      setErrKey('common.error_generic')
    }
  }

  const hasErrors = (preview?.summary.errors ?? 0) > 0

  return (
    <div
      className="fixed inset-0 bg-slate-900/50 backdrop-blur-sm flex items-center justify-center p-4 z-50"
      onClick={onClose}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className="bg-white rounded-2xl shadow-xl border border-slate-200 p-6 w-full max-w-3xl max-h-[90vh] overflow-y-auto"
      >
        <h2 className="text-lg font-semibold tracking-tight mb-4 text-slate-900">
          {t('students.import.title')}
        </h2>

        {!preview && (
          <>
            <p className="text-sm text-slate-600 mb-4">
              {t('students.import.intro')}
            </p>
            <button
              type="button"
              onClick={onDownloadTemplate}
              className="text-sm text-amber-700 hover:text-amber-900 underline mb-4"
            >
              {t('students.import.download_template')}
            </button>
            <label className="block">
              <span className="text-sm font-medium text-slate-700 mb-1.5 block">
                {t('students.import.file_label')}
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

        {preview && <PreviewTable result={preview} />}

        {errKey && <p className="mt-3 text-sm text-rose-600">{t(errKey)}</p>}

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
              {t('students.import.preview')}
            </button>
          )}
          {preview && (
            <>
              <button
                type="button"
                onClick={() => setPreview(null)}
                disabled={busy}
                className={SECONDARY_BTN}
              >
                {t('students.import.choose_another')}
              </button>
              <button
                type="button"
                onClick={onConfirm}
                disabled={busy || hasErrors}
                className={PRIMARY_BTN}
              >
                {t('students.import.confirm')}
              </button>
            </>
          )}
        </div>
      </div>
    </div>
  )
}

function PreviewTable({ result }: { result: ImportResult }) {
  const { t } = useTranslation()
  const s = result.summary
  return (
    <div>
      <div className="flex flex-wrap gap-4 mb-4 text-sm">
        <span className="text-slate-600">
          {t('students.import.summary.total', { n: s.total_rows })}
        </span>
        <span className="text-emerald-700">
          {t('students.import.summary.create', { n: s.to_create })}
        </span>
        <span className="text-amber-700">
          {t('students.import.summary.update', { n: s.to_update })}
        </span>
        {s.errors > 0 && (
          <span className="text-rose-700 font-medium">
            {t('students.import.summary.errors', { n: s.errors })}
          </span>
        )}
      </div>
      <div className="overflow-x-auto border border-slate-200 rounded-lg">
        <table className="min-w-full text-xs">
          <thead className="bg-slate-50 text-slate-600">
            <tr>
              <th className="px-2 py-2 text-left font-medium">#</th>
              <th className="px-2 py-2 text-left font-medium">
                {t('students.import.action')}
              </th>
              <th className="px-2 py-2 text-left font-medium">
                {t('students.col.seat')}
              </th>
              <th className="px-2 py-2 text-left font-medium">
                {t('students.col.name')}
              </th>
              <th className="px-2 py-2 text-left font-medium">
                {t('students.col.email')}
              </th>
              <th className="px-2 py-2 text-left font-medium">
                {t('students.import.errors')}
              </th>
            </tr>
          </thead>
          <tbody>
            {result.rows.map((r) => {
              const isErr = r.action === 'error'
              return (
                <tr
                  key={r.row_number}
                  className={`border-t border-slate-100 ${
                    isErr ? 'bg-rose-50' : ''
                  }`}
                >
                  <td className="px-2 py-1.5 text-slate-500">{r.row_number}</td>
                  <td className="px-2 py-1.5">
                    <span
                      className={
                        r.action === 'create'
                          ? 'text-emerald-700'
                          : r.action === 'update'
                            ? 'text-amber-700'
                            : 'text-rose-700 font-medium'
                      }
                    >
                      {t(`students.import.action_label.${r.action}`)}
                    </span>
                  </td>
                  <td className="px-2 py-1.5 text-slate-700">
                    {r.seat_number ?? '—'}
                  </td>
                  <td className="px-2 py-1.5 text-slate-700">{r.name ?? '—'}</td>
                  <td className="px-2 py-1.5 text-slate-500 break-all">
                    {r.email ?? '—'}
                  </td>
                  <td className="px-2 py-1.5 text-rose-700">
                    {r.errors.join('; ')}
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>
    </div>
  )
}
