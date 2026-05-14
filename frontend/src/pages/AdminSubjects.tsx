import { useEffect, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'

import { PageContainer } from '../layout/PageContainer'
import { PageHeader } from '../layout/PageHeader'
import { api, ApiError, type Subject } from '../lib/api'

const PRIMARY_BTN =
  'inline-flex items-center px-4 py-2 rounded-lg bg-amber-500 hover:bg-amber-600 active:bg-amber-700 text-white text-sm font-medium shadow-sm transition-colors disabled:bg-slate-300 disabled:shadow-none disabled:cursor-not-allowed'

const SECONDARY_BTN =
  'inline-flex items-center px-4 py-2 rounded-lg bg-white border border-slate-200 hover:border-slate-300 hover:bg-slate-50 text-slate-700 text-sm font-medium shadow-sm transition-colors disabled:opacity-60 disabled:cursor-not-allowed'

const CATEGORY_ORDER = [
  'major_exam',
  'quiz',
  'homework',
  'attendance',
  'extra',
] as const

const EXTRA_KEY = 'extra'

export function AdminSubjects() {
  const { t } = useTranslation()
  const qc = useQueryClient()

  const subjectsQ = useQuery({
    queryKey: ['subjects'],
    queryFn: () => api.subjects.list(),
  })
  const weightsQ = useQuery({
    queryKey: ['subject-weights'],
    queryFn: () => api.subjectWeights.list(),
  })

  const subjects = subjectsQ.data?.data ?? []
  const weights = weightsQ.data?.data ?? []

  // draft[subject_id][category_system_key] = weight
  const [draft, setDraft] = useState<Record<string, Record<string, number>>>({})

  useEffect(() => {
    if (weights.length > 0) {
      const next: Record<string, Record<string, number>> = {}
      for (const w of weights) {
        next[w.subject_id] ??= {}
        next[w.subject_id][w.category_system_key] = w.weight
      }
      setDraft(next)
    }
  }, [weightsQ.data])

  // Lookup: subject_id × category_system_key → category_id (needed for PUT)
  const catIdLookup = useMemo(() => {
    const m: Record<string, Record<string, string>> = {}
    for (const w of weights) {
      m[w.subject_id] ??= {}
      m[w.subject_id][w.category_system_key] = w.category_id
    }
    return m
  }, [weights])

  // Original snapshot for dirty + reset
  const original = useMemo(() => {
    const m: Record<string, Record<string, number>> = {}
    for (const w of weights) {
      m[w.subject_id] ??= {}
      m[w.subject_id][w.category_system_key] = w.weight
    }
    return m
  }, [weights])

  const dirty = useMemo(() => {
    for (const sid of Object.keys(draft)) {
      for (const ck of Object.keys(draft[sid])) {
        if ((original[sid]?.[ck] ?? -1) !== draft[sid][ck]) return true
      }
    }
    return false
  }, [draft, original])

  // Per-subject sum of non-extra weights
  const sumsBySubject = useMemo(() => {
    const out: Record<string, number> = {}
    for (const sid of Object.keys(draft)) {
      let s = 0
      for (const k of CATEGORY_ORDER) {
        if (k === EXTRA_KEY) continue
        s += draft[sid][k] ?? 0
      }
      out[sid] = s
    }
    return out
  }, [draft])

  const allRowsValid = subjects.every(
    (s) => sumsBySubject[s.id] === 100 || sumsBySubject[s.id] === undefined,
  )

  const updateMut = useMutation({
    mutationFn: (payload: Parameters<typeof api.subjectWeights.update>[0]) =>
      api.subjectWeights.update(payload),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['subject-weights'] }),
  })

  const [saveErr, setSaveErr] = useState<string | null>(null)
  const [savedAt, setSavedAt] = useState<number | null>(null)

  async function onSave() {
    setSaveErr(null)
    setSavedAt(null)
    const payload: { subject_id: string; category_id: string; weight: number }[] = []
    for (const sid of Object.keys(draft)) {
      for (const ck of Object.keys(draft[sid])) {
        const w = draft[sid][ck]
        if ((original[sid]?.[ck] ?? -1) === w) continue
        const cid = catIdLookup[sid]?.[ck]
        if (!cid) continue
        payload.push({ subject_id: sid, category_id: cid, weight: w })
      }
    }
    if (payload.length === 0) return
    try {
      await updateMut.mutateAsync(payload)
      setSavedAt(Date.now())
    } catch (err) {
      setSaveErr(err instanceof Error ? err.message : 'unknown')
    }
  }

  function onReset() {
    setDraft(JSON.parse(JSON.stringify(original)))
    setSaveErr(null)
    setSavedAt(null)
  }

  const [showAdd, setShowAdd] = useState(false)
  const canSave = dirty && allRowsValid && !updateMut.isPending

  return (
    <PageContainer>
      <PageHeader
        title={t('admin_subjects.title')}
        subtitle={t('admin_subjects.subtitle')}
        actions={
          <button onClick={() => setShowAdd(true)} className={PRIMARY_BTN}>
            {t('admin_subjects.add_subject')}
          </button>
        }
      />

      {(subjectsQ.isLoading || weightsQ.isLoading) && (
        <div className="text-center text-slate-400 py-16">
          {t('common.loading')}
        </div>
      )}

      {!subjectsQ.isLoading && !weightsQ.isLoading && (
        <section className="bg-white border border-slate-200 rounded-xl shadow-sm overflow-hidden">
          <div className="overflow-x-auto">
            <table className="min-w-full text-sm">
              <thead className="bg-slate-50 border-b border-slate-200 text-slate-600">
                <tr>
                  <th className="px-4 py-3 text-left font-medium">
                    {t('admin_subjects.col.subject')}
                  </th>
                  {CATEGORY_ORDER.map((k) => (
                    <th
                      key={k}
                      className="px-3 py-3 text-left font-medium"
                    >
                      {t(`category.${k}`)}
                    </th>
                  ))}
                  <th className="px-3 py-3 text-left font-medium">
                    {t('admin_subjects.col.sum')}
                  </th>
                  <th className="px-3 py-3 text-right font-medium">
                    {t('admin_subjects.col.actions')}
                  </th>
                </tr>
              </thead>
              <tbody>
                {subjects.map((s) => (
                  <WeightRow
                    key={s.id}
                    subject={s}
                    draft={draft[s.id] ?? {}}
                    sum={sumsBySubject[s.id]}
                    onChange={(k, w) =>
                      setDraft((d) => ({
                        ...d,
                        [s.id]: { ...(d[s.id] ?? {}), [k]: w },
                      }))
                    }
                  />
                ))}
              </tbody>
            </table>
          </div>

          <div className="border-t border-slate-100 px-5 py-4 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
            <p className="text-xs text-slate-500">
              {t('admin_subjects.formula_hint')}
            </p>
            <div className="flex items-center gap-2">
              {savedAt && (
                <span className="text-sm text-emerald-600">
                  {t('admin_subjects.saved')}
                </span>
              )}
              <button
                onClick={onReset}
                disabled={!dirty || updateMut.isPending}
                className={SECONDARY_BTN}
              >
                {t('common.reset')}
              </button>
              <button
                onClick={onSave}
                disabled={!canSave}
                className={PRIMARY_BTN}
                title={
                  !allRowsValid
                    ? t('admin_subjects.sum_invalid_hint')
                    : undefined
                }
              >
                {updateMut.isPending ? t('common.saving') : t('common.save')}
              </button>
            </div>
          </div>

          {saveErr && (
            <div className="border-t border-rose-100 bg-rose-50 px-5 py-3 text-sm text-rose-700">
              {t('common.error_generic')}: {saveErr}
            </div>
          )}
        </section>
      )}

      {showAdd && <AddSubjectModal onClose={() => setShowAdd(false)} />}
    </PageContainer>
  )
}

