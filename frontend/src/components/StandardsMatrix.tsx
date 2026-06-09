import { useEffect, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'

import { useMe } from '../hooks/useMe'
import {
  api,
  ApiError,
  type StudentBrief,
  type Subject,
} from '../lib/api'

const PRIMARY_BTN =
  'inline-flex items-center px-4 py-2 rounded-lg bg-amber-500 hover:bg-amber-600 active:bg-amber-700 text-white text-sm font-medium shadow-sm transition-colors disabled:bg-slate-300 disabled:shadow-none disabled:cursor-not-allowed'

const SECONDARY_BTN =
  'inline-flex items-center px-4 py-2 rounded-lg bg-white border border-slate-200 hover:border-slate-300 hover:bg-slate-50 text-slate-700 text-sm font-medium shadow-sm transition-colors disabled:opacity-60'

const DEFAULT_ACADEMIC_KEYS = [
  'chinese',
  'english',
  'math',
  'science',
  'social_studies',
] as const

/**
 * Per-student × per-subject threshold matrix (issue #10).
 *
 * Rows are the classroom roster; columns are every subject visible to the
 * teacher (built-in + custom), ordered by their stored subject_order.
 * Cells are number inputs (step=5, 0–100). Blur saves; clearing the cell
 * deletes the row server-side (threshold goes back to null = no auto-award
 * trigger for that student × subject).
 *
 * Selecting ≥1 students enables the toolbar's 「套用到 N 位學生」 action,
 * which opens a small modal to pick a subject + value and posts a bulk
 * upsert.
 */
export function StandardsMatrix({
  classroomId,
  snapshotId,
  snapshotStudents,
  readOnly = false,
}: {
  /** Live classroom id. Required in live mode; ignored in snapshot mode. */
  classroomId?: string
  /** When set, the matrix operates on snapshot_standard rows instead of
   *  the live student_standard table (issue #160). */
  snapshotId?: string
  /** Frozen roster to render in snapshot mode (live `students.list` would
   *  return the current class roster, not the snapshot's frozen one). */
  snapshotStudents?: StudentBrief[]
  readOnly?: boolean
}) {
  const { t } = useTranslation()
  const qc = useQueryClient()
  const isSnapshotMode = !!snapshotId

  const studentsQ = useQuery({
    queryKey: ['students', classroomId],
    queryFn: () => api.students.list(classroomId as string),
    enabled: !isSnapshotMode && !!classroomId,
  })
  const subjectsQ = useQuery({
    queryKey: ['subjects'],
    queryFn: () => api.subjects.list(),
  })
  const standardsQ = useQuery({
    queryKey: isSnapshotMode
      ? ['snapshot-standards', snapshotId]
      : ['standards', classroomId],
    queryFn: () =>
      isSnapshotMode
        ? api.snapshots.listStandards(snapshotId as string)
        : api.students.standards(classroomId as string),
    enabled: isSnapshotMode ? !!snapshotId : !!classroomId,
  })
  const meQ = useMe()

  const students: StudentBrief[] = isSnapshotMode
    ? (snapshotStudents ?? [])
    : ((studentsQ.data?.data ?? []) as StudentBrief[])
  const subjects = subjectsQ.data?.data ?? []
  const standards = standardsQ.data?.data ?? []
  const subjectOrder = meQ.data?.subject_order ?? []

  // Sort subjects: teacher's stored order first; remainder falls back to the
  // academic-5 fixed order, then alphabetical.
  const orderedSubjects = useMemo(() => {
    const byId = new Map(subjects.map((s) => [s.id, s] as const))
    const ordered: Subject[] = []
    const seen = new Set<string>()
    for (const id of subjectOrder) {
      const s = byId.get(id)
      if (s) {
        ordered.push(s)
        seen.add(id)
      }
    }
    const fallback: Subject[] = []
    for (const key of DEFAULT_ACADEMIC_KEYS) {
      const s = subjects.find((x) => x.system_key === key && !seen.has(x.id))
      if (s) {
        fallback.push(s)
        seen.add(s.id)
      }
    }
    const tail = subjects
      .filter((s) => !seen.has(s.id))
      .sort((a, b) => {
        const aL = a.system_key ?? a.display_name ?? ''
        const bL = b.system_key ?? b.display_name ?? ''
        return aL.localeCompare(bL)
      })
    return [...ordered, ...fallback, ...tail]
  }, [subjects, subjectOrder])

  // lookup[student_id][subject_id] = threshold (number | undefined)
  const lookup = useMemo(() => {
    const m: Record<string, Record<string, number>> = {}
    for (const s of standards) {
      m[s.student_id] ??= {}
      m[s.student_id][s.subject_id] = s.threshold
    }
    return m
  }, [standards])

  // Local pending edits keyed by `${student}_${subject}`. Cleared once the
  // server confirms; blur reads from here if present, else the lookup.
  const [draft, setDraft] = useState<Record<string, number | null>>({})
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [batchOpen, setBatchOpen] = useState(false)
  const [saveErr, setSaveErr] = useState<string | null>(null)

  const upsertMut = useMutation({
    mutationFn: async (args: {
      studentId: string
      subjectId: string
      value: number | null
    }): Promise<void> => {
      if (isSnapshotMode) {
        if (args.value === null) {
          await api.snapshots.deleteStandard(
            snapshotId as string,
            args.studentId,
            args.subjectId,
          )
          return
        }
        await api.snapshots.upsertStandard(
          snapshotId as string,
          args.studentId,
          args.subjectId,
          args.value,
        )
        return
      }
      if (args.value === null) {
        await api.students.deleteStandard(args.studentId, args.subjectId)
        return
      }
      await api.students.upsertStandard(
        args.studentId,
        args.subjectId,
        args.value,
      )
    },
    onSuccess: () =>
      qc.invalidateQueries({
        queryKey: isSnapshotMode
          ? ['snapshot-standards', snapshotId]
          : ['standards', classroomId],
      }),
    onError: (err) => {
      setSaveErr(
        err instanceof ApiError && err.body?.message
          ? err.body.message
          : err instanceof Error
            ? err.message
            : 'unknown',
      )
    },
  })

  function cellKey(sId: string, subjId: string) {
    return `${sId}_${subjId}`
  }

  function cellValue(sId: string, subjId: string): number | null {
    const key = cellKey(sId, subjId)
    if (key in draft) return draft[key]
    const v = lookup[sId]?.[subjId]
    return v === undefined ? null : v
  }

  function onCellBlur(sId: string, subjId: string) {
    const key = cellKey(sId, subjId)
    if (!(key in draft)) return
    const next = draft[key]
    const prev = lookup[sId]?.[subjId]
    if ((prev === undefined && next === null) || prev === next) {
      // No actual change.
      setDraft((d) => {
        const c = { ...d }
        delete c[key]
        return c
      })
      return
    }
    upsertMut.mutate(
      { studentId: sId, subjectId: subjId, value: next },
      {
        onSettled: () =>
          setDraft((d) => {
            const c = { ...d }
            delete c[key]
            return c
          }),
      },
    )
  }

  function toggle(sId: string) {
    setSelected((prev) => {
      const next = new Set(prev)
      if (next.has(sId)) next.delete(sId)
      else next.add(sId)
      return next
    })
  }

  function toggleAll() {
    if (selected.size === students.length) setSelected(new Set())
    else setSelected(new Set(students.map((s) => s.id)))
  }

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-2 text-sm text-slate-500">
        <span>{t('standards.hint')}</span>
        {!readOnly && !isSnapshotMode && selected.size > 0 && (
          <button
            onClick={() => setBatchOpen(true)}
            className={PRIMARY_BTN + ' ml-auto'}
          >
            {t('standards.batch_apply', { count: selected.size })}
          </button>
        )}
      </div>

      {(!isSnapshotMode && studentsQ.isLoading) && (
        <div className="text-center text-slate-400 py-12">
          {t('common.loading')}
        </div>
      )}

      {!(!isSnapshotMode && studentsQ.isLoading) && students.length === 0 && (
        <div className="bg-white border border-slate-200 rounded-xl p-8 text-center text-sm text-slate-500">
          {t('standards.empty_roster')}
        </div>
      )}

      {!(!isSnapshotMode && studentsQ.isLoading) && students.length > 0 && (
        <div className="bg-white border border-slate-200 rounded-xl overflow-hidden">
          <div className="overflow-x-auto">
            <table className="min-w-full text-sm">
              <thead className="bg-slate-50 border-b border-slate-200 text-slate-600">
                <tr>
                  <th className="w-10 px-3 py-3">
                    <input
                      type="checkbox"
                      checked={
                        selected.size === students.length &&
                        students.length > 0
                      }
                      onChange={toggleAll}
                      disabled={readOnly}
                      aria-label={t('standards.select_all')}
                    />
                  </th>
                  <th className="px-3 py-3 text-left font-medium w-16">
                    {t('students.col.seat')}
                  </th>
                  <th className="px-3 py-3 text-left font-medium min-w-[6rem] max-w-[10rem]">
                    {t('students.col.name')}
                  </th>
                  {orderedSubjects.map((s) => (
                    <th
                      key={s.id}
                      className="px-2 py-3 text-left font-medium text-xs max-w-[8rem]"
                    >
                      {s.system_key
                        ? t(`subject.${s.system_key}`)
                        : (s.display_name ?? '—')}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {students.map((s, si) => (
                  <tr
                    key={s.id}
                    className={`${
                      (si + 1) % 5 === 0
                        ? 'border-b-2 border-slate-300'
                        : 'border-b border-slate-100'
                    } last:border-b-0`}
                  >
                    <td className="px-3 py-2">
                      <input
                        type="checkbox"
                        checked={selected.has(s.id)}
                        onChange={() => toggle(s.id)}
                        disabled={readOnly}
                        aria-label={`${s.seat_number} ${s.name ?? ''}`}
                      />
                    </td>
                    <td className="px-3 py-2 text-slate-500 font-mono tabular-nums w-16">
                      {s.seat_number}
                    </td>
                    <td className="px-3 py-2 text-slate-900 min-w-[6rem] max-w-[10rem] truncate">
                      {s.name || '—'}
                    </td>
                    {orderedSubjects.map((subj) => {
                      const v = cellValue(s.id, subj.id)
                      return (
                        <td key={subj.id} className="px-1 py-1">
                          <input
                            type="number"
                            inputMode="decimal"
                            step={5}
                            min={0}
                            max={100}
                            value={v === null ? '' : String(v)}
                            onChange={(e) => {
                              const raw = e.target.value
                              const next =
                                raw === ''
                                  ? null
                                  : Math.max(
                                      0,
                                      Math.min(100, Number(raw)),
                                    )
                              setDraft((d) => ({
                                ...d,
                                [cellKey(s.id, subj.id)]: next,
                              }))
                            }}
                            onBlur={() => onCellBlur(s.id, subj.id)}
                            readOnly={readOnly}
                            disabled={readOnly}
                            placeholder="—"
                            className="w-14 border border-slate-300 rounded-md px-1.5 py-1 text-sm text-right focus:outline-none focus:ring-2 focus:ring-amber-500 disabled:bg-slate-50 disabled:text-slate-400"
                          />
                        </td>
                      )
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="px-4 py-3 text-xs text-slate-500 border-t border-slate-200 bg-slate-50">
            {t('standards.formula_hint')}
          </p>
        </div>
      )}

      {saveErr && (
        <p className="text-sm text-rose-600">{saveErr}</p>
      )}

      {batchOpen && classroomId && (
        <BatchApplyModal
          classroomId={classroomId}
          selectedStudentIds={Array.from(selected)}
          subjects={orderedSubjects}
          onClose={() => setBatchOpen(false)}
          onApplied={() => {
            setBatchOpen(false)
            setSelected(new Set())
            qc.invalidateQueries({ queryKey: ['standards', classroomId] })
          }}
        />
      )}
    </div>
  )
}

function BatchApplyModal({
  classroomId,
  selectedStudentIds,
  subjects,
  onClose,
  onApplied,
}: {
  classroomId: string
  selectedStudentIds: string[]
  subjects: Subject[]
  onClose: () => void
  onApplied: () => void
}) {
  const { t } = useTranslation()
  const [subjectId, setSubjectId] = useState(subjects[0]?.id ?? '')
  const [threshold, setThreshold] = useState<number>(80)
  const [errKey, setErrKey] = useState<string | null>(null)
  useEffect(() => {
    if (!subjectId && subjects[0]) setSubjectId(subjects[0].id)
  }, [subjects, subjectId])

  const mut = useMutation({
    mutationFn: () =>
      api.students.batchStandards(classroomId, {
        student_ids: selectedStudentIds,
        subject_id: subjectId,
        threshold,
      }),
    onSuccess: () => onApplied(),
    onError: (err) => {
      setErrKey(
        err instanceof ApiError && err.body?.message_key
          ? err.body.message_key
          : 'common.error_generic',
      )
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
          setErrKey(null)
          if (!subjectId) return
          mut.mutate()
        }}
        onClick={(e) => e.stopPropagation()}
        className="bg-white rounded-2xl shadow-xl border border-slate-200 p-6 w-full max-w-sm"
      >
        <h2 className="text-lg font-semibold tracking-tight mb-1 text-slate-900">
          {t('standards.batch.title')}
        </h2>
        <p className="text-xs text-slate-500 mb-4">
          {t('standards.batch.subtitle', {
            count: selectedStudentIds.length,
          })}
        </p>

        <label className="block mb-3">
          <span className="block text-sm font-medium text-slate-700 mb-1">
            {t('standards.batch.subject')}
          </span>
          <select
            value={subjectId}
            onChange={(e) => setSubjectId(e.target.value)}
            className="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-amber-500"
          >
            {subjects.map((s) => (
              <option key={s.id} value={s.id}>
                {s.system_key
                  ? t(`subject.${s.system_key}`)
                  : (s.display_name ?? '—')}
              </option>
            ))}
          </select>
        </label>

        <label className="block">
          <span className="block text-sm font-medium text-slate-700 mb-1">
            {t('standards.batch.threshold')}
          </span>
          <select
            value={threshold}
            onChange={(e) => setThreshold(Number(e.target.value))}
            className="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-amber-500"
          >
            {Array.from({ length: 21 }, (_, i) => i * 5).map((n) => (
              <option key={n} value={n}>
                {n}
              </option>
            ))}
          </select>
        </label>

        {errKey && <p className="mt-3 text-sm text-rose-600">{t(errKey)}</p>}

        <div className="mt-6 flex justify-end gap-2">
          <button
            type="button"
            onClick={onClose}
            className={SECONDARY_BTN}
          >
            {t('common.cancel')}
          </button>
          <button
            type="submit"
            disabled={mut.isPending || !subjectId}
            className={PRIMARY_BTN}
          >
            {mut.isPending ? t('common.saving') : t('common.save')}
          </button>
        </div>
      </form>
    </div>
  )
}
