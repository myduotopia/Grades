import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useParams, useSearchParams } from 'react-router-dom'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'

import { ArchivedSemesterBanner } from '../components/ArchivedSemesterBanner'
import { useSemesters } from '../hooks/useSemesters'
import { PageContainer } from '../layout/PageContainer'
import { PageHeader } from '../layout/PageHeader'
import {
  api,
  type StudentGradeRow,
  type StudentPointResetRow,
  type StudentPointRow,
  type StudentPointsView,
  type StudentSubjectSummary,
} from '../lib/api'

const POINTS_PAGE_SIZE = 20

const SELECT_CLS =
  'border border-slate-300 rounded-lg px-3 py-1.5 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-amber-500'

export function StudentDetail() {
  const { t } = useTranslation()
  const { studentId } = useParams<{ studentId: string }>()
  const [params] = useSearchParams()
  const semesterId = params.get('semester') ?? undefined

  const semestersQ = useSemesters()
  const detailQ = useQuery({
    queryKey: ['student-detail', studentId, semesterId],
    queryFn: () => api.students.detail(studentId as string, semesterId),
    enabled: !!studentId,
  })
  const gradesQ = useQuery({
    queryKey: ['student-grades', studentId, semesterId],
    queryFn: () => api.students.grades(studentId as string, semesterId),
    enabled: !!studentId,
  })
  const [pointsPage, setPointsPage] = useState(1)
  const [pointsSort, setPointsSort] = useState<'newest' | 'oldest'>('newest')
  const [pointsReason, setPointsReason] = useState<string>('')
  const pointsQ = useQuery({
    queryKey: [
      'student-points',
      studentId,
      semesterId,
      pointsPage,
      pointsSort,
      pointsReason,
    ],
    queryFn: () =>
      api.students.points(studentId as string, {
        semesterId,
        page: pointsPage,
        pageSize: POINTS_PAGE_SIZE,
        sort: pointsSort,
        reason: pointsReason || undefined,
      }),
    enabled: !!studentId,
    placeholderData: (prev) => prev,
  })

  if (!studentId) return null

  const detail = detailQ.data
  const gradesView = gradesQ.data
  const pointsView = pointsQ.data
  const semesters = semestersQ.data?.data ?? []
  const currentSemester = semesters.find((s) => s.is_current)
  const viewedSem = semesters.find((s) => s.id === detail?.semester_id)
  const isArchived =
    !!detail?.semester_id &&
    !!currentSemester &&
    detail.semester_id !== currentSemester.id

  const headerTitle = detail
    ? `${detail.classroom_grade}年${detail.classroom_name}・${detail.seat_number} ${detail.name ?? ''}`
    : t('student_detail.title')

  return (
    <PageContainer>
      <PageHeader
        title={headerTitle}
        subtitle={detail?.email || undefined}
        actions={
          detail && (
            <span className="inline-flex items-center gap-2 px-3 py-1.5 rounded-full bg-amber-50 text-amber-800 text-sm font-medium border border-amber-200">
              {t('student_detail.semester_points', { count: detail.semester_points })}
            </span>
          )
        }
      />

      {isArchived && (
        <ArchivedSemesterBanner
          label={
            viewedSem
              ? `${viewedSem.academic_year}-${viewedSem.term}`
              : detail?.semester_label
          }
        />
      )}

      {detailQ.isLoading && (
        <div className="text-center text-slate-400 py-12">{t('common.loading')}</div>
      )}

      {/* Section · 加權成績摘要 */}
      {gradesView && (
        <section className="mb-6">
          <h2 className="text-base font-semibold text-slate-900 mb-3">
            {t('student_detail.weighted_summary')}
          </h2>
          {gradesView.subjects.length === 0 ? (
            <div className="bg-white border border-slate-200 rounded-xl p-6 text-sm text-slate-500 text-center">
              {t('student_detail.no_grades')}
            </div>
          ) : (
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
              {gradesView.subjects.map((s) => (
                <SubjectCard key={s.subject_id} summary={s} />
              ))}
            </div>
          )}
        </section>
      )}

      {/* Section · 成績歷史 */}
      {gradesView && gradesView.grades.length > 0 && (
        <section className="mb-6">
          <h2 className="text-base font-semibold text-slate-900 mb-3">
            {t('student_detail.grade_history')}
          </h2>
          <GradeHistoryTable rows={gradesView.grades} />
        </section>
      )}

      {/* Section · 點數歷史 */}
      {pointsView && (
        <section className="mb-6">
          <h2 className="text-base font-semibold text-slate-900 mb-3 flex items-center gap-2">
            {t('student_detail.point_history')}
            <span className="text-sm font-normal text-slate-500">
              ({t('student_detail.points_total', { total: pointsView.total })})
            </span>
          </h2>
          <PointHistorySection
            studentId={studentId}
            view={pointsView}
            sort={pointsSort}
            reason={pointsReason}
            isArchived={isArchived}
            onSortChange={(v) => {
              setPointsSort(v)
              setPointsPage(1)
            }}
            onReasonChange={(v) => {
              setPointsReason(v)
              setPointsPage(1)
            }}
            page={pointsPage}
            onPageChange={setPointsPage}
          />
          {pointsView.record_count === 0 && (
            <div className="bg-white border border-slate-200 rounded-xl p-6 text-sm text-slate-500 text-center">
              {pointsReason
                ? t('student_detail.no_points_filtered')
                : t('student_detail.no_points')}
            </div>
          )}
        </section>
      )}
    </PageContainer>
  )
}

