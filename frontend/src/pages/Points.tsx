import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Link } from 'react-router-dom'
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
  type ClassPointsSummary,
  type PointReason,
} from '../lib/api'
import { reasonLabel } from '../lib/pointReasons'

const SECONDARY_BTN =
  'inline-flex items-center px-4 py-2 rounded-lg bg-white border border-slate-200 hover:border-slate-300 hover:bg-slate-50 text-slate-700 text-sm font-medium shadow-sm transition-colors disabled:opacity-60'

type View = 'list' | 'card'
const VIEW_KEY = 'points.view'

interface ModalState {
  classroomId: string
  reason: string
  points: number
  editableReason: boolean
}

export function Points() {
  const { t } = useTranslation()
  const qc = useQueryClient()
  const meQ = useMe()
  const { isArchived, viewed } = useSemesterView()

  const summaryQ = useQuery({
    queryKey: ['points-classrooms'],
    queryFn: () => api.points.listClassrooms(),
  })

  const reasons: PointReason[] = (meQ.data?.point_reasons ?? []).filter(
    (r) => !r.system_key,
  )
  const summaries: ClassPointsSummary[] = summaryQ.data?.data ?? []

  const [view, setView] = useState<View>(
    (localStorage.getItem(VIEW_KEY) as View) || 'card',
  )
  function changeView(v: View) {
    setView(v)
    localStorage.setItem(VIEW_KEY, v)
  }

  const [modal, setModal] = useState<ModalState | null>(null)
  const [toast, setToast] = useState<string | null>(null)

  const batchMut = useMutation({
    mutationFn: (args: {
      classroomId: string
      points: number
      reason: string
    }) =>
      api.points.classBatch(args.classroomId, {
        points: args.points,
        reason: args.reason,
      }),
    onSuccess: (data, vars) => {
      // Optimistic local update so the card / row total moves instantly,
      // without waiting for the invalidate-triggered refetch. The refetch
      // below still runs and replaces this with server truth shortly after.
      qc.setQueryData<{ data: ClassPointsSummary[] } | undefined>(
        ['points-classrooms'],
        (old) =>
          old
            ? {
                data: old.data.map((c) =>
                  c.classroom_id === vars.classroomId
                    ? {
                        ...c,
                        semester_points:
                          c.semester_points + vars.points * c.student_count,
                      }
                    : c,
                ),
              }
            : old,
      )
      setToast(
        t('points.toast.applied_class', {
          count: data.written,
          delta: vars.points >= 0 ? `+${vars.points}` : String(vars.points),
          reason: vars.reason,
        }),
      )
      setTimeout(() => setToast(null), 3000)
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

  function openCustom(classroomId: string) {
    setModal({
      classroomId,
      reason: '',
      points: 1,
      editableReason: true,
    })
  }

  return (
    <PageContainer>
      <PageHeader
        title={t('points.title')}
        subtitle={t('points.subtitle')}
      />

      {!isArchived && reasons.length === 0 && (
        <div className="mb-4 rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">
          {t('points.no_reasons')}
          <Link
            to="/admin/reasons"
            className="ml-2 underline font-medium"
          >
            {t('points.manage_reasons')}
          </Link>
        </div>
      )}

      {isArchived && (
        <ArchivedSemesterBanner
          label={viewed ? `${viewed.academic_year}-${viewed.term}` : null}
        />
      )}

      {summaryQ.isLoading && (
        <div className="text-center text-slate-400 py-16">
          {t('common.loading')}
        </div>
      )}

      {!summaryQ.isLoading && summaries.length === 0 && (
        <div className="bg-white border border-slate-200 rounded-xl p-12 text-center text-sm text-slate-500">
          {t('points.empty_classrooms')}
          <div className="mt-3">
            <Link
              to="/classes"
              className="text-amber-700 hover:text-amber-800 font-medium"
            >
              {t('points.goto_classes')} →
            </Link>
          </div>
        </div>
      )}

      {!summaryQ.isLoading && summaries.length > 0 && (
        <>
          <div className="flex items-center justify-end gap-1 mb-4">
            <button
              onClick={() => changeView('list')}
              className={`px-3 py-1.5 text-sm rounded-md transition-colors ${
                view === 'list'
                  ? 'bg-slate-900 text-white'
                  : 'bg-white border border-slate-200 text-slate-600 hover:bg-slate-50'
              }`}
            >
              {t('classes.view.list')}
            </button>
            <button
              onClick={() => changeView('card')}
              className={`px-3 py-1.5 text-sm rounded-md transition-colors ${
                view === 'card'
                  ? 'bg-slate-900 text-white'
                  : 'bg-white border border-slate-200 text-slate-600 hover:bg-slate-50'
              }`}
            >
              {t('classes.view.card')}
            </button>
          </div>

          {view === 'card' ? (
            <ul className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
              {summaries.map((c) => (
                <li
                  key={c.classroom_id}
                  className="bg-white border border-slate-200 rounded-xl p-5 shadow-sm flex flex-col gap-4"
                >
                  <div>
                    <Link
                      to={`/points/${c.classroom_id}`}
                      className="text-base font-semibold text-slate-900 hover:text-amber-700"
                    >
                      {c.grade}年{c.name}
                    </Link>
                    <div className="text-xs text-slate-500 mt-1">
                      {t('points.classroom_card.summary', {
                        count: c.student_count,
                        total: c.semester_points,
                      })}
                    </div>
                  </div>
                  <div className="flex flex-wrap gap-1.5">
                    {reasons.map((r) => (
                      <button
                        key={r.id}
                        disabled={isArchived || batchMut.isPending}
                        onClick={() =>
                          batchMut.mutate({
                            classroomId: c.classroom_id,
                            reason: reasonLabel(r, t),
                            points: r.default_points,
                          })
                        }
                        className={`inline-flex items-center gap-1.5 text-sm font-medium px-3.5 py-2 rounded-full border disabled:opacity-40 disabled:cursor-not-allowed ${
                          r.default_points >= 0
                            ? 'bg-sky-50 border-sky-200 text-sky-800 hover:bg-sky-100'
                            : 'bg-rose-50 border-rose-200 text-rose-800 hover:bg-rose-100'
                        }`}
                      >
                        {reasonLabel(r, t)}
                        <span className="font-mono tabular-nums">
                          {r.default_points >= 0
                            ? `+${r.default_points}`
                            : r.default_points}
                        </span>
                      </button>
                    ))}
                    <button
                      disabled={isArchived}
                      onClick={() => openCustom(c.classroom_id)}
                      className="inline-flex items-center text-sm font-medium px-3.5 py-2 rounded-full bg-white border border-slate-200 text-slate-600 hover:bg-slate-50 disabled:opacity-40 disabled:cursor-not-allowed"
                    >
                      + {t('points.custom')}
                    </button>
                  </div>
                </li>
              ))}
            </ul>
          ) : (
            <div className="bg-white border border-slate-200 rounded-xl overflow-hidden">
              <table className="min-w-full text-sm">
                <thead className="bg-slate-50 border-b border-slate-200 text-slate-600">
                  <tr>
                    <th className="px-4 py-3 text-left font-medium">
                      {t('points.col.classroom')}
                    </th>
                    <th className="px-4 py-3 text-right font-medium">
                      {t('points.col.students')}
                    </th>
                    <th className="px-4 py-3 text-right font-medium">
                      {t('points.col.semester_points')}
                    </th>
                    <th className="px-4 py-3 text-left font-medium">
                      {t('points.col.actions')}
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {summaries.map((c) => (
                    <tr
                      key={c.classroom_id}
                      className="border-b border-slate-100 last:border-b-0"
                    >
                      <td className="px-4 py-2.5">
                        <Link
                          to={`/points/${c.classroom_id}`}
                          className="text-slate-900 font-medium hover:text-amber-700"
                        >
                          {c.grade}年{c.name}
                        </Link>
                      </td>
                      <td className="px-4 py-2.5 text-right tabular-nums text-slate-700">
                        {c.student_count}
                      </td>
                      <td className="px-4 py-2.5 text-right tabular-nums font-semibold text-slate-900">
                        {c.semester_points}
                      </td>
                      <td className="px-4 py-2.5">
                        <div className="flex flex-wrap gap-1.5">
                          {reasons.map((r) => (
                            <button
                              key={r.id}
                              disabled={isArchived || batchMut.isPending}
                              onClick={() =>
                                batchMut.mutate({
                                  classroomId: c.classroom_id,
                                  reason: reasonLabel(r, t),
                                  points: r.default_points,
                                })
                              }
                              className={`text-sm font-medium px-3 py-1.5 rounded-lg border disabled:opacity-40 disabled:cursor-not-allowed ${
                                r.default_points >= 0
                                  ? 'bg-sky-50 border-sky-200 text-sky-800 hover:bg-sky-100'
                                  : 'bg-rose-50 border-rose-200 text-rose-800 hover:bg-rose-100'
                              }`}
                            >
                              {reasonLabel(r, t)}{' '}
                              {r.default_points >= 0
                                ? `+${r.default_points}`
                                : r.default_points}
                            </button>
                          ))}
                          <button
                            disabled={isArchived}
                            onClick={() => openCustom(c.classroom_id)}
                            className="text-sm font-medium px-3 py-1.5 rounded-lg border border-slate-200 text-slate-600 hover:bg-slate-50 disabled:opacity-40 disabled:cursor-not-allowed"
                          >
                            +
                          </button>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          <div className="mt-4">
            <Link
              to="/admin/reasons"
              className="text-sm text-slate-500 hover:text-amber-700"
            >
              {t('points.manage_reasons')} →
            </Link>
          </div>
        </>
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
          applyMode="class"
          pending={batchMut.isPending}
          onClose={() => setModal(null)}
          onConfirm={(reason, points) =>
            batchMut.mutate({
              classroomId: modal.classroomId,
              reason,
              points,
            })
          }
        />
      )}
    </PageContainer>
  )
}

// Re-export to suppress unused warning if i18n SecondaryBtn is referenced
// from elsewhere later.
export const _POINTS_SECONDARY_BTN = SECONDARY_BTN