function WeightRow({
  subject,
  draft,
  sum,
  onChange,
}: {
  subject: Subject
  draft: Record<string, number>
  sum: number | undefined
  onChange: (cat: string, w: number) => void
}) {
  const { t } = useTranslation()
  const qc = useQueryClient()
  const del = useMutation({
    mutationFn: (id: string) => api.subjects.remove(id),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['subjects'] })
      qc.invalidateQueries({ queryKey: ['subject-weights'] })
    },
  })
  const label = subject.system_key
    ? t(`subject.${subject.system_key}`)
    : (subject.display_name ?? '—')
  const sumOk = sum === 100

  function onDelete() {
    if (!subject.is_custom) return
    if (
      window.confirm(t('admin_subjects.confirm_delete', { name: label }))
    ) {
      del.mutate(subject.id)
    }
  }

  return (
    <tr className="border-b border-slate-100 last:border-b-0">
      <td className="px-4 py-2.5 text-slate-900 font-medium">
        {label}
        {subject.is_custom && (
          <span className="ml-2 text-[10px] uppercase tracking-wider text-amber-700 bg-amber-50 rounded-full px-2 py-0.5">
            {t('admin_subjects.custom_badge')}
          </span>
        )}
      </td>
      {CATEGORY_ORDER.map((k) => (
        <td key={k} className="px-2 py-2.5">
          <div className="flex items-center gap-1">
            <input
              type="number"
              inputMode="numeric"
              min={0}
              max={100}
              value={draft[k] ?? 0}
              onChange={(e) => {
                const n = e.target.value === '' ? 0 : Number(e.target.value)
                if (Number.isNaN(n)) return
                onChange(k, Math.max(0, Math.min(100, Math.trunc(n))))
              }}
              className="w-16 border border-slate-300 rounded-md px-2 py-1 text-sm text-right focus:outline-none focus:ring-2 focus:ring-amber-500"
              aria-label={`${label} ${t(`category.${k}`)}`}
            />
            <span className="text-xs text-slate-400">%</span>
          </div>
        </td>
      ))}
      <td className="px-3 py-2.5">
        <span
          className={`text-sm font-mono tabular-nums ${
            sum === undefined
              ? 'text-slate-400'
              : sumOk
                ? 'text-slate-600'
                : 'text-rose-600 font-medium'
          }`}
        >
          {sum ?? '—'} / 100
        </span>
      </td>
      <td className="px-3 py-2.5 text-right">
        {subject.is_custom && (
          <button
            onClick={onDelete}
            disabled={del.isPending}
            className="text-rose-600 hover:text-rose-800 font-medium text-sm"
          >
            {t('classes.actions.delete')}
          </button>
        )}
      </td>
    </tr>
  )
}

