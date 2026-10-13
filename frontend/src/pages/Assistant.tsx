import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useEffect, useMemo, useState } from 'react'
import toast from 'react-hot-toast'
import { useTranslation } from 'react-i18next'

import { EnteredByBadge } from '../components/EnteredByBadge'
import { LockNotice, useLockHolderLabel } from '../components/EditLockNotice'
import { LOCK_POLL_MS, useEditLock, type LockOps } from '../hooks/useEditLock'
import { meKey, useMe } from '../hooks/useMe'
import { PageContainer } from '../layout/PageContainer'
import { PageHeader } from '../layout/PageHeader'
import {
  api,
  ApiError,
  type AssistantContext,
  type AssistantContextItem,
  type ItemGradesStudentRow,
  lockHolderFromError,
  type LockHolder,
} from '../lib/api'
import { classroomDisplayName } from '../lib/classroomFormat'

const PRIMARY_BTN =
  'inline-flex items-center justify-center min-h-[44px] px-4 py-2 rounded-lg bg-amber-500 hover:bg-amber-600 active:bg-amber-700 text-white text-sm font-medium shadow-sm transition-colors disabled:bg-slate-300 disabled:shadow-none disabled:cursor-not-allowed'

const SELECT_CLS =
  'w-full sm:w-auto sm:min-w-[20rem] min-h-[44px] border border-slate-300 rounded-lg px-3 py-2 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-amber-500'

/** Selection key = class + item (one item may be assigned in two classes). */
const keyOf = (classroomId: string, itemId: string) => `${classroomId}|${itemId}`

/**
 * Student 小老師 score-entry page (#262). Rendered inside `MinimalShell`
 * (its top bar shows "name（小老師）"), not the teacher AppShell: a dropdown
 * of the items the teacher assigned (grouped by class / teacher), and
 * seat / name / score / save.
 *
 * The UI mirrors the backend rules but does not enforce them — the backend
 * (/api/assistant/*) does: teacher-entered scores are read-only here,
 * scores can't be cleared, and writing needs the item's edit lock (#264).
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
  )
}

type Draft = Record<string, string>

const EMPTY_ROWS: ItemGradesStudentRow[] = []

const SECONDARY_BTN =
  'inline-flex items-center justify-center min-h-[44px] px-4 py-2 rounded-lg bg-white border border-slate-200 hover:border-slate-300 hover:bg-slate-50 text-slate-700 text-sm font-medium shadow-sm transition-colors disabled:opacity-60 disabled:cursor-not-allowed'

/** Last written by the teacher → read-only for the assistant (not to be
 *  confused with the edit lock, #264 B13). */
const teacherEntered = (r: ItemGradesStudentRow) =>
  r.grade_id !== null && r.entered_by_role === 'teacher'

/**
 * One item's scores for the assistant's class. View-only until the pencil
 * ("編輯分數") takes the item's edit lock (#264): only one person edits an
 * item at a time, the teacher always wins (a takeover turns this table
 * read-only and drops unsaved input), and the lock is released on save /
 * cancel / leaving, or after 5 idle minutes.
 */