function SubjectCard({ summary }: { summary: StudentSubjectSummary }) {
  const { t } = useTranslation()
  const label = summary.subject_system_key
    ? t(`subject.${summary.subject_system_key}`)
    : (summary.subject_display_name ?? '—')
  return (
    <div className="bg-white border border-slate-200 rounded-xl p-4">
      <div className="text-xs text-slate-500 uppercase tracking-wider">
        {label}
      </div>
      <div className="mt-1 text-2xl font-semibold text-slate-900 tabular-nums">
        {summary.weighted_total === null ? '—' : summary.weighted_total.toFixed(1)}
      </div>
      <dl className="mt-3 space-y-1 text-xs text-slate-600">
        {Object.entries(summary.category_averages).map(([k, v]) => (
          <div key={k} className="flex justify-between">
            <dt>{t(`category.${k}`)}</dt>
            <dd className="font-mono tabular-nums">{v.toFixed(1)}</dd>
          </div>
        ))}
      </dl>
    </div>
  )
}

function GradeHistoryTable({ rows }: { rows: StudentGradeRow[] }) {
  const { t } = useTranslation()
  return (
    <div className="bg-white border border-slate-200 rounded-xl overflow-hidden">
      <div className="overflow-x-auto">
        <table className="min-w-full text-sm">
          <thead className="bg-slate-50 border-b border-slate-200 text-slate-600">
            <tr>
              <th className="px-4 py-3 text-left font-medium">
                {t('student_detail.col.date')}
              </th>
              <th className="px-4 py-3 text-left font-medium">
                {t('student_detail.col.subject')}
              </th>
              <th className="px-4 py-3 text-left font-medium">
                {t('student_detail.col.category')}
              </th>
              <th className="px-4 py-3 text-left font-medium">
                {t('student_detail.col.item')}
              </th>
              <th className="px-4 py-3 text-right font-medium">
                {t('student_detail.col.score')}
              </th>
              <th className="px-4 py-3 text-right font-medium">
                {t('student_detail.col.threshold')}
              </th>
            </tr>
          </thead>
          <tbody>
            {rows.map((g) => (
              <tr
                key={g.grade_id}
                className="border-b border-slate-100 last:border-b-0"
              >
                <td className="px-4 py-2 text-slate-500 text-xs font-mono">
                  {g.created_at.slice(0, 10)}
                </td>
                <td className="px-4 py-2 text-slate-900">
                  {g.subject_system_key
                    ? t(`subject.${g.subject_system_key}`)
                    : (g.subject_display_name ?? '—')}
                </td>
                <td className="px-4 py-2 text-slate-700">
                  {t(`category.${g.category_system_key}`)}
                </td>
                <td className="px-4 py-2 text-slate-700">
                  {g.item_name || <span className="text-slate-400">—</span>}
                </td>
                <td className="px-4 py-2 text-right font-mono tabular-nums text-slate-900">
                  {g.score.toFixed(1)}
                  {g.met_standard && (
                    <span className="ml-1 inline-flex items-center text-xs text-emerald-600 font-medium">
                      ✓ {t('student_detail.met')}
                    </span>
                  )}
                </td>
                <td className="px-4 py-2 text-right font-mono tabular-nums text-slate-500 text-xs">
                  {g.threshold === null ? '—' : g.threshold.toFixed(1)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}

interface PointHistorySectionProps {
  studentId: string
  view: StudentPointsView
  sort: 'newest' | 'oldest'
  reason: string
  page: number
  isArchived: boolean
  onSortChange: (v: 'newest' | 'oldest') => void
  onReasonChange: (v: string) => void
  onPageChange: (page: number) => void
}

function PointHistorySection({
  studentId,
  view,
  sort,
  reason,
  page,
  isArchived,
  onSortChange,
  onReasonChange,
  onPageChange,
}: PointHistorySectionProps) {
  const { t } = useTranslation()
  const queryClient = useQueryClient()
  const [pendingDelete, setPendingDelete] = useState<StudentPointRow | null>(
    null,
  )
  const [deleteError, setDeleteError] = useState<string | null>(null)
  const showActionsCol = !isArchived

  const deleteMut = useMutation({
    mutationFn: (pointId: string) =>
      api.points.deleteStudentRecord(studentId, pointId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['student-points', studentId] })
      queryClient.invalidateQueries({ queryKey: ['student-detail', studentId] })
      setPendingDelete(null)
      setDeleteError(null)
    },
    onError: (err: unknown) => {
      const msg =
        err instanceof Error ? err.message : t('common.error_generic')
      setDeleteError(msg)
    },
  })

  const totalPages = view.total_pages
  const hasRows = view.data.length > 0 || view.resets.length > 0

  // Merge records + resets into a single chronologically-sorted list so
  // the reset markers appear as dividers between the records they zeroed
  // out. Resets are returned in full (not paginated), so on multi-page
  // datasets a reset may appear on more than one page near its date —
  // acceptable for the typical small N.
  type MergedRow =
    | { kind: 'record'; rec: StudentPointRow }
    | { kind: 'reset'; rst: StudentPointResetRow }
  const merged: MergedRow[] = [
    ...view.data.map((r) => ({ kind: 'record' as const, rec: r })),
    ...view.resets.map((r) => ({ kind: 'reset' as const, rst: r })),
  ].sort((a, b) => {
    const at = a.kind === 'record' ? a.rec.created_at : a.rst.reset_at
    const bt = b.kind === 'record' ? b.rec.created_at : b.rst.reset_at
    return sort === 'newest' ? bt.localeCompare(at) : at.localeCompare(bt)
  })
  const colSpan = showActionsCol ? 5 : 4
  return (
    <>
      <div className="flex flex-wrap items-center gap-3 mb-3 text-sm text-slate-600">
        <label className="inline-flex items-center gap-2">
          {t('student_detail.filter_reason_label')}
          <select
            value={reason}
            onChange={(e) => onReasonChange(e.target.value)}
            className={SELECT_CLS}
          >
            <option value="">{t('student_detail.filter_reason_all')}</option>
            {view.reasons.map((r) => (
              <option key={r} value={r}>
                {r || '—'}
              </option>
            ))}
          </select>
        </label>
        <label className="inline-flex items-center gap-2">
          {t('student_detail.sort_label')}
          <select
            value={sort}
            onChange={(e) =>
              onSortChange(e.target.value as 'newest' | 'oldest')
            }
            className={SELECT_CLS}
          >
            <option value="newest">{t('student_detail.sort_newest')}</option>
            <option value="oldest">{t('student_detail.sort_oldest')}</option>
          </select>
        </label>
        <span className="ml-auto text-xs text-slate-500">
          {t('student_detail.pagination.total_count', {
            count: view.record_count,
          })}
        </span>
      </div>
      {hasRows && (
        <div className="bg-white border border-slate-200 rounded-xl overflow-hidden">
          <div className="overflow-x-auto">
            <table className="min-w-full text-sm">
              <thead className="bg-slate-50 border-b border-slate-200 text-slate-600">
                <tr>
                  <th className="px-4 py-3 text-left font-medium">
                    {t('student_detail.col.date')}
                  </th>
                  <th className="px-4 py-3 text-right font-medium">
                    {t('student_detail.col.delta')}
                  </th>
                  <th className="px-4 py-3 text-right font-medium">
                    {t('student_detail.col.balance')}
                  </th>
                  <th className="px-4 py-3 text-left font-medium">
                    {t('student_detail.col.reason')}
                  </th>
                  {showActionsCol && (
                    <th className="px-4 py-3 text-right font-medium w-20">
                      {t('student_detail.col.actions')}
                    </th>
                  )}
                </tr>
              </thead>
              <tbody>
                {merged.map((row) => {
                  if (row.kind === 'reset') {
                    const r = row.rst
                    return (
                      <tr
                        key={`reset-${r.id}`}
                        className="bg-amber-50 border-y border-amber-200"
                      >
                        <td
                          colSpan={colSpan}
                          className="px-4 py-2 text-xs text-amber-800"
                        >
                          <span className="font-mono mr-2">
                            {r.reset_at.slice(0, 10)}
                          </span>
                          <span className="font-medium">
                            {t('student_detail.reset_divider', {
                              amount: r.balance_before,
                            })}
                          </span>
                          {r.reason && r.reason !== '歸零' && (
                            <span className="ml-2 text-amber-700">
                              · {r.reason}
                            </span>
                          )}
                        </td>
                      </tr>
                    )
                  }
                  const p = row.rec
                  return (
                    <tr
                      key={p.id}
                      className="border-b border-slate-100 last:border-b-0"
                    >
                      <td className="px-4 py-2 text-slate-500 text-xs font-mono">
                        {p.created_at.slice(0, 10)}
                      </td>
                      <td
                        className={`px-4 py-2 text-right font-mono tabular-nums font-medium ${
                          p.points >= 0 ? 'text-emerald-600' : 'text-rose-600'
                        }`}
                      >
                        {p.points >= 0 ? `+${p.points}` : p.points}
                      </td>
                      <td className="px-4 py-2 text-right font-mono tabular-nums text-slate-500">
                        {p.balance_after >= 0
                          ? `+${p.balance_after}`
                          : p.balance_after}
                      </td>
                      <td className="px-4 py-2 text-slate-700">
                        {p.reason || <span className="text-slate-400">—</span>}
                      </td>
                      {showActionsCol && (
                        <td className="px-4 py-2 text-right">
                          {p.source_grade_id === null ? (
                            <button
                              type="button"
                              onClick={() => {
                                setDeleteError(null)
                                setPendingDelete(p)
                              }}
                              className="text-xs text-rose-600 hover:text-rose-800 hover:underline"
                            >
                              {t('common.delete')}
                            </button>
                          ) : (
                            <span
                              className="text-xs text-slate-300"
                              title={t('student_detail.delete_auto_tooltip')}
                            >
                              —
                            </span>
                          )}
                        </td>
                      )}
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}
      {pendingDelete && (
        <DeletePointConfirm
          row={pendingDelete}
          pending={deleteMut.isPending}
          error={deleteError}
          onCancel={() => {
            if (!deleteMut.isPending) {
              setPendingDelete(null)
              setDeleteError(null)
            }
          }}
          onConfirm={() => deleteMut.mutate(pendingDelete.id)}
        />
      )}
      {totalPages > 1 && (
        <div className="flex items-center justify-center gap-3 mt-3 text-sm text-slate-600">
          <button
            type="button"
            disabled={page <= 1}
            onClick={() => onPageChange(page - 1)}
            className="px-3 py-1.5 rounded-md border border-slate-200 bg-white hover:bg-slate-50 disabled:opacity-40 disabled:cursor-not-allowed"
          >
            {t('student_detail.pagination.prev')}
          </button>
          <span className="font-mono tabular-nums">
            {t('student_detail.pagination.page_of', {
              page,
              total: totalPages,
            })}
          </span>
          <button
            type="button"
            disabled={page >= totalPages}
            onClick={() => onPageChange(page + 1)}
            className="px-3 py-1.5 rounded-md border border-slate-200 bg-white hover:bg-slate-50 disabled:opacity-40 disabled:cursor-not-allowed"
          >
            {t('student_detail.pagination.next')}
          </button>
        </div>
      )}
    </>
  )
}

function DeletePointConfirm({
  row,
  pending,
  error,
  onCancel,
  onConfirm,
}: {
  row: StudentPointRow
  pending: boolean
  error: string | null
  onCancel: () => void
  onConfirm: () => void
}) {
  const { t } = useTranslation()
  const delta = row.points >= 0 ? `+${row.points}` : String(row.points)
  return (
    <div
      className="fixed inset-0 bg-slate-900/50 backdrop-blur-sm flex items-center justify-center p-4 z-50"
      onClick={onCancel}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className="bg-white rounded-2xl shadow-xl border border-slate-200 p-6 w-full max-w-sm"
      >
        <h2 className="text-lg font-semibold tracking-tight mb-3 text-slate-900">
          {t('student_detail.delete_modal.title')}
        </h2>
        <p className="text-sm text-slate-700 mb-2">
          {t('student_detail.delete_modal.body', {
            delta,
            reason: row.reason || '—',
            date: row.created_at.slice(0, 10),
          })}
        </p>
        <p className="text-xs text-slate-500 mb-4">
          {t('student_detail.delete_modal.warning')}
        </p>
        {error && (
          <div className="text-xs text-rose-600 bg-rose-50 border border-rose-200 rounded px-3 py-2 mb-3">
            {error}
          </div>
        )}
        <div className="flex justify-end gap-2">
          <button
            type="button"
            onClick={onCancel}
            disabled={pending}
            className="inline-flex items-center px-4 py-2 rounded-lg bg-white border border-slate-200 hover:border-slate-300 hover:bg-slate-50 text-slate-700 text-sm font-medium shadow-sm transition-colors disabled:opacity-60"
          >
            {t('common.cancel')}
          </button>
          <button
            type="button"
            onClick={onConfirm}
            disabled={pending}
            className="inline-flex items-center px-4 py-2 rounded-lg bg-rose-600 hover:bg-rose-700 active:bg-rose-800 text-white text-sm font-medium shadow-sm transition-colors disabled:bg-slate-300 disabled:cursor-not-allowed"
          >
            {pending
              ? t('common.saving')
              : t('student_detail.delete_modal.confirm')}
          </button>
        </div>
      </div>
    </div>
  )
}
