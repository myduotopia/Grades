import { useEffect, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Link } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'

import { ActionCard } from '../components/ActionCard'
import { useClassrooms } from '../hooks/useClassrooms'
import { PageContainer } from '../layout/PageContainer'
import { PageHeader } from '../layout/PageHeader'
import {
  api,
  type HomeClassRankingItem,
  type HomePoorPerformanceItem,
  type HomeTopStudentItem,
  type ReasonCount,
} from '../lib/api'
import { classroomDisplayName } from '../lib/classroomFormat'

type ClassSort = 'points_desc' | 'points_asc'
type StudentSortKey = 'seat' | 'total_points' | 'met_count' | 'reason'
type PoorSortKey = 'seat' | 'deducted_total' | 'deduction_count' | 'reason'
type SortDir = 'asc' | 'desc'

function primaryReason(items: ReasonCount[]): string {
  return items[0]?.reason ?? ''
}

export function Home() {
  const { t, i18n } = useTranslation()

  return (
    <PageContainer>
      <PageHeader title={t('home.welcome')} subtitle={t('home.intro')} />

      <section className="mb-8">
        <h2 className="text-sm font-semibold text-slate-500 uppercase tracking-wide mb-4">
          {t('home.quick_actions')}
        </h2>
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
          <ActionCard to="/classes" label={t('home.action.add_classroom')} primary />
          <ActionCard to="/points" label={t('home.action.points')} />
          <ActionCard to="/alerts" label={t('home.action.alerts')} />
        </div>
      </section>

      <section className="mb-8">
        <h2 className="text-lg font-semibold text-slate-900 mb-3 tracking-tight">
          {t('home.class_ranking.title')}
        </h2>
        <ClassRankingWidget lang={i18n.language} />
      </section>

      <section className="mb-8">
        <h2 className="text-lg font-semibold text-slate-900 mb-3 tracking-tight">
          {t('home.top_students.title')}
        </h2>
        <TopStudentsWidget lang={i18n.language} />
      </section>

      <section>
        <h2 className="text-lg font-semibold text-slate-900 mb-3 tracking-tight">
          {t('home.poor_performance.title')}
        </h2>
        <PoorPerformanceWidget lang={i18n.language} />
      </section>
    </PageContainer>
  )
}

function ClassRankingWidget({ lang }: { lang: string }) {
  const { t } = useTranslation()
  const [subjectId, setSubjectId] = useState<string>('')
  const [sort, setSort] = useState<ClassSort>('points_desc')

  const subjectsQ = useQuery({
    queryKey: ['subjects'],
    queryFn: () => api.subjects.list(),
  })
  const rankQ = useQuery({
    queryKey: ['home-class-rankings', subjectId || null],
    queryFn: () => api.home.classRankings(subjectId || undefined),
  })

  const sorted = useMemo(() => {
    const rows = [...(rankQ.data?.data ?? [])]
    rows.sort((a, b) =>
      sort === 'points_desc' ? b.points - a.points : a.points - b.points,
    )
    return rows
  }, [rankQ.data, sort])

  return (
    <div className="bg-white border border-slate-200 rounded-xl">
      <div className="flex flex-wrap items-center gap-3 p-4 border-b border-slate-100">
        <label className="text-sm text-slate-700 inline-flex items-center gap-2">
          {t('home.class_ranking.subject_label')}
          <select
            value={subjectId}
            onChange={(e) => setSubjectId(e.target.value)}
            className="border border-slate-300 rounded-md px-2 py-1 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-amber-500"
          >
            <option value="">{t('home.class_ranking.all_subjects')}</option>
            {(subjectsQ.data?.data ?? []).map((s) => (
              <option key={s.id} value={s.id}>
                {s.system_key ? t(`subject.${s.system_key}`) : s.display_name}
              </option>
            ))}
          </select>
        </label>
        <button
          type="button"
          onClick={() =>
            setSort((s) => (s === 'points_desc' ? 'points_asc' : 'points_desc'))
          }
          title={
            sort === 'points_desc'
              ? t('home.class_ranking.sort_desc')
              : t('home.class_ranking.sort_asc')
          }
          aria-label={
            sort === 'points_desc'
              ? t('home.class_ranking.sort_desc')
              : t('home.class_ranking.sort_asc')
          }
          className="ml-auto inline-flex items-center gap-1 px-2 py-1 rounded-md border border-slate-200 bg-white hover:bg-slate-50 text-sm text-slate-700"
        >
          <span className="text-xs text-slate-500">
            {t('home.class_ranking.col_points')}
          </span>
          <span className="text-amber-700 text-sm leading-none">
            {sort === 'points_desc' ? '▼' : '▲'}
          </span>
        </button>
      </div>
      {rankQ.isLoading ? (
        <div className="px-4 py-6 text-sm text-slate-500 text-center">
          {t('common.loading')}
        </div>
      ) : sorted.length === 0 ? (
        <div className="px-4 py-6 text-sm text-slate-500 text-center">
          {t('home.class_ranking.empty')}
        </div>
      ) : (
        <ol className="divide-y divide-slate-100">
          {sorted.map((r, idx) => (
            <ClassRankingRow key={r.classroom_id} row={r} rank={idx + 1} lang={lang} />
          ))}
        </ol>
      )}
    </div>
  )
}