function ScoreTable({ classroomId, itemId }: { classroomId: string; itemId: string }) {
  const { t } = useTranslation()
  const qc = useQueryClient()
  const holderLabel = useLockHolderLabel()
  const queryKey = ['assistant-item-grades', itemId, classroomId]
  const q = useQuery({
    queryKey,
    queryFn: () => api.assistant.forItem(itemId, classroomId),
  })
  const [draft, setDraft] = useState<Draft>({})
  const [saving, setSaving] = useState(false)
  const [starting, setStarting] = useState(false)
  const [errKey, setErrKey] = useState<string | null>(null)
  // Why editing ended against our will (taken over, expired, …).
  const [lostMsg, setLostMsg] = useState<string | null>(null)

  // 404 = this item is no longer open to us (unassigned, archived, role
  // revoked…). Refresh /api/me so the dropdown — or the whole page, via
  // IdentityGate — catches up instead of showing a dead item.
  const refreshIdentityOn404 = (err: unknown) => {
    if (err instanceof ApiError && err.status === 404) {
      void qc.invalidateQueries({ queryKey: meKey })
    }
  }
  useEffect(() => {
    if (q.error) refreshIdentityOn404(q.error)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [q.error])

  const lockKey = ['assistant-item-lock', itemId, classroomId]
  const lock = useEditLock((holder) => {
    // Taken over / expired / permission gone: read-only, unsaved input is
    // discarded, reload the latest scores.
    setDraft({})
    setLostMsg(
      holder === null
        ? t('edit_lock.lock_expired')
        : holder.holder_role === 'teacher'
          ? t('edit_lock.taken_over_by_teacher')
          : holder.holder_role === null
            ? t('edit_lock.lock_expired')
            : t('edit_lock.taken_by_other', { who: holderLabel(holder) }),
    )
    void qc.invalidateQueries({ queryKey })
    void qc.invalidateQueries({ queryKey: lockKey })
    if (holder === null) void qc.invalidateQueries({ queryKey: meKey })
  })
  const editing = lock.status !== 'off'

  // Who is editing — polled while viewing (React Query pauses it while the
  // tab is hidden); while we edit, the heartbeat tells us instead.
  const lockQ = useQuery({
    queryKey: lockKey,
    queryFn: () => api.assistant.lockState(itemId, classroomId),
    refetchInterval: LOCK_POLL_MS,
    enabled: !editing,
  })
  const blockedBy: LockHolder | null =
    !editing && lockQ.data?.locked && !lockQ.data.mine
      ? { holder_role: lockQ.data.holder_role, holder_name: lockQ.data.holder_name }
      : null

  const ops: LockOps = {
    acquire: () => api.assistant.acquireLock(itemId, classroomId),
    release: (keepalive) => api.assistant.releaseLock(itemId, classroomId, keepalive),
  }

  async function startEditing() {
    setStarting(true)
    setErrKey(null)
    setLostMsg(null)
    try {
      if (!(await lock.start(ops))) return // cancelled / left meanwhile
      // Start from the latest scores (someone may have just saved).
      setDraft({})
      await q.refetch()
    } catch (err) {
      if (lockHolderFromError(err)) {
        void qc.invalidateQueries({ queryKey: lockKey })
      } else {
        setErrKey(
          err instanceof ApiError && err.body?.message_key
            ? err.body.message_key
            : 'common.error_generic',
        )
        refreshIdentityOn404(err)
      }
    } finally {
      setStarting(false)
    }
  }

  function stopEditing() {
    lock.stop()
    setDraft({})
    setErrKey(null)
    void qc.invalidateQueries({ queryKey: lockKey })
  }

  const rows = q.data?.students ?? EMPTY_ROWS

  // Validate every edited cell; collect the entries to send.
  const { entries, invalid } = useMemo(() => {
    const out: { student_id: string; score: number }[] = []
    const bad = new Set<string>()
    for (const r of rows) {
      const raw = draft[r.student_id]
      if (raw === undefined || teacherEntered(r)) continue
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
      // After an idle release, take the lock back first (A5).
      const held = await lock.ensure()
      if (held !== 'held') {
        if (held === 'error') setErrKey('common.error_generic')
        return
      }
      await api.assistant.bulk({ item_id: itemId, classroom_id: classroomId, entries })
      const n = entries.length
      lock.stop()
      setDraft({})
      await qc.invalidateQueries({ queryKey })
      void qc.invalidateQueries({ queryKey: lockKey })
      toast.success(t('assistant.saved', { n }))
    } catch (err) {
      const holder = lockHolderFromError(err)
      if (holder) {
        // Lost the lock between heartbeats (e.g. the teacher took over).
        lock.stop()
        setDraft({})
        setLostMsg(
          holder.holder_role === 'teacher'
            ? t('edit_lock.taken_over_by_teacher')
            : holder.holder_role === null
              ? t('edit_lock.lock_expired')
              : t('edit_lock.taken_by_other', { who: holderLabel(holder) }),
        )
        void qc.invalidateQueries({ queryKey: lockKey })
      } else {
        setErrKey(
          err instanceof ApiError && err.body?.message_key
            ? err.body.message_key
            : 'common.error_generic',
        )
      }
      // The list may be stale (e.g. the teacher just entered a score).
      void qc.invalidateQueries({ queryKey })
      refreshIdentityOn404(err)
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
      <div className="mb-4 space-y-2">
        {lostMsg && <LockNotice tone="warn">{lostMsg}</LockNotice>}
        {!editing && blockedBy && (
          <LockNotice>{t('edit_lock.assistant_blocked', { who: holderLabel(blockedBy) })}</LockNotice>
        )}
        {lock.status === 'paused' && <LockNotice>{t('edit_lock.paused')}</LockNotice>}
        {!editing && (
          <div className="flex flex-wrap items-center justify-between gap-3">
            <span className="text-sm text-slate-500">{t('edit_lock.assistant_view_hint')}</span>
            <button
              type="button"
              onClick={startEditing}
              disabled={starting || blockedBy !== null}
              className={SECONDARY_BTN}
            >
              <span aria-hidden className="mr-1.5">✎</span>
              {t('edit_lock.assistant_edit')}
            </button>
          </div>
        )}
      </div>

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
              const isTeacherEntered = teacherEntered(r)
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
                        disabled={!editing || isTeacherEntered || saving}
                        onChange={(e) =>
                          setDraft((d) => ({ ...d, [r.student_id]: e.target.value }))
                        }
                        aria-label={t('assistant.score_for', {
                          seat: r.seat_number,
                          name: r.name ?? '',
                        })}
                        aria-invalid={bad}
                        title={
                          isTeacherEntered ? t('assistant.teacher_entered_hint') : undefined
                        }
                        className={`w-full min-h-[44px] border rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-amber-500 disabled:bg-slate-100 disabled:text-slate-500 ${
                          bad ? 'border-rose-400' : 'border-slate-300'
                        }`}
                      />
                      <EnteredByBadge stamp={r} />
                    </div>
                    {isTeacherEntered && editing && (
                      <span className="block text-xs text-slate-400 mt-0.5">
                        {t('assistant.teacher_entered')}
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

      {editing && (
        <div className="mt-6 flex flex-wrap items-center justify-end gap-3">
          <span className="text-sm text-slate-500">
            {t('assistant.pending', { n: entries.length })}
          </span>
          <button
            type="button"
            onClick={stopEditing}
            disabled={saving}
            className={SECONDARY_BTN}
          >
            {t('common.cancel')}
          </button>
          <button
            type="button"
            onClick={save}
            disabled={saving || entries.length === 0 || invalid.size > 0}
            className={PRIMARY_BTN}
          >
            {saving ? t('common.saving') : t('common.save')}
          </button>
        </div>
      )}
    </div>
  )
}
