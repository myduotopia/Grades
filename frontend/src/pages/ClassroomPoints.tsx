import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Link, useParams } from 'react-router-dom'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'

import { ArchivedSemesterBanner } from '../components/ArchivedSemesterBanner'
import { QuickPointModal } from '../components/QuickPointModal'
import { useMe } from '../hooks/useMe'
import { PageContainer } from '../layout/PageContainer'
import { PageHeader } from '../layout/PageHeader'
import { useSemesterView } from '../state/SemesterView'
import {
  api,
  ApiError,
  type PointReason,
} from '../lib/api'

type View = 'list' | 'card'
const VIEW_KEY = 'points.classroom_view'

interface ModalState {
  studentId: string
  studentLabel: string
  reason: string
  points: number
  editableReason: boolean
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

  const reasons: PointReason[] = meQ.data?.point_reasons ?? []
  const students = studentsQ.data?.data ?? []
  const view = studentsQ.data

  const [modal, setModal] = useState<ModalState | null>(null)
  const [toast, setToast] = useState<string | null>(null)
  const [displayMode, setDisplayMode] = useState<View>(
    (localStorage.getItem(VIEW_KEY) as View) || 'card',
  )
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
      setToast(
        t('points.toast.applied_student', {
          delta: vars.points >= 0 ? `+${vars.points}` : String(vars.points),
          reason: vars.reason,
        }),
      )
      setTimeout(() => setToast(null), 3000)
      qc.invalidateQueries({ queryKey: ['points-students', classroomId] })
      qc.invalidateQueries({ queryKey: ['points-classrooms'] })
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

  function openReason(
    studentId: string,
    studentLabel: string,
    reason: PointReason,
  ) {
    setModal({
      studentId,
      studentLabel,
      reason: reason.name,
      points: reason.default_points,
      editableReason: false,
    })
  }
  function openCustom(studentId: string, studentLabel: string) {
    setModal({
      studentId,
      studentLabel,
      reason: '',
      points: 1,
      editableReason: true,
    })
  }

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
          <Link to="/points" className="text-sm text-slate-600 hover:text-slate-900">
            ← {t('points.back')}
          </Link>
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
          <div className="flex items-center justify-end gap-1 mb-4">
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

          {displayMode === 'card' ? (
            <ul className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-5 gap-3">
              {students.map((s) => {
                const label = `${s.seat_number} ${s.name ?? ''}`.trim()
                return (
                  <li
                    key={s.student_id}
                    className="bg-white border border-slate-200 rounded-xl p-3 shadow-sm flex flex-col gap-2"
                  >
                    <div className="flex items-baseline justify-between gap-2">
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
                    <div className="flex flex-wrap gap-1">
                      {reasons.map((r) => (
                        <button
                          key={r.id}
                          disabled={isArchived}
                          onClick={() => openReason(s.student_id, label, r)}
                          className={`text-[11px] font-medium px-1.5 py-0.5 rounded border disabled:opacity-40 disabled:cursor-not-allowed ${
                            r.default_points >= 0
                              ? 'bg-sky-50 border-sky-200 text-sky-800 hover:bg-sky-100'
                              : 'bg-rose-50 border-rose-200 text-rose-800 hover:bg-rose-100'
                          }`}
                          title={`${r.name} ${
                            r.default_points >= 0
                              ? `+${r.default_points}`
                              : r.default_points
                          }`}
                        >
                          {r.name}{' '}
                          <span className="font-mono tabular-nums">
                            {r.default_points >= 0
                              ? `+${r.default_points}`
                              : r.default_points}
                          </span>
                        </button>
                      ))}
                      <button
                        disabled={isArchived}
                        onClick={() => openCustom(s.student_id, label)}
                        className="text-[11px] px-1.5 py-0.5 rounded border border-slate-200 text-slate-600 hover:bg-slate-50 disabled:opacity-40 disabled:cursor-not-allowed"
                      >
                        +
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
                  {students.map((s) => {
                    const label = `${s.seat_number} ${s.name ?? ''}`.trim()
                    return (
                      <tr
                        key={s.student_id}
                        className="border-b border-slate-100 last:border-b-0"
                      >
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
                            {reasons.map((r) => (
                              <button
                                key={r.id}
                                disabled={isArchived}
                                onClick={() =>
                                  openReason(s.student_id, label, r)
                                }
                                className={`text-xs font-medium px-2 py-1 rounded border disabled:opacity-40 disabled:cursor-not-allowed ${
                                  r.default_points >= 0
                                    ? 'bg-sky-50 border-sky-200 text-sky-800 hover:bg-sky-100'
                                    : 'bg-rose-50 border-rose-200 text-rose-800 hover:bg-rose-100'
                                }`}
                              >
                                {r.name}{' '}
                                {r.default_points >= 0
                                  ? `+${r.default_points}`
                                  : r.default_points}
                              </button>
                            ))}
                            <button
                              disabled={isArchived}
                              onClick={() => openCustom(s.student_id, label)}
                              className="text-xs px-2 py-1 rounded border border-slate-200 text-slate-600 hover:bg-slate-50 disabled:opacity-40 disabled:cursor-not-allowed"
                            >
                              + {t('points.custom')}
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

      {!isArchived && reasons.length === 0 && (
        <div className="mt-4 rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">
          {t('points.no_reasons')}
          <Link
            to="/admin/reasons"
            className="ml-2 underline font-medium"
          >
            {t('points.manage_reasons')}
          </Link>
        </div>
      )}

      {toast && (
        <div className="fixed bottom-6 right-6 px-4 py-3 rounded-lg bg-slate-900 text-white text-sm shadow-lg z-50">
          {toast}
        </div>
      )}

      {modal && (
        <QuickPointModal
          initialReason={modal.reason}
          initialPoints={modal.points}
          editableReason={modal.editableReason}
          applyMode="student"
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
    </PageContainer>
  )
}
