import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Link } from 'react-router-dom'

import { useSemesterView } from '../state/SemesterView'
import type { Semester } from '../lib/api'

export function formatSemester(s: Pick<Semester, 'academic_year' | 'term'>): string {
  return `${s.academic_year} 學年 第 ${s.term} 學期`
}

/**
 * Top-bar semester picker — a pure VIEW filter.
 *
 * Clicking another row only changes which semester the app's pages show;
 * it does NOT mutate the server's `is_current` flag. To promote a semester
 * to "current" (and therefore editable), use the 「設為目前學期」 control
 * on /admin/semesters. Pages render <ArchivedSemesterBanner> and disable
 * edit affordances whenever the viewed semester is not the current one.
 */
export function SemesterSwitcher() {
  const { t } = useTranslation()
  const { all, viewed, current, isArchived, setViewed } = useSemesterView()
  const [open, setOpen] = useState(false)

  if (all.length === 0) {
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
        className={`inline-flex items-center gap-1.5 text-sm px-3 py-1.5 rounded-md border hover:bg-slate-50 text-slate-700 ${
          isArchived
            ? 'border-amber-300 bg-amber-50'
            : 'border-slate-200 bg-white'
        }`}
        aria-haspopup="listbox"
        aria-expanded={open}
        title={isArchived ? t('semester.viewing_archived') : undefined}
      >
        <span className="text-xs text-slate-400">{t('semester.label')}</span>
        <span className="font-medium text-slate-900">
          {viewed ? formatSemester(viewed) : t('semester.switcher_empty')}
        </span>
        {isArchived && (
          <span
            className="text-[10px] uppercase tracking-wider text-amber-700 bg-amber-100 rounded px-1 py-0.5"
            aria-hidden
          >
            {t('semester.archived_tag')}
          </span>
        )}
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
            className="absolute right-0 mt-1 w-64 max-h-72 overflow-y-auto rounded-md border border-slate-200 bg-white shadow-lg z-40 py-1"
          >
            {all.map((s) => {
              const isViewed = viewed?.id === s.id
              const isCurrent = current?.id === s.id
              return (
                <li key={s.id}>
                  <button
                    role="option"
                    aria-selected={isViewed}
                    onClick={() => {
                      setOpen(false)
                      if (!isViewed) setViewed(s.id)
                    }}
                    className={`w-full text-left px-3 py-2 text-sm hover:bg-slate-50 flex items-center justify-between gap-2 ${
                      isViewed ? 'bg-amber-50 text-amber-800' : 'text-slate-700'
                    }`}
                  >
                    <span className="flex items-center gap-2">
                      {formatSemester(s)}
                      {isCurrent && (
                        <span className="text-[10px] uppercase tracking-wider text-emerald-700 bg-emerald-50 rounded px-1 py-0.5">
                          {t('semester.current_tag')}
                        </span>
                      )}
                    </span>
                    {isViewed && <span className="text-xs">✓</span>}
                  </button>
                </li>
              )
            })}
            <li className="border-t border-slate-100 mt-1 pt-1">
              <Link
                to="/admin/semesters"
                onClick={() => setOpen(false)}
                className="block px-3 py-2 text-xs text-slate-500 hover:bg-slate-50 hover:text-slate-700"
              >
                {t('semester.manage_link')}
              </Link>
            </li>
          </ul>
        </>
      )}
    </div>
  )
}
