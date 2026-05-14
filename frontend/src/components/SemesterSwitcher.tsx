import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Link } from 'react-router-dom'

import { useSemesters, useSetCurrentSemester } from '../hooks/useSemesters'
import type { Semester } from '../lib/api'

export function formatSemester(s: Pick<Semester, 'academic_year' | 'term'>): string {
  return `${s.academic_year} 學年 第 ${s.term} 學期`
}

/** Top-bar dropdown showing the current semester. Clicking another row in the
 *  list flips the global `is_current` flag via PUT /api/semesters/{id}/set-current. */
export function SemesterSwitcher() {
  const { t } = useTranslation()
  const { data, isLoading } = useSemesters()
  const setCurrent = useSetCurrentSemester()
  const [open, setOpen] = useState(false)

  if (isLoading) {
    return <span className="text-xs text-slate-400">…</span>
  }

  const semesters = data?.data ?? []
  const current = semesters.find((s) => s.is_current) ?? null

  if (semesters.length === 0) {
    return (
      <Link
        to="/admin/semesters"
        className="text-xs px-3 py-1.5 rounded-md border border-amber-200 bg-amber-50 text-amber-700 hover:bg-amber-100"
      >
        {t('semester.switcher_empty')}
      </Link>
    )
  }

  return (
    <div className="relative">
      <button
        onClick={() => setOpen((v) => !v)}
        className="inline-flex items-center gap-1.5 text-sm px-3 py-1.5 rounded-md border border-slate-200 bg-white hover:bg-slate-50 text-slate-700"
        aria-haspopup="listbox"
        aria-expanded={open}
      >
        <span className="text-xs text-slate-400">{t('semester.label')}</span>
        <span className="font-medium text-slate-900">
          {current ? formatSemester(current) : t('semester.switcher_empty')}
        </span>
        <svg
          width="12"
          height="12"
          viewBox="0 0 12 12"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          className="text-slate-400"
        >
          <path d="M3 4.5l3 3 3-3" />
        </svg>
      </button>

      {open && (
        <>
          <div
            className="fixed inset-0 z-30"
            onClick={() => setOpen(false)}
            aria-hidden
          />
          <ul
            role="listbox"
            className="absolute right-0 mt-1 w-56 max-h-72 overflow-y-auto rounded-md border border-slate-200 bg-white shadow-lg z-40 py-1"
          >
            {semesters.map((s) => (
              <li key={s.id}>
                <button
                  role="option"
                  aria-selected={s.is_current}
                  disabled={setCurrent.isPending}
                  onClick={() => {
                    setOpen(false)
                    if (!s.is_current) setCurrent.mutate(s.id)
                  }}
                  className={`w-full text-left px-3 py-2 text-sm hover:bg-slate-50 flex items-center justify-between ${
                    s.is_current ? 'bg-amber-50 text-amber-800' : 'text-slate-700'
                  }`}
                >
                  <span>{formatSemester(s)}</span>
                  {s.is_current && (
                    <span className="text-xs">✓</span>
                  )}
                </button>
              </li>
            ))}
          </ul>
        </>
      )}
    </div>
  )
}
