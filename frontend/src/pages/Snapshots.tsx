import { useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Link } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'

import { useClassrooms } from '../hooks/useClassrooms'
import { PageContainer } from '../layout/PageContainer'
import { PageHeader } from '../layout/PageHeader'
import { useSemesterView } from '../state/SemesterView'
import { api } from '../lib/api'
import { classroomDisplayName } from '../lib/classroomFormat'

export function Snapshots() {
  const { t, i18n } = useTranslation()
  const { viewed } = useSemesterView()
  const classroomsQ = useClassrooms()
  const classrooms = classroomsQ.data?.data ?? []

  const [filterClassroomId, setFilterClassroomId] = useState<string>('')
  const [fromDate, setFromDate] = useState<string>('')
  const [toDate, setToDate] = useState<string>('')

  const snapshotsQ = useQuery({
    queryKey: [
      'snapshots',
      filterClassroomId || null,
      fromDate || null,
      toDate || null,
      viewed?.id ?? null,
    ],
    queryFn: () =>
      api.snapshots.list({
        classroom_id: filterClassroomId || undefined,
        from_date: fromDate || undefined,
        to_date: toDate || undefined,
        semester_id: viewed?.id,
      }),
  })

  const rows = snapshotsQ.data?.data ?? []

  const dtfmt = useMemo(
    () =>
      new Intl.DateTimeFormat(i18n.language === 'en' ? 'en-US' : 'zh-TW', {
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
        hour: '2-digit',
        minute: '2-digit',
      }),
    [i18n.language],
  )

  return (
    <PageContainer>
      <PageHeader
        title={t('snapshots.title')}
        subtitle={t('snapshots.subtitle')}
      />

      <section className="bg-white border border-slate-200 rounded-xl shadow-sm p-4 mb-4">
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
          <label className="text-sm text-slate-700">
            <div className="mb-1">{t('snapshots.filter.classroom')}</div>
            <select
              value={filterClassroomId}
              onChange={(e) => setFilterClassroomId(e.target.value)}
              className="w-full border border-slate-300 rounded-md px-2 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-amber-500"
            >
              <option value="">{t('snapshots.filter.all_classes')}</option>
              {classrooms.map((c) => (
                <option key={c.id} value={c.id}>
                  {classroomDisplayName(c.grade, c.name, i18n.language)}
                </option>
              ))}
            </select>
          </label>
          <label className="text-sm text-slate-700">
            <div className="mb-1">{t('snapshots.filter.from_date')}</div>
            <input
              type="date"
              value={fromDate}
              onChange={(e) => setFromDate(e.target.value)}
              className="w-full border border-slate-300 rounded-md px-2 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-amber-500"
            />
          </label>
          <label className="text-sm text-slate-700">
            <div className="mb-1">{t('snapshots.filter.to_date')}</div>
            <input
              type="date"
              value={toDate}
              onChange={(e) => setToDate(e.target.value)}
              className="w-full border border-slate-300 rounded-md px-2 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-amber-500"
            />
          </label>
        </div>
      </section>

      {snapshotsQ.isLoading && (
        <div className="text-center text-slate-400 py-12">
          {t('common.loading')}
        </div>
      )}

      {!snapshotsQ.isLoading && rows.length === 0 && (
        <div className="bg-white border border-slate-200 rounded-xl p-8 text-center text-sm text-slate-500">
          {t('snapshots.empty')}
        </div>
      )}

      {rows.length > 0 && (
        <section className="bg-white border border-slate-200 rounded-xl shadow-sm overflow-hidden">
          <table className="min-w-full text-sm">
            <thead className="bg-slate-50 border-b border-slate-200 text-slate-600">
              <tr>
                <th className="px-4 py-3 text-left font-medium">
                  {t('snapshots.col.archived_at')}
                </th>
                <th className="px-4 py-3 text-left font-medium">
                  {t('snapshots.col.class')}
                </th>
                <th className="px-4 py-3 text-left font-medium">
                  {t('snapshots.col.label')}
                </th>
                <th className="px-4 py-3 text-right font-medium w-24"></th>
              </tr>
            </thead>
            <tbody>
              {rows.map((s) => (
                <tr
                  key={s.id}
                  className="border-b border-slate-100 last:border-b-0 hover:bg-slate-50"
                >
                  <td className="px-4 py-2.5 text-slate-700 tabular-nums">
                    {dtfmt.format(new Date(s.created_at))}
                  </td>
                  <td className="px-4 py-2.5 text-slate-700">
                    {classroomDisplayName(
                      s.classroom_grade,
                      s.classroom_name,
                      i18n.language,
                    )}
                  </td>
                  <td className="px-4 py-2.5 text-slate-700">{s.name}</td>
                  <td className="px-4 py-2.5 text-right">
                    <Link
                      to={`/snapshots/${s.id}/grades`}
                      className="text-amber-700 hover:text-amber-900 font-medium text-sm"
                    >
                      {t('snapshots.open')}
                    </Link>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
      )}
    </PageContainer>
  )
}