function ClassRankingRow({
  row,
  rank,
  lang,
}: {
  row: HomeClassRankingItem
  rank: number
  lang: string
}) {
  return (
    <li className="flex items-center gap-3 px-4 py-2.5">
      <span className="w-6 text-right font-mono tabular-nums text-slate-500 text-sm">
        {rank}
      </span>
      <Link
        to={`/points/${row.classroom_id}`}
        className="flex-1 text-slate-900 text-sm hover:text-amber-700"
      >
        {classroomDisplayName(row.classroom_grade, row.classroom_name, lang)}
      </Link>
      <span className="font-mono tabular-nums text-amber-700 font-semibold text-sm">
        {row.points}
      </span>
    </li>
  )
}

function TopStudentsWidget({ lang }: { lang: string }) {
  const { t } = useTranslation()
  const [classroomId, setClassroomId] = useState<string>('')
  const [sortKey, setSortKey] = useState<StudentSortKey>('total_points')
  const [sortDir, setSortDir] = useState<SortDir>('desc')

  const classroomsQ = useClassrooms()
  const topQ = useQuery({
    queryKey: ['home-top-students', classroomId || null],
    queryFn: () =>
      api.home.topStudents({
        classroomId: classroomId || undefined,
        limit: 10,
      }),
  })

  const sorted = useMemo(() => {
    const rows = [...(topQ.data?.data ?? [])]
    const cmp = (a: HomeTopStudentItem, b: HomeTopStudentItem) => {
      if (sortKey === 'seat') {
        if (a.classroom_grade !== b.classroom_grade)
          return a.classroom_grade - b.classroom_grade
        if (a.classroom_name !== b.classroom_name)
          return a.classroom_name.localeCompare(b.classroom_name)
        return a.seat_number - b.seat_number
      }
      if (sortKey === 'total_points') return a.total_points - b.total_points
      if (sortKey === 'met_count') return a.met_count - b.met_count
      return primaryReason(a.reason_breakdown).localeCompare(
        primaryReason(b.reason_breakdown),
      )
    }
    rows.sort(cmp)
    if (sortDir === 'desc') rows.reverse()
    return rows
  }, [topQ.data, sortKey, sortDir])

  function toggleSort(key: StudentSortKey) {
    if (sortKey === key) {
      setSortDir((d) => (d === 'desc' ? 'asc' : 'desc'))
    } else {
      setSortKey(key)
      setSortDir(key === 'seat' ? 'asc' : 'desc')
    }
  }

  const classrooms = classroomsQ.data?.data ?? []
  return (
    <div className="bg-white border border-slate-200 rounded-xl overflow-hidden">
      <div className="flex flex-wrap gap-1 px-4 py-3 border-b border-slate-100">
        <button
          type="button"
          onClick={() => setClassroomId('')}
          className={`px-3 py-1.5 text-xs rounded-md ${
            classroomId === ''
              ? 'bg-slate-900 text-white'
              : 'bg-white border border-slate-200 text-slate-600 hover:bg-slate-50'
          }`}
        >
          {t('home.top_students.tab_all')}
        </button>
        {classrooms.map((c) => (
          <button
            key={c.id}
            type="button"
            onClick={() => setClassroomId(c.id)}
            className={`px-3 py-1.5 text-xs rounded-md ${
              classroomId === c.id
                ? 'bg-slate-900 text-white'
                : 'bg-white border border-slate-200 text-slate-600 hover:bg-slate-50'
            }`}
          >
            {classroomDisplayName(c.grade, c.name, lang)}
          </button>
        ))}
      </div>
      {topQ.isLoading ? (
        <div className="px-4 py-6 text-sm text-slate-500 text-center">
          {t('common.loading')}
        </div>
      ) : sorted.length === 0 ? (
        <div className="px-4 py-6 text-sm text-slate-500 text-center">
          {t('home.top_students.empty')}
        </div>
      ) : (
        <div className="overflow-x-auto">
          <table className="min-w-full text-sm table-fixed">
            <thead className="bg-slate-50 text-slate-600 border-b border-slate-200">
              <tr>
                <th className="px-3 py-2 text-left font-medium w-28">
                  {t('home.top_students.col.classroom')}
                </th>
                <SortableTh
                  active={sortKey === 'seat'}
                  dir={sortDir}
                  onClick={() => toggleSort('seat')}
                  className="w-16"
                >
                  {t('home.top_students.col.seat')}
                </SortableTh>
                <th className="px-3 py-2 text-left font-medium w-32">
                  {t('home.top_students.col.name')}
                </th>
                <SortableTh
                  active={sortKey === 'total_points'}
                  dir={sortDir}
                  onClick={() => toggleSort('total_points')}
                  align="right"
                  className="w-20"
                >
                  {t('home.top_students.col.points')}
                </SortableTh>
                <SortableTh
                  active={sortKey === 'met_count'}
                  dir={sortDir}
                  onClick={() => toggleSort('met_count')}
                  align="right"
                  className="w-20"
                >
                  {t('home.top_students.col.met')}
                </SortableTh>
                <SortableTh
                  active={sortKey === 'reason'}
                  dir={sortDir}
                  onClick={() => toggleSort('reason')}
                >
                  {t('home.top_students.col.reason')}
                </SortableTh>
              </tr>
            </thead>
            <tbody>
              {sorted.map((s) => (
                <tr key={s.student_id} className="border-b border-slate-100 last:border-b-0">
                  <td className="px-3 py-2 text-slate-700 truncate">
                    {classroomDisplayName(s.classroom_grade, s.classroom_name, lang)}
                  </td>
                  <td className="px-3 py-2 text-slate-500 font-mono tabular-nums">
                    {s.seat_number}
                  </td>
                  <td className="px-3 py-2 truncate">
                    <Link
                      to={`/students/${s.student_id}`}
                      target="_blank"
                      rel="noopener noreferrer"
                      title={s.name || undefined}
                      className="text-slate-900 hover:text-amber-700"
                    >
                      {s.name || '—'}
                    </Link>
                  </td>
                  <td className="px-3 py-2 text-right font-mono tabular-nums text-amber-700 font-semibold">
                    {s.total_points}
                  </td>
                  <td className="px-3 py-2 text-right font-mono tabular-nums text-emerald-700">
                    {s.met_count}
                  </td>
                  <td className="px-3 py-2">
                    <ReasonBreakdown items={s.reason_breakdown} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}

function ReasonBreakdown({ items }: { items: ReasonCount[] }) {
  if (items.length === 0) {
    return <span className="text-slate-300">—</span>
  }
  return (
    <div className="flex flex-wrap gap-1">
      {items.map((r) => (
        <span
          key={r.reason}
          className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded bg-slate-100 text-slate-600 text-xs"
        >
          {r.reason}
          <span className="font-mono tabular-nums text-slate-400">
            ×{r.count}
          </span>
        </span>
      ))}
    </div>
  )
}

function SortableTh({
  children,
  active,
  dir,
  onClick,
  align = 'left',
  className = '',
}: {
  children: React.ReactNode
  active: boolean
  dir: SortDir
  onClick: () => void
  align?: 'left' | 'right'
  className?: string
}) {
  return (
    <th
      className={`px-3 py-2 font-medium cursor-pointer select-none ${
        align === 'right' ? 'text-right' : 'text-left'
      } ${className}`}
      onClick={onClick}
    >
      <span className="inline-flex items-center gap-1">
        {children}
        <span
          className={`text-[10px] ${active ? 'text-amber-700' : 'text-slate-300'}`}
        >
          {active ? (dir === 'desc' ? '▼' : '▲') : '▲▼'}
        </span>
      </span>
    </th>
  )
}

const POOR_PAGE_SIZE = 10

function PoorPerformanceWidget({ lang }: { lang: string }) {
  const { t } = useTranslation()
  const [classroomId, setClassroomId] = useState<string>('')
  // Default: most-deducted first. deducted_total is negative, so ascending
  // puts the most-negative student on top.
  const [sortKey, setSortKey] = useState<PoorSortKey>('deducted_total')
  const [sortDir, setSortDir] = useState<SortDir>('asc')

  const classroomsQ = useClassrooms()
  const poorQ = useQuery({
    queryKey: ['home-poor-performance', classroomId || null],
    queryFn: () => api.home.poorPerformance(classroomId || undefined),
  })

  const sorted = useMemo(() => {
    const rows = [...(poorQ.data?.data ?? [])]
    const cmp = (a: HomePoorPerformanceItem, b: HomePoorPerformanceItem) => {
      if (sortKey === 'seat') {
        if (a.classroom_grade !== b.classroom_grade)
          return a.classroom_grade - b.classroom_grade
        if (a.classroom_name !== b.classroom_name)
          return a.classroom_name.localeCompare(b.classroom_name)
        return a.seat_number - b.seat_number
      }
      if (sortKey === 'deducted_total')
        return a.deducted_total - b.deducted_total
      if (sortKey === 'deduction_count')
        return a.deduction_count - b.deduction_count
      return primaryReason(a.reason_breakdown).localeCompare(
        primaryReason(b.reason_breakdown),
      )
    }
    rows.sort(cmp)
    if (sortDir === 'desc') rows.reverse()
    return rows
  }, [poorQ.data, sortKey, sortDir])

  function toggleSort(key: PoorSortKey) {
    if (sortKey === key) {
      setSortDir((d) => (d === 'desc' ? 'asc' : 'desc'))
    } else {
      setSortKey(key)
      setSortDir(key === 'deduction_count' ? 'desc' : 'asc')
    }
  }

  // Client-side pagination: the endpoint returns every deducted student, so
  // page through 10 at a time. Switching class changes the list length, so
  // reset to page 1; safePage clamps after a sort/filter shrinks the list.
  const [page, setPage] = useState(1)
  useEffect(() => setPage(1), [classroomId])
  const totalPages = Math.max(1, Math.ceil(sorted.length / POOR_PAGE_SIZE))
  const safePage = Math.min(page, totalPages)
  const pageRows = sorted.slice(
    (safePage - 1) * POOR_PAGE_SIZE,
    safePage * POOR_PAGE_SIZE,
  )

  const classrooms = classroomsQ.data?.data ?? []
  return (
    <div className="bg-white border border-slate-200 rounded-xl overflow-hidden">
      <div className="flex flex-wrap gap-1 px-4 py-3 border-b border-slate-100">
        <button
          type="button"
          onClick={() => setClassroomId('')}
          className={`px-3 py-1.5 text-xs rounded-md ${
            classroomId === ''
              ? 'bg-slate-900 text-white'
              : 'bg-white border border-slate-200 text-slate-600 hover:bg-slate-50'
          }`}
        >
          {t('home.poor_performance.tab_all')}
        </button>
        {classrooms.map((c) => (
          <button
            key={c.id}
            type="button"
            onClick={() => setClassroomId(c.id)}
            className={`px-3 py-1.5 text-xs rounded-md ${
              classroomId === c.id
                ? 'bg-slate-900 text-white'
                : 'bg-white border border-slate-200 text-slate-600 hover:bg-slate-50'
            }`}
          >
            {classroomDisplayName(c.grade, c.name, lang)}
          </button>
        ))}
      </div>
      {poorQ.isLoading ? (
        <div className="px-4 py-6 text-sm text-slate-500 text-center">
          {t('common.loading')}
        </div>
      ) : sorted.length === 0 ? (
        <div className="px-4 py-6 text-sm text-slate-500 text-center">
          {t('home.poor_performance.empty')}
        </div>
      ) : (
        <>
        <div className="overflow-x-auto">
          <table className="min-w-full text-sm table-fixed">
            <thead className="bg-slate-50 text-slate-600 border-b border-slate-200">
              <tr>
                <th className="px-3 py-2 text-left font-medium w-28">
                  {t('home.poor_performance.col.classroom')}
                </th>
                <SortableTh
                  active={sortKey === 'seat'}
                  dir={sortDir}
                  onClick={() => toggleSort('seat')}
                  className="w-16"
                >
                  {t('home.poor_performance.col.seat')}
                </SortableTh>
                <th className="px-3 py-2 text-left font-medium w-32">
                  {t('home.poor_performance.col.name')}
                </th>
                <SortableTh
                  active={sortKey === 'deducted_total'}
                  dir={sortDir}
                  onClick={() => toggleSort('deducted_total')}
                  align="right"
                  className="w-20"
                >
                  {t('home.poor_performance.col.deducted')}
                </SortableTh>
                <SortableTh
                  active={sortKey === 'deduction_count'}
                  dir={sortDir}
                  onClick={() => toggleSort('deduction_count')}
                  align="right"
                  className="w-20"
                >
                  {t('home.poor_performance.col.count')}
                </SortableTh>
                <SortableTh
                  active={sortKey === 'reason'}
                  dir={sortDir}
                  onClick={() => toggleSort('reason')}
                >
                  {t('home.poor_performance.col.reason')}
                </SortableTh>
              </tr>
            </thead>
            <tbody>
              {pageRows.map((s) => (
                <tr
                  key={s.student_id}
                  className="border-b border-slate-100 last:border-b-0"
                >
                  <td className="px-3 py-2 text-slate-700 truncate">
                    {classroomDisplayName(
                      s.classroom_grade,
                      s.classroom_name,
                      lang,
                    )}
                  </td>
                  <td className="px-3 py-2 text-slate-500 font-mono tabular-nums">
                    {s.seat_number}
                  </td>
                  <td className="px-3 py-2 truncate">
                    <Link
                      to={`/students/${s.student_id}`}
                      target="_blank"
                      rel="noopener noreferrer"
                      title={s.name || undefined}
                      className="text-slate-900 hover:text-amber-700"
                    >
                      {s.name || '—'}
                    </Link>
                  </td>
                  <td className="px-3 py-2 text-right font-mono tabular-nums text-rose-700 font-semibold">
                    {s.deducted_total}
                  </td>
                  <td className="px-3 py-2 text-right font-mono tabular-nums text-slate-600">
                    {s.deduction_count}
                  </td>
                  <td className="px-3 py-2">
                    <ReasonBreakdown items={s.reason_breakdown} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {totalPages > 1 && (
          <div className="flex items-center justify-center gap-3 px-4 py-3 border-t border-slate-100 text-sm text-slate-600">
            <button
              type="button"
              disabled={safePage <= 1}
              onClick={() => setPage(safePage - 1)}
              className="px-3 py-1.5 rounded-md border border-slate-200 bg-white hover:bg-slate-50 disabled:opacity-40 disabled:cursor-not-allowed"
            >
              {t('pagination.prev')}
            </button>
            <span className="font-mono tabular-nums">
              {t('pagination.page_of', { page: safePage, total: totalPages })}
            </span>
            <button
              type="button"
              disabled={safePage >= totalPages}
              onClick={() => setPage(safePage + 1)}
              className="px-3 py-1.5 rounded-md border border-slate-200 bg-white hover:bg-slate-50 disabled:opacity-40 disabled:cursor-not-allowed"
            >
              {t('pagination.next')}
            </button>
          </div>
        )}
        </>
      )}
    </div>
  )
}
