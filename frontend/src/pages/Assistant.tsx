import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useEffect, useMemo, useState } from 'react'
import toast from 'react-hot-toast'
import { useTranslation } from 'react-i18next'

import { EnteredByBadge } from '../components/EnteredByBadge'
import { useMe } from '../hooks/useMe'
import { MinimalShell } from '../layout/MinimalShell'
import { PageContainer } from '../layout/PageContainer'
import { PageHeader } from '../layout/PageHeader'
import {
  api,
  ApiError,
  type AssistantContext,
  type AssistantContextItem,
  type ItemGradesStudentRow,
} from '../lib/api'
import { classroomDisplayName } from '../lib/classroomFormat'

const PRIMARY_BTN =
  'inline-flex items-center justify-center min-h-[44px] px-4 py-2 rounded-lg bg-amber-500 hover:bg-amber-600 active:bg-amber-700 text-white text-sm font-medium shadow-sm transition-colors disabled:bg-slate-300 disabled:shadow-none disabled:cursor-not-allowed'

const SELECT_CLS =
  'w-full sm:w-auto sm:min-w-[20rem] min-h-[44px] border border-slate-300 rounded-lg px-3 py-2 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-amber-500'

/** Selection key = class + item (one item may be assigned in two classes). */
const keyOf = (classroomId: string, itemId: string) => `${classroomId}|${itemId}`

/**
 * Student 小老師 score-entry page (#262). Outside the teacher AppShell: a
 * top bar with "name（小老師）", a dropdown of the items the teacher assigned
 * (grouped by class / teacher), and seat / name / score / save.
 *
 * The UI mirrors the backend rules but does not enforce them — the backend
 * (/api/assistant/*) does: teacher-entered scores are read-only here and
 * scores can't be cleared.
 */
export function Assistant() {
  const { t, i18n } = useTranslation()
  const { data: me } = useMe()
  const contexts = useMemo(
    () => me?.identity.assistant_contexts ?? [],
    [me],
  )
  const options = useMemo(
    () =>
      contexts.flatMap((c) =>
        c.items.map((i) => ({ ctx: c, item: i, key: keyOf(c.classroom_id, i.item_id) })),
      ),
    [contexts],
  )
  const [selected, setSelected] = useState<string>('')
  useEffect(() => {
    if (!options.some((o) => o.key === selected)) {
      setSelected(options[0]?.key ?? '')
    }
  }, [options, selected])
  const current = options.find((o) => o.key === selected)

  const name =
    current?.ctx.student_name ?? contexts.find((c) => c.student_name)?.student_name
  const classLabel = (c: AssistantContext) => {
    const cls = classroomDisplayName(c.classroom_grade, c.classroom_name, i18n.language)
    return c.teacher_label
      ? t('assistant.class_with_teacher', { cls, teacher: c.teacher_label })
      : cls
  }
  const itemLabel = (i: AssistantContextItem) => {
    const subject = i.subject_system_key
      ? t(`subject.${i.subject_system_key}`)
      : (i.subject_display_name ?? '')
    const category = t(`category.${i.category_system_key}`)
    return [subject, category, i.item_name].filter(Boolean).join(' · ')
  }

  return (
    <MinimalShell label={name ? t('assistant.header', { name }) : t('assistant.role')}>
      <PageContainer>
        <PageHeader
          title={t('assistant.title')}
          subtitle={t('assistant.subtitle')}
          breadcrumb={false}
        />

        {options.length === 0 ? (
          <div className="bg-white border border-slate-200 rounded-xl p-6 lg:p-8 text-center">
            <h2 className="text-lg font-semibold text-slate-900 tracking-tight mb-2">
              {t('assistant.empty.heading')}
            </h2>
            <p className="text-sm text-slate-500">{t('assistant.empty.body')}</p>
          </div>
        ) : (
          <>
            <label className="block mb-6">
              <span className="text-sm font-medium text-slate-700 mb-1.5 block">
                {t('assistant.pick_item')}
              </span>
              <select
                value={selected}
                onChange={(e) => setSelected(e.target.value)}
                className={SELECT_CLS}
              >
                {contexts
                  .filter((c) => c.items.length > 0)
                  .map((c) => (
                    <optgroup key={c.classroom_id} label={classLabel(c)}>
                      {c.items.map((i) => (
                        <option key={i.item_id} value={keyOf(c.classroom_id, i.item_id)}>
                          {itemLabel(i)}
                        </option>
                      ))}
                    </optgroup>
                  ))}
              </select>
            </label>
            {current && (
              <ScoreTable
                key={current.key}
                classroomId={current.ctx.classroom_id}
                itemId={current.item.item_id}
              />
            )}
          </>
        )}
      </PageContainer>
    </MinimalShell>
  )
}

type Draft = Record<string, string>

const EMPTY_ROWS: ItemGradesStudentRow[] = []

/** Last written by the teacher → read-only for the assistant. */
const locked = (r: ItemGradesStudentRow) =>
  r.grade_id !== null && r.entered_by_role === 'teacher'