function AddSubjectModal({ onClose }: { onClose: () => void }) {
  const { t } = useTranslation()
  const qc = useQueryClient()
  const [name, setName] = useState('')
  const [errKey, setErrKey] = useState<string | null>(null)
  const create = useMutation({
    mutationFn: (display_name: string) =>
      api.subjects.create(display_name),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['subjects'] })
      qc.invalidateQueries({ queryKey: ['subject-weights'] })
      onClose()
    },
    onError: (err) => {
      if (err instanceof ApiError && err.body?.message_key) {
        setErrKey(err.body.message_key)
      } else {
        setErrKey('common.error_generic')
      }
    },
  })

  return (
    <div
      className="fixed inset-0 bg-slate-900/50 backdrop-blur-sm flex items-center justify-center p-4 z-50"
      onClick={onClose}
    >
      <form
        onSubmit={(e) => {
          e.preventDefault()
          if (!name.trim()) return
          create.mutate(name.trim())
        }}
        onClick={(e) => e.stopPropagation()}
        className="bg-white rounded-2xl shadow-xl border border-slate-200 p-6 w-full max-w-md"
      >
        <h2 className="text-lg font-semibold tracking-tight mb-4 text-slate-900">
          {t('admin_subjects.modal.add_title')}
        </h2>
        <label className="block text-sm font-medium text-slate-700 mb-1.5">
          {t('admin_subjects.modal.name_label')}
        </label>
        <input
          autoFocus
          value={name}
          onChange={(e) => setName(e.target.value)}
          maxLength={100}
          placeholder={t('admin_subjects.modal.name_placeholder')}
          className="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-amber-500"
        />
        {errKey && <p className="mt-2 text-sm text-rose-600">{t(errKey)}</p>}
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
            disabled={!name.trim() || create.isPending}
            className={PRIMARY_BTN}
          >
            {create.isPending ? t('common.saving') : t('common.save')}
          </button>
        </div>
      </form>
    </div>
  )
}

