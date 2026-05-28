import { useEffect, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Link } from 'react-router-dom'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'

import { useClassrooms } from '../hooks/useClassrooms'
import { PageContainer } from '../layout/PageContainer'
import { PageHeader } from '../layout/PageHeader'
import { api, type HomeAlertListItem } from '../lib/api'
import { classroomDisplayName } from '../lib/classroomFormat'

type SortKey = 'seat' | 'total_points' | 'met_count' | 'zero_score_count'
type SortDir = 'asc' | 'desc'

export function Alerts() {
  const { t, i18n } = useTranslation()
  const qc = useQueryClient()
  const [classroomId, setClassroomId] = useState<string>('')
  const [nameFilter, setNameFilter] = useState<string>('')
  const [sortKey, setSortKey] = useState<SortKey>('zero_score_count')
  const [sortDir, setSortDir] = useState<SortDir>('desc')

  const classroomsQ = useClassrooms()
  const listQ = useQuery({
    queryKey: ['home-alerts-list', classroomId || null],
    queryFn: () => api.home.alertsList(classroomId || undefined),
  })
  const markViewed = useMutation({
    mutationFn: () => api.home.markAlertsViewed(),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['home-alerts-summary'] })
    },
  })

  // Issue #161: visiting the page clears the badge counter — record the
  // moment once per mount so future-flipped 0s relight the badge.
  useEffect(() => {
    markViewed.mutate()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const rows = listQ.data?.data ?? []
  const names = useMemo(() => {
    const seen = new Set<string>()
    const out: string[] = []
    for (const r of rows) {
      const n = r.name || ''
      if (!seen.has(n)) {
        seen.add(n)
        out.push(n)
      }
    }
    return out.sort()
  }, [rows])

  const filtered = useMemo(() => {
    const f = nameFilter
      ? rows.filter((r) => (r.name || '') === nameFilter)
      : rows
    const cmp = (a: HomeAlertListItem, b: HomeAlertListItem) => {
      if (sortKey === 'seat') {
        if (a.classroom_grade !== b.classroom_grade)
          return a.classroom_grade - b.classroom_grade
        if (a.classroom_name !== b.classroom_name)
          return a.classroom_name.localeCompare(b.classroom_name)
        return a.seat_number - b.seat_number
      }
      return a[sortKey] - b[sortKey]
    }
    const out = [...f].sort(cmp)
    if (sortDir === 'desc') out.reverse()
    return out
  }, [rows, nameFilter, sortKey, sortDir])

  function toggleSort(key: SortKey) {
    if (sortKey === key) {
      setSortDir((d) => (d === 'desc' ? 'asc' : 'desc'))
    } else {
      setSortKey(key)
      setSortDir(key === 'seat' ? 'asc' : 'desc')
    }
  }

  const classrooms = classroomsQ.data?.data ?? []
  return (
    <PageContainer>
      <PageHeader
        title={t('alerts.title')}
        subtitle={t('alerts.subtitle')}
      />

      <div className="flex flex-wrap gap-1 mb-3">
        <button
          type="button"
          onClick={() => setClassroomId('')}
          className={`px-3 py-1.5 text-sm rounded-md ${
            classroomId === ''
              ? 'bg-slate-900 text-white'
              : 'bg-white border border-slate-200 text-slate-600 hover:bg-slate-50'
          }`}
        >
          {t('alerts.tab_all')}
        </button>
        {classrooms.map((c) => (
          <button
            key={c.id}
            type="button"
            onClick={() => setClassroomId(c.id)}
            className={`px-3 py-1.5 text-sm rounded-md ${
              classroomId === c.id
                ? 'bg-slate-900 text-white'
                : 'bg-white border border-slate-200 text-slate-600 hover:bg-slate-50'
            }`}
          >
            {classroomDisplayName(c.grade, c.name, i18n.language)}
          </button>
        ))}
      </div>

      <div className="flex flex-wrap items-center gap-3 mb-3 text-sm text-slate-600">
        <label className="inline-flex items-center gap-2">
          {t('alerts.filter_name_label')}
          <select
            value={nameFilter}
            onChange={(e) => setNameFilter(e.target.value)}
            className="border border-slate-300 rounded-md px-2 py-1 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-amber-500"
          >
            <option value="">{t('alerts.filter_name_all')}</option>
            {names.map((n) => (
              <option key={n} value={n}>
                {n || '—'}
              </option>
            ))}
          </select>
        </label>
      </div>

      {listQ.isLoading ? (
        <div className="bg-white border border-slate-200 rounded-xl p-8 text-sm text-slate-500 text-center">
          {t('common.loading')}
        </div>
      ) : filtered.length === 0 ? (
        <div className="bg-white border border-slate-200 rounded-xl p-8 text-sm text-slate-500 text-center">
          {t('alerts.empty')}
        </div>
      ) : (
        <div className="bg-white border border-slate-200 rounded-xl overflow-hidden">
          <div className="overflow-x-auto">
            <table className="min-w-full text-sm">
              <thead className="bg-slate-50 text-slate-600 border-b border-slate-200">
                <tr>
                  <th className="px-3 py-2 text-left font-medium">
                    {t('alerts.col.classroom')}
                  </th>
                  <SortableTh
                    active={sortKey === 'seat'}
                    dir={sortDir}
                    onClick={() => toggleSort('seat')}
                  >
                    {t('alerts.col.seat')}
                  </SortableTh>
                  <th className="px-3 py-2 text-left font-medium">
                    {t('alerts.col.name')}
                  </th>
                  <SortableTh
                    active={sortKey === 'total_points'}
                    dir={sortDir}
                    onClick={() => toggleSort('total_points')}
                    align="right"
                  >
                    {t('alerts.col.points')}
                  </SortableTh>
                  <SortableTh
                    active={sortKey === 'met_count'}
                    dir={sortDir}
                    onClick={() => toggleSort('met_count')}
                    align="right"
                  >
                    {t('alerts.col.met')}
                  </SortableTh>
                  <SortableTh
                    active={sortKey === 'zero_score_count'}
                    dir={sortDir}
                    onClick={() => toggleSort('zero_score_count')}
                    align="right"
                  >
                    {t('alerts.col.zeros')}
                  </SortableTh>
                </tr>
              </thead>
              <tbody>
                {filtered.map((s) => (
                  <tr
                    key={s.student_id}
                    className="border-b border-slate-100 last:border-b-0"
                  >
                    <td className="px-3 py-2 text-slate-700">
                      {classroomDisplayName(
                        s.classroom_grade,
                        s.classroom_name,
                        i18n.language,
                      )}
                    </td>
                    <td className="px-3 py-2 text-slate-500 font-mono tabular-nums">
                      {s.seat_number}
                    </td>
                    <td className="px-3 py-2">
                      <Link
                        to={`/students/${s.student_id}`}
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
                    <td className="px-3 py-2 text-right font-mono tabular-nums text-rose-600 font-semibold">
                      {s.zero_score_count}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </PageContainer>
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
