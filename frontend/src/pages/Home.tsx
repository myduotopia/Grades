import { useMemo, useState } from 'react'
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
  type HomeTopStudentItem,
} from '../lib/api'
import { classroomDisplayName } from '../lib/classroomFormat'

type ClassSort = 'points_desc' | 'points_asc'
type StudentSortKey = 'seat' | 'total_points' | 'met_count'
type SortDir = 'asc' | 'desc'

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

      <section>
        <h2 className="text-lg font-semibold text-slate-900 mb-3 tracking-tight">
          {t('home.top_students.title')}
        </h2>
        <TopStudentsWidget lang={i18n.language} />
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
      return a.met_count - b.met_count
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
          <table className="min-w-full text-sm">
            <thead className="bg-slate-50 text-slate-600 border-b border-slate-200">
              <tr>
                <th className="px-3 py-2 text-left font-medium">
                  {t('home.top_students.col.classroom')}
                </th>
                <SortableTh
                  active={sortKey === 'seat'}
                  dir={sortDir}
                  onClick={() => toggleSort('seat')}
                >
                  {t('home.top_students.col.seat')}
                </SortableTh>
                <th className="px-3 py-2 text-left font-medium">
                  {t('home.top_students.col.name')}
                </th>
                <SortableTh
                  active={sortKey === 'total_points'}
                  dir={sortDir}
                  onClick={() => toggleSort('total_points')}
                  align="right"
                >
                  {t('home.top_students.col.points')}
                </SortableTh>
                <SortableTh
                  active={sortKey === 'met_count'}
                  dir={sortDir}
                  onClick={() => toggleSort('met_count')}
                  align="right"
                >
                  {t('home.top_students.col.met')}
                </SortableTh>
              </tr>
            </thead>
            <tbody>
              {sorted.map((s) => (
                <tr key={s.student_id} className="border-b border-slate-100 last:border-b-0">
                  <td className="px-3 py-2 text-slate-700">
                    {classroomDisplayName(s.classroom_grade, s.classroom_name, lang)}
                  </td>
                  <td className="px-3 py-2 text-slate-500 font-mono tabular-nums">
                    {s.seat_number}
                  </td>
                  <td className="px-3 py-2">
                    <Link
                      to={`/students/${s.student_id}`}
                      target="_blank"
                      rel="noopener noreferrer"
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
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}

function SortableTh({
  children,
  active,
  dir,
  onClick,
  align = 'left',
}: {
  children: React.ReactNode
  active: boolean
  dir: SortDir
  onClick: () => void
  align?: 'left' | 'right'
}) {
  return (
    <th
      className={`px-3 py-2 font-medium cursor-pointer select-none ${
        align === 'right' ? 'text-right' : 'text-left'
      }`}
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
