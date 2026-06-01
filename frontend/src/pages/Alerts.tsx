import { useEffect, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Link } from 'react-router-dom'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'

import { useClassrooms } from '../hooks/useClassrooms'
import { PageContainer } from '../layout/PageContainer'
import { PageHeader } from '../layout/PageHeader'
import { api } from '../lib/api'
import { classroomDisplayName } from '../lib/classroomFormat'

type SortKey = 'seat' | 'category' | 'item'
type SortDir = 'asc' | 'desc'

interface MissingRow {
  student_id: string
  classroom_id: string
  classroom_grade: number
  classroom_name: string
  seat_number: number
  name: string | null
  category_system_key: string
  item_name: string
}

export function Alerts() {
  const { t, i18n } = useTranslation()
  const qc = useQueryClient()
  const [classroomId, setClassroomId] = useState<string>('')
  const [nameFilter, setNameFilter] = useState<string>('')
  const [sortKey, setSortKey] = useState<SortKey>('seat')
  const [sortDir, setSortDir] = useState<SortDir>('asc')

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

  // Visiting the page clears the badge counter (#161).
  useEffect(() => {
    markViewed.mutate()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // Flatten: one row per (student, missing item) so the teacher sees every
  // unsubmitted record. Filtering by name brings up that student's full
  // set of missing items.
  const allRows: MissingRow[] = useMemo(() => {
    const out: MissingRow[] = []
    for (const s of listQ.data?.data ?? []) {
      for (const z of s.missing_items) {
        out.push({
          student_id: s.student_id,
          classroom_id: s.classroom_id,
          classroom_grade: s.classroom_grade,
          classroom_name: s.classroom_name,
          seat_number: s.seat_number,
          name: s.name,
          category_system_key: z.category_system_key,
          item_name: z.item_name,
        })
      }
    }
    return out
  }, [listQ.data])

  const names = useMemo(() => {
    const seen = new Set<string>()
    const out: string[] = []
    for (const r of allRows) {
      const n = r.name || ''
      if (!seen.has(n)) {
        seen.add(n)
        out.push(n)
      }
    }
    return out.sort()
  }, [allRows])

  const filtered = useMemo(() => {
    const needle = nameFilter.trim().toLowerCase()
    const f = needle
      ? allRows.filter((r) => (r.name || '').toLowerCase().includes(needle))
      : allRows
    const catLabel = (k: string) => t(`category.${k}`)
    const cmp = (a: MissingRow, b: MissingRow) => {
      if (sortKey === 'seat') {
        if (a.classroom_grade !== b.classroom_grade)
          return a.classroom_grade - b.classroom_grade
        if (a.classroom_name !== b.classroom_name)
          return a.classroom_name.localeCompare(b.classroom_name)
        return a.seat_number - b.seat_number
      }
      if (sortKey === 'category')
        return catLabel(a.category_system_key).localeCompare(
          catLabel(b.category_system_key),
        )
      return a.item_name.localeCompare(b.item_name)
    }
    const out = [...f].sort(cmp)
    if (sortDir === 'desc') out.reverse()
    return out
  }, [allRows, nameFilter, sortKey, sortDir, t])

  function toggleSort(key: SortKey) {
    if (sortKey === key) {
      setSortDir((d) => (d === 'desc' ? 'asc' : 'desc'))
    } else {
      setSortKey(key)
      setSortDir('asc')
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
          <input
            type="search"
            list="alerts-name-options"
            value={nameFilter}
            onChange={(e) => setNameFilter(e.target.value)}
            placeholder={t('alerts.filter_name_all')}
            className="border border-slate-300 rounded-md px-2 py-1 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-amber-500 min-w-[10rem]"
          />
          <datalist id="alerts-name-options">
            {names.map((n) => (
              <option key={n} value={n} />
            ))}
          </datalist>
          {nameFilter && (
            <button
              type="button"
              onClick={() => setNameFilter('')}
              className="text-xs text-slate-500 hover:text-slate-700"
              aria-label={t('alerts.filter_name_clear')}
            >
              ✕
            </button>
          )}
        </label>
        <span className="ml-auto text-xs text-slate-500">
          {t('alerts.total_count', { count: filtered.length })}
        </span>
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
                    active={sortKey === 'category'}
                    dir={sortDir}
                    onClick={() => toggleSort('category')}
                  >
                    {t('alerts.col.category')}
                  </SortableTh>
                  <SortableTh
                    active={sortKey === 'item'}
                    dir={sortDir}
                    onClick={() => toggleSort('item')}
                  >
                    {t('alerts.col.item')}
                  </SortableTh>
                </tr>
              </thead>
              <tbody>
                {filtered.map((r, idx) => (
                  <tr
                    key={`${r.student_id}-${r.item_name}-${idx}`}
                    className="border-b border-slate-100 last:border-b-0"
                  >
                    <td className="px-3 py-2 text-slate-700">
                      {classroomDisplayName(
                        r.classroom_grade,
                        r.classroom_name,
                        i18n.language,
                      )}
                    </td>
                    <td className="px-3 py-2 text-slate-500 font-mono tabular-nums">
                      {r.seat_number}
                    </td>
                    <td className="px-3 py-2">
                      <Link
                        to={`/students/${r.student_id}`}
                        className="text-slate-900 hover:text-amber-700"
                      >
                        {r.name || '—'}
                      </Link>
                    </td>
                    <td className="px-3 py-2 text-slate-700">
                      {t(`category.${r.category_system_key}`)}
                    </td>
                    <td className="px-3 py-2 text-slate-700">{r.item_name}</td>
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
}: {
  children: React.ReactNode
  active: boolean
  dir: SortDir
  onClick: () => void
}) {
  return (
    <th
      className="px-3 py-2 font-medium cursor-pointer select-none text-left"
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