function ScoreTable({ classroomId, itemId }: { classroomId: string; itemId: string }) {
  const { t } = useTranslation()
  const qc = useQueryClient()
  const queryKey = ['assistant-item-grades', itemId, classroomId]
  const q = useQuery({
    queryKey,
    queryFn: () => api.assistant.forItem(itemId, classroomId),
  })
  const [draft, setDraft] = useState<Draft>({})
  const [saving, setSaving] = useState(false)
  const [errKey, setErrKey] = useState<string | null>(null)

  const rows = q.data?.students ?? EMPTY_ROWS

  // Validate every edited cell; collect the entries to send.
  const { entries, invalid } = useMemo(() => {
    const out: { student_id: string; score: number }[] = []
    const bad = new Set<string>()
    for (const r of rows) {
      const raw = draft[r.student_id]
      if (raw === undefined || locked(r)) continue
      const trimmed = raw.trim()
      if (trimmed === '') {
        // Clearing an existing score isn't allowed; an untouched empty is fine.
        if (r.score !== null) bad.add(r.student_id)
        continue
      }
      const n = Number(trimmed)
      if (!Number.isFinite(n) || n < 0 || n > 100) {
        bad.add(r.student_id)
        continue
      }
      if (r.score !== null && Math.abs(r.score - n) < 0.05) continue
      out.push({ student_id: r.student_id, score: n })
    }
    return { entries: out, invalid: bad }
  }, [draft, rows])

  async function save() {
    if (entries.length === 0 || invalid.size > 0) return
    setSaving(true)
    setErrKey(null)
    try {
      await api.assistant.bulk({ item_id: itemId, classroom_id: classroomId, entries })
      setDraft({})
      await qc.invalidateQueries({ queryKey })
      toast.success(t('assistant.saved', { n: entries.length }))
    } catch (err) {
      setErrKey(
        err instanceof ApiError && err.body?.message_key
          ? err.body.message_key
          : 'common.error_generic',
      )
      // The list may be stale (e.g. the teacher just entered a score).
      void qc.invalidateQueries({ queryKey })
    } finally {
      setSaving(false)
    }
  }

  if (q.isLoading) {
    return <div className="text-center text-slate-400 py-16">{t('common.loading')}</div>
  }
  if (q.isError) {
    return (
      <div className="bg-rose-50 border border-rose-200 text-rose-700 rounded-xl p-4 flex items-center justify-between gap-3">
        <span className="text-sm">{t('assistant.load_error')}</span>
        <button
          type="button"
          onClick={() => q.refetch()}
          className="text-sm font-medium text-rose-700 hover:text-rose-900 underline min-h-[44px]"
        >
          {t('common.retry')}
        </button>
      </div>
    )
  }
  if (rows.length === 0) {
    return (
      <div className="bg-white border border-slate-200 rounded-xl p-6 text-center text-sm text-slate-500">
        {t('assistant.no_students')}
      </div>
    )
  }

  return (
    <div>
      <div className="bg-white border border-slate-200 rounded-xl overflow-hidden">
        <table className="w-full text-sm">
          <thead className="bg-slate-50 border-b border-slate-200 text-slate-600">
            <tr>
              <th className="px-3 sm:px-4 py-3 text-left font-medium w-16">
                {t('grade_entry.col.seat')}
              </th>
              <th className="px-3 sm:px-4 py-3 text-left font-medium">
                {t('grade_entry.col.name')}
              </th>
              <th className="px-3 sm:px-4 py-3 text-left font-medium w-32 sm:w-40">
                {t('assistant.col.score')}
              </th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => {
              const isLocked = locked(r)
              const value =
                draft[r.student_id] ?? (r.score !== null ? String(r.score) : '')
              const bad = invalid.has(r.student_id)
              return (
                <tr key={r.student_id} className="border-b border-slate-100 last:border-b-0">
                  <td className="px-3 sm:px-4 py-2 text-slate-900 font-medium">
                    {r.seat_number}
                  </td>
                  <td className="px-3 sm:px-4 py-2 text-slate-700">
                    {r.name || <span className="text-slate-400">—</span>}
                  </td>
                  <td className="px-3 sm:px-4 py-2">
                    <div className="relative">
                      <input
                        type="text"
                        inputMode="decimal"
                        value={value}
                        disabled={isLocked || saving}
                        onChange={(e) =>
                          setDraft((d) => ({ ...d, [r.student_id]: e.target.value }))
                        }
                        aria-label={t('assistant.score_for', {
                          seat: r.seat_number,
                          name: r.name ?? '',
                        })}
                        aria-invalid={bad}
                        title={isLocked ? t('assistant.locked_hint') : undefined}
                        className={`w-full min-h-[44px] border rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-amber-500 disabled:bg-slate-100 disabled:text-slate-500 ${
                          bad ? 'border-rose-400' : 'border-slate-300'
                        }`}
                      />
                      <EnteredByBadge stamp={r} />
                    </div>
                    {isLocked && (
                      <span className="block text-xs text-slate-400 mt-0.5">
                        {t('assistant.locked')}
                      </span>
                    )}
                    {bad && (
                      <span className="block text-xs text-rose-600 mt-0.5">
                        {r.score !== null && (draft[r.student_id] ?? '').trim() === ''
                          ? t('assistant.cannot_clear')
                          : t('assistant.invalid_score')}
                      </span>
                    )}
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>

      {errKey && (
        <p className="mt-3 text-sm text-rose-600" role="alert">
          {t(errKey)}
        </p>
      )}

      <div className="mt-6 flex items-center justify-end gap-3">
        <span className="text-sm text-slate-500">
          {t('assistant.pending', { n: entries.length })}
        </span>
        <button
          type="button"
          onClick={save}
          disabled={saving || entries.length === 0 || invalid.size > 0}
          className={PRIMARY_BTN}
        >
          {saving ? t('common.saving') : t('common.save')}
        </button>
      </div>
    </div>
  )
}
