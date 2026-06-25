import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Link, useParams } from 'react-router-dom'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'

import { ArchivedSemesterBanner } from '../components/ArchivedSemesterBanner'
import { PointEntryModal } from '../components/PointEntryModal'
import { meKey, useMe } from '../hooks/useMe'
import { PageContainer } from '../layout/PageContainer'
import { PageHeader } from '../layout/PageHeader'
import { useSemesterView } from '../state/SemesterView'
import {
  api,
  ApiError,
  type ClassPointsSummary,
  type PointReason,
  type StudentPointsSummaryList,
} from '../lib/api'
import { reasonLabel } from '../lib/pointReasons'

type View = 'list' | 'card'
const VIEW_KEY = 'points.classroom_view'

type PointMode = 'add' | 'deduct'

interface ModalState {
  studentId: string
  studentLabel: string
  mode: PointMode
}

export function ClassroomPoints() {
  const { t } = useTranslation()
  const { classroomId } = useParams<{ classroomId: string }>()
  const qc = useQueryClient()
  const meQ = useMe()
  const { isArchived, viewed } = useSemesterView()

  const studentsQ = useQuery({
    queryKey: ['points-students', classroomId],
    queryFn: () =>
      api.points.listClassroomStudents(classroomId as string),
    enabled: !!classroomId,
  })

  const reasons: PointReason[] = (meQ.data?.point_reasons ?? []).filter(
    (r) => !r.system_key,
  )
  // Reason names offered in the add/deduct combobox (#215). Reasons are just
  // names now — the amount is chosen per entry, so we ignore default_points.
  const reasonSuggestions = reasons.map((r) => reasonLabel(r, t))
  const students = studentsQ.data?.data ?? []
  const view = studentsQ.data

  const [modal, setModal] = useState<ModalState | null>(null)
  const [toast, setToast] = useState<string | null>(null)
  const [displayMode, setDisplayMode] = useState<View>(
    (localStorage.getItem(VIEW_KEY) as View) || 'card',
  )
  // Quick student lookup by seat number or name fragment (#173).
  const [query, setQuery] = useState('')
  // Per-row selection for the subset batch flow (#173). The batch button
  // is enabled only when ≥1 student is checked; "select all" toggles the
  // full filtered set so a search-narrowed list can be batch-applied.
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [batchMode, setBatchMode] = useState<PointMode | null>(null)
  function toggleSelected(studentId: string) {
    setSelected((prev) => {
      const next = new Set(prev)
      if (next.has(studentId)) next.delete(studentId)
      else next.add(studentId)
      return next
    })
  }
  const trimmedQuery = query.trim().toLowerCase()
  const filteredStudents = trimmedQuery
    ? students.filter((s) => {
        const seatStr = String(s.seat_number)
        const name = (s.name ?? '').toLowerCase()
        return seatStr.includes(trimmedQuery) || name.includes(trimmedQuery)
      })
    : students
  function changeView(v: View) {
    setDisplayMode(v)
    localStorage.setItem(VIEW_KEY, v)
  }

  const addMut = useMutation({
    mutationFn: (args: {
      studentId: string
      points: number
      reason: string
    }) =>
      api.points.addStudent(args.studentId, {
        points: args.points,
        reason: args.reason,
      }),
    onSuccess: (_data, vars) => {
      // Bump the local cache so the row's semester_points + the parent
      // classroom rollup both move instantly, before the invalidate-driven
      // refetch lands.
      qc.setQueryData<StudentPointsSummaryList | undefined>(
        ['points-students', classroomId],
        (old) =>
          old
            ? {
                ...old,
                data: old.data.map((s) =>
                  s.student_id === vars.studentId
                    ? {
                        ...s,
                        semester_points: s.semester_points + vars.points,
                      }
                    : s,
                ),
              }
            : old,
      )
      qc.setQueryData<{ data: ClassPointsSummary[] } | undefined>(
        ['points-classrooms'],
        (old) =>
          old
            ? {
                data: old.data.map((c) =>
                  c.classroom_id === classroomId
                    ? {
                        ...c,
                        semester_points: c.semester_points + vars.points,
                      }
                    : c,
                ),
              }
            : old,
      )
      setToast(
        t('points.toast.applied_student', {
          delta: vars.points >= 0 ? `+${vars.points}` : String(vars.points),
          reason: vars.reason,
        }),
      )
      setTimeout(() => setToast(null), 3000)
      qc.invalidateQueries({ queryKey: ['points-students', classroomId] })
      qc.invalidateQueries({ queryKey: ['points-classrooms'] })
      // A newly-typed reason was auto-filed server-side (#215) — refresh the
      // saved reason list so it appears in the combobox next time.
      qc.invalidateQueries({ queryKey: meKey })
      setModal(null)
    },
    onError: (err) => {
      setToast(
        err instanceof ApiError && err.body?.message
          ? err.body.message
          : t('common.error_generic'),
      )
      setTimeout(() => setToast(null), 4000)
    },
  })

  const batchMut = useMutation({
    mutationFn: (args: { points: number; reason: string }) =>
      api.points.classBatch(classroomId as string, {
        points: args.points,
        reason: args.reason,
        student_ids: Array.from(selected),
      }),
    onSuccess: (data, vars) => {
      setBatchMode(null)
      setSelected(new Set())
      setToast(
        t('points.toast.applied_batch', {
          count: data.written,
          delta:
            vars.points >= 0 ? `+${vars.points}` : String(vars.points),
          reason: vars.reason,
        }),
      )
      setTimeout(() => setToast(null), 3500)
      qc.invalidateQueries({ queryKey: ['points-students', classroomId] })
      qc.invalidateQueries({ queryKey: ['points-classrooms'] })
      qc.invalidateQueries({ queryKey: meKey })
    },
    onError: (err) => {
      setToast(
        err instanceof ApiError && err.body?.message
          ? err.body.message
          : t('common.error_generic'),
      )
      setTimeout(() => setToast(null), 4000)
    },
  })

  function openEntry(
    studentId: string,
    studentLabel: string,
    mode: PointMode,
  ) {
    setModal({ studentId, studentLabel, mode })
  }

  // Confirm dialog state for the two reset flows (single student / whole class).
  const [confirm, setConfirm] = useState<
    | { kind: 'student'; studentId: string; label: string; current: number }
    | { kind: 'class' }
    | null
  >(null)

  const resetStudentMut = useMutation({
    mutationFn: (studentId: string) => api.points.resetStudent(studentId),
    onSuccess: (data, studentId) => {
      qc.setQueryData<StudentPointsSummaryList | undefined>(
        ['points-students', classroomId],
        (old) =>
          old
            ? {
                ...old,
                data: old.data.map((s) =>
                  s.student_id === studentId
                    ? { ...s, semester_points: 0 }
                    : s,
                ),
              }
            : old,
      )
      if (data.skipped) {
        setToast(t('points.toast.reset_skipped_zero'))
      } else {
        const delta = data.record?.points ?? 0
        qc.setQueryData<{ data: ClassPointsSummary[] } | undefined>(
          ['points-classrooms'],
          (old) =>
            old
              ? {
                  data: old.data.map((c) =>
                    c.classroom_id === classroomId
                      ? {
                          ...c,
                          semester_points: c.semester_points + delta,
                        }
                      : c,
                  ),
                }
              : old,
        )
        setToast(t('points.toast.reset_done'))
      }
      setTimeout(() => setToast(null), 3000)
      qc.invalidateQueries({ queryKey: ['points-students', classroomId] })
      qc.invalidateQueries({ queryKey: ['points-classrooms'] })
      setConfirm(null)
    },
    onError: (err) => {
      setToast(
        err instanceof ApiError && err.body?.message
          ? err.body.message
          : t('common.error_generic'),
      )
      setTimeout(() => setToast(null), 4000)
    },
  })

  const resetClassMut = useMutation({
    mutationFn: () => api.points.resetClassroom(classroomId as string),
    onSuccess: (data) => {
      qc.setQueryData<StudentPointsSummaryList | undefined>(
        ['points-students', classroomId],
        (old) =>
          old
            ? {
                ...old,
                data: old.data.map((s) => ({ ...s, semester_points: 0 })),
              }
            : old,
      )
      qc.setQueryData<{ data: ClassPointsSummary[] } | undefined>(
        ['points-classrooms'],
        (old) =>
          old
            ? {
                data: old.data.map((c) =>
                  c.classroom_id === classroomId
                    ? { ...c, semester_points: 0 }
                    : c,
                ),
              }
            : old,
      )
      setToast(
        t('points.toast.reset_class_done', {
          written: data.written,
          skipped: data.skipped,
        }),
      )
      setTimeout(() => setToast(null), 3000)
      qc.invalidateQueries({ queryKey: ['points-students', classroomId] })
      qc.invalidateQueries({ queryKey: ['points-classrooms'] })
      setConfirm(null)
    },
    onError: (err) => {
      setToast(
        err instanceof ApiError && err.body?.message
          ? err.body.message
          : t('common.error_generic'),
      )
      setTimeout(() => setToast(null), 4000)
    },
  })

  if (!classroomId) return null

  const headerTitle = view
    ? `${view.classroom_grade}年${view.classroom_name}・${t('points.title')}`
    : t('points.title')

  return (
    <PageContainer>
      <PageHeader
        title={headerTitle}
        subtitle={t('points.classroom_subtitle')}
        actions={
          <div className="flex items-center gap-3">
            {students.length > 0 && (
              <button
                type="button"
                disabled={isArchived || resetClassMut.isPending}
                onClick={() => setConfirm({ kind: 'class' })}
                className="text-sm font-medium px-3 py-1.5 rounded-md border border-rose-200 bg-rose-50 text-rose-700 hover:bg-rose-100 disabled:opacity-40 disabled:cursor-not-allowed"
              >
                {t('points.reset_class')}
              </button>
            )}
            <Link to="/points" className="text-sm text-slate-600 hover:text-slate-900">
              ← {t('points.back')}
            </Link>
          </div>
        }
      />

      {isArchived && (
        <ArchivedSemesterBanner
          label={viewed ? `${viewed.academic_year}-${viewed.term}` : null}
        />
      )}

      {studentsQ.isLoading && (
        <div className="text-center text-slate-400 py-16">
          {t('common.loading')}
        </div>
      )}

      {!studentsQ.isLoading && students.length === 0 && (
        <div className="bg-white border border-slate-200 rounded-xl p-8 text-center text-sm text-slate-500">
          {t('points.empty_students')}
        </div>
      )}

      {!studentsQ.isLoading && students.length > 0 && (
        <>
          <div className="flex items-center gap-3 mb-4">
            <input
              type="search"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder={t('points.search_placeholder')}
              className="w-full sm:w-72 border border-slate-300 rounded-lg px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-amber-500"
            />
            <span className="text-xs text-slate-500 hidden sm:inline">
              {t('points.match_count', { count: filteredStudents.length })}
            </span>
            <label className="inline-flex items-center gap-1.5 text-xs text-slate-600 cursor-pointer">
              <input
                type="checkbox"
                checked={
                  filteredStudents.length > 0 &&
                  filteredStudents.every((s) =>
                    selected.has(s.student_id),
                  )
                }
                ref={(el) => {
                  if (!el) return
                  const allChecked =
                    filteredStudents.length > 0 &&
                    filteredStudents.every((s) =>
                      selected.has(s.student_id),
                    )
                  const someChecked =
                    !allChecked &&
                    filteredStudents.some((s) => selected.has(s.student_id))
                  el.indeterminate = someChecked
                }}
                onChange={(e) => {
                  if (e.target.checked) {
                    setSelected(
                      (prev) =>
                        new Set([
                          ...prev,
                          ...filteredStudents.map((s) => s.student_id),
                        ]),
                    )
                  } else {
                    setSelected((prev) => {
                      const next = new Set(prev)
                      for (const s of filteredStudents)
                        next.delete(s.student_id)
                      return next
                    })
                  }
                }}
                disabled={filteredStudents.length === 0}
              />
              {t('points.select_all')}
            </label>
            <button
              type="button"
              disabled={isArchived || selected.size === 0}
              onClick={() => setBatchMode('add')}
              className="inline-flex items-center px-3 py-1.5 rounded-md bg-emerald-600 hover:bg-emerald-700 text-white text-sm font-medium shadow-sm disabled:bg-slate-300 disabled:cursor-not-allowed"
            >
              {t('points.batch_add', { count: selected.size })}
            </button>
            <button
              type="button"
              disabled={isArchived || selected.size === 0}
              onClick={() => setBatchMode('deduct')}
              className="inline-flex items-center px-3 py-1.5 rounded-md bg-rose-600 hover:bg-rose-700 text-white text-sm font-medium shadow-sm disabled:bg-slate-300 disabled:cursor-not-allowed"
            >
              {t('points.batch_deduct', { count: selected.size })}
            </button>
            <div className="flex items-center gap-1">
            <button
              onClick={() => changeView('list')}
              className={`px-3 py-1.5 text-sm rounded-md transition-colors ${
                displayMode === 'list'
                  ? 'bg-slate-900 text-white'
                  : 'bg-white border border-slate-200 text-slate-600 hover:bg-slate-50'
              }`}
            >
              {t('classes.view.list')}
            </button>
            <button
              onClick={() => changeView('card')}
              className={`px-3 py-1.5 text-sm rounded-md transition-colors ${
                displayMode === 'card'
                  ? 'bg-slate-900 text-white'
                  : 'bg-white border border-slate-200 text-slate-600 hover:bg-slate-50'
              }`}
            >
              {t('classes.view.card')}
            </button>
            </div>
          </div>

          {filteredStudents.length === 0 ? (
            <div className="bg-white border border-slate-200 rounded-xl p-8 text-center text-sm text-slate-500">
              {t('points.no_match')}
            </div>
          ) : displayMode === 'card' ? (
            <ul className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-5 gap-3">
              {filteredStudents.map((s) => {
                const label = `${s.seat_number} ${s.name ?? ''}`.trim()
                return (
                  <li
                    key={s.student_id}
                    className="bg-white border border-slate-200 rounded-xl p-3 shadow-sm flex flex-col gap-2"
                  >
                    <div className="flex items-baseline justify-between gap-2">
                      <label className="inline-flex items-baseline gap-2 min-w-0">
                        <input
                          type="checkbox"
                          checked={selected.has(s.student_id)}
                          onChange={() => toggleSelected(s.student_id)}
                          className="shrink-0"
                          aria-label={s.name ?? ''}
                        />
                        <a
                          href={`/students/${s.student_id}`}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="text-sm font-medium text-slate-900 hover:text-amber-700 truncate"
                          title={s.name ?? ''}
                        >
                          <span className="text-slate-500 font-mono tabular-nums mr-1">
                            {s.seat_number}
                          </span>
                          {s.name || '—'}
                        </a>
                      </label>
                      <span
                        className={`text-xs font-mono tabular-nums font-semibold shrink-0 ${
                          s.semester_points > 0
                            ? 'text-emerald-700'
                            : s.semester_points < 0
                              ? 'text-rose-700'
                              : 'text-slate-400'
                        }`}
                      >
                        {s.semester_points >= 0
                          ? `+${s.semester_points}`
                          : s.semester_points}
                      </span>
                    </div>
                    <div className="flex flex-wrap gap-1.5">
                      <button
                        disabled={isArchived || addMut.isPending}
                        onClick={() => openEntry(s.student_id, label, 'add')}
                        className="inline-flex items-center text-sm font-medium px-3.5 py-2 rounded-full bg-emerald-50 border border-emerald-200 text-emerald-800 hover:bg-emerald-100 disabled:opacity-40 disabled:cursor-not-allowed"
                      >
                        {t('points.add')}
                      </button>
                      <button
                        disabled={isArchived || addMut.isPending}
                        onClick={() => openEntry(s.student_id, label, 'deduct')}
                        className="inline-flex items-center text-sm font-medium px-3.5 py-2 rounded-full bg-rose-50 border border-rose-200 text-rose-800 hover:bg-rose-100 disabled:opacity-40 disabled:cursor-not-allowed"
                      >
                        {t('points.deduct')}
                      </button>
                      <button
                        disabled={
                          isArchived ||
                          s.semester_points === 0 ||
                          resetStudentMut.isPending
                        }
                        onClick={() =>
                          setConfirm({
                            kind: 'student',
                            studentId: s.student_id,
                            label,
                            current: s.semester_points,
                          })
                        }
                        className="inline-flex items-center text-sm font-medium px-3.5 py-2 rounded-full bg-white border border-slate-200 text-slate-600 hover:bg-slate-50 disabled:opacity-40 disabled:cursor-not-allowed"
                      >
                        {t('points.reset_student')}
                      </button>
                    </div>
                  </li>
                )
              })}
            </ul>
          ) : (
            <div className="bg-white border border-slate-200 rounded-xl overflow-hidden">
              <table className="min-w-full text-sm">
                <thead className="bg-slate-50 border-b border-slate-200 text-slate-600">
                  <tr>
                    <th className="px-3 py-3 w-10"></th>
                    <th className="px-4 py-3 text-left font-medium w-16">
                      {t('students.col.seat')}
                    </th>
                    <th className="px-4 py-3 text-left font-medium">
                      {t('students.col.name')}
                    </th>
                    <th className="px-4 py-3 text-right font-medium w-28">
                      {t('points.col.semester_points')}
                    </th>
                    <th className="px-4 py-3 text-left font-medium">
                      {t('points.col.actions')}
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {filteredStudents.map((s) => {
                    const label = `${s.seat_number} ${s.name ?? ''}`.trim()
                    return (
                      <tr
                        key={s.student_id}
                        className="border-b border-slate-100 last:border-b-0"
                      >
                        <td className="px-3 py-2.5">
                          <input
                            type="checkbox"
                            checked={selected.has(s.student_id)}
                            onChange={() => toggleSelected(s.student_id)}
                            aria-label={s.name ?? ''}
                          />
                        </td>
                        <td className="px-4 py-2.5 text-slate-500 font-mono tabular-nums">
                          {s.seat_number}
                        </td>
                        <td className="px-4 py-2.5">
                          <a
                            href={`/students/${s.student_id}`}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="text-slate-900 hover:text-amber-700"
                          >
                            {s.name || '—'}
                          </a>
                        </td>
                        <td
                          className={`px-4 py-2.5 text-right tabular-nums font-semibold ${
                            s.semester_points > 0
                              ? 'text-emerald-700'
                              : s.semester_points < 0
                                ? 'text-rose-700'
                                : 'text-slate-500'
                          }`}
                        >
                          {s.semester_points}
                        </td>
                        <td className="px-4 py-2.5">
                          <div className="flex flex-wrap gap-1.5">
                            <button
                              disabled={isArchived || addMut.isPending}
                              onClick={() =>
                                openEntry(s.student_id, label, 'add')
                              }
                              className="text-sm font-medium px-3 py-1.5 rounded-lg border bg-emerald-50 border-emerald-200 text-emerald-800 hover:bg-emerald-100 disabled:opacity-40 disabled:cursor-not-allowed"
                            >
                              {t('points.add')}
                            </button>
                            <button
                              disabled={isArchived || addMut.isPending}
                              onClick={() =>
                                openEntry(s.student_id, label, 'deduct')
                              }
                              className="text-sm font-medium px-3 py-1.5 rounded-lg border bg-rose-50 border-rose-200 text-rose-800 hover:bg-rose-100 disabled:opacity-40 disabled:cursor-not-allowed"
                            >
                              {t('points.deduct')}
                            </button>
                            <button
                              disabled={
                                isArchived ||
                                s.semester_points === 0 ||
                                resetStudentMut.isPending
                              }
                              onClick={() =>
                                setConfirm({
                                  kind: 'student',
                                  studentId: s.student_id,
                                  label,
                                  current: s.semester_points,
                                })
                              }
                              className="text-sm font-medium px-3 py-1.5 rounded-lg border border-rose-200 text-rose-700 hover:bg-rose-50 disabled:opacity-40 disabled:cursor-not-allowed"
                            >
                              {t('points.reset_student')}
                            </button>
                          </div>
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          )}
        </>
      )}

      {toast && (
        <div className="fixed bottom-6 right-6 px-4 py-3 rounded-lg bg-slate-900 text-white text-sm shadow-lg z-50">
          {toast}
        </div>
      )}

      {modal && (
        <PointEntryModal
          key={`student-${modal.mode}`}
          mode={modal.mode}
          applyMode="student"
          reasonSuggestions={reasonSuggestions}
          pending={addMut.isPending}
          onClose={() => setModal(null)}
          onConfirm={(reason, points) =>
            addMut.mutate({
              studentId: modal.studentId,
              reason,
              points,
            })
          }
        />
      )}

      {batchMode && (
        <PointEntryModal
          key={`batch-${batchMode}`}
          mode={batchMode}
          applyMode="class"
          reasonSuggestions={reasonSuggestions}
          pending={batchMut.isPending}
          onClose={() => {
            if (!batchMut.isPending) setBatchMode(null)
          }}
          onConfirm={(reason, points) =>
            batchMut.mutate({ reason, points })
          }
        />
      )}

      {confirm && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/40 px-4"
          onClick={() => {
            if (!resetStudentMut.isPending && !resetClassMut.isPending) {
              setConfirm(null)
            }
          }}
        >
          <div
            className="bg-white rounded-xl shadow-xl max-w-md w-full p-6"
            onClick={(e) => e.stopPropagation()}
          >
            <h2 className="text-lg font-semibold text-slate-900 mb-2">
              {confirm.kind === 'student'
                ? t('points.reset_confirm_student_title')
                : t('points.reset_confirm_class_title')}
            </h2>
            <p className="text-sm text-slate-600 mb-5 leading-relaxed">
              {confirm.kind === 'student'
                ? t('points.reset_confirm_student', {
                    label: confirm.label,
                    current:
                      confirm.current >= 0
                        ? `+${confirm.current}`
                        : String(confirm.current),
                  })
                : t('points.reset_confirm_class', {
                    count: students.length,
                  })}
            </p>
            <div className="flex justify-end gap-2">
              <button
                type="button"
                disabled={
                  resetStudentMut.isPending || resetClassMut.isPending
                }
                onClick={() => setConfirm(null)}
                className="px-4 py-2 text-sm font-medium rounded-md border border-slate-200 text-slate-700 hover:bg-slate-50 disabled:opacity-40"
              >
                {t('common.cancel')}
              </button>
              <button
                type="button"
                disabled={
                  resetStudentMut.isPending || resetClassMut.isPending
                }
                onClick={() => {
                  if (confirm.kind === 'student') {
                    resetStudentMut.mutate(confirm.studentId)
                  } else {
                    resetClassMut.mutate()
                  }
                }}
                className="px-4 py-2 text-sm font-medium rounded-md bg-rose-600 text-white hover:bg-rose-700 disabled:opacity-40"
              >
                {t('points.reset_confirm_action')}
              </button>
            </div>
          </div>
        </div>
      )}
    </PageContainer>
  )
}
