import { useTranslation } from 'react-i18next'
import { useParams, useSearchParams } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'

import { ArchivedSemesterBanner } from '../components/ArchivedSemesterBanner'
import { useSemesters } from '../hooks/useSemesters'
import { PageContainer } from '../layout/PageContainer'
import { PageHeader } from '../layout/PageHeader'
import { api, type StudentGradeRow, type StudentPointRow, type StudentSubjectSummary } from '../lib/api'

const SELECT_CLS =
  'border border-slate-300 rounded-lg px-3 py-1.5 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-amber-500'

export function StudentDetail() {
  const { t } = useTranslation()
  const { studentId } = useParams<{ studentId: string }>()
  const [params, setParams] = useSearchParams()
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
  const pointsQ = useQuery({
    queryKey: ['student-points', studentId, semesterId],
    queryFn: () => api.students.points(studentId as string, semesterId),
    enabled: !!studentId,
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

      <div className="flex flex-wrap items-center gap-3 mb-4 text-sm text-slate-600">
        <label className="inline-flex items-center gap-2">
          {t('student_detail.semester_label')}
          <select
            value={semesterId ?? detail?.semester_id ?? ''}
            onChange={(e) => {
              const v = e.target.value
              setParams((p) => {
                const c = new URLSearchParams(p)
                if (v) c.set('semester', v)
                else c.delete('semester')
                return c
              })
            }}
            className={SELECT_CLS}
          >
            {semesters.map((s) => (
              <option key={s.id} value={s.id}>
                {`${s.academic_year}-${s.term}`}
                {s.is_current ? ` (${t('admin_semesters.current_badge')})` : ''}
              </option>
            ))}
          </select>
        </label>
      </div>

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
          {pointsView.data.length === 0 ? (
            <div className="bg-white border border-slate-200 rounded-xl p-6 text-sm text-slate-500 text-center">
              {t('student_detail.no_points')}
            </div>
          ) : (
            <PointHistoryTable rows={pointsView.data} />
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

function PointHistoryTable({ rows }: { rows: StudentPointRow[] }) {
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
              <th className="px-4 py-3 text-right font-medium">
                {t('student_detail.col.delta')}
              </th>
              <th className="px-4 py-3 text-left font-medium">
                {t('student_detail.col.reason')}
              </th>
            </tr>
          </thead>
          <tbody>
            {rows.map((p) => (
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
                <td className="px-4 py-2 text-slate-700">
                  {p.reason}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}
