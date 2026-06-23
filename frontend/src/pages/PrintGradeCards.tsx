/**
 * Print page for student grade cards (#210 follow-up). Chrome-free route
 * (`/classes/print?ids=a,b,c`) opened from the class list. Lets the teacher
 * pick which subject(s) to include, then prints ~6 成績總覽卡 per A4, with a
 * page break between classes. Reuses `StudentSummaryCard`.
 */
import { useEffect, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useSearchParams } from 'react-router-dom'
import { useQueries } from '@tanstack/react-query'

import { StudentSummaryCard } from '../components/StudentGradeCard'
import { api, type ClassGradeCardsView, type GradeCardSubject } from '../lib/api'

export function PrintGradeCards() {
  const { t } = useTranslation()
  const [params] = useSearchParams()
  const ids = useMemo(
    () =>
      (params.get('ids') ?? '')
        .split(',')
        .map((s) => s.trim())
        .filter(Boolean),
    [params],
  )

  const results = useQueries({
    queries: ids.map((id) => ({
      queryKey: ['grade-cards', id],
      queryFn: () => api.grades.gradeCards(id),
    })),
  })

  const loading = results.some((r) => r.isLoading)
  const classes = results
    .map((r) => r.data)
    .filter((d): d is ClassGradeCardsView => !!d)

  // Union of subjects across all classes (for the picker), de-duped by id.
  const allSubjects = useMemo(() => {
    const seen = new Map<string, GradeCardSubject>()
    for (const c of classes) {
      for (const s of c.subjects) if (!seen.has(s.subject_id)) seen.set(s.subject_id, s)
    }
    return [...seen.values()]
  }, [classes])

  // Default: all subjects selected, once data has loaded.
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [inited, setInited] = useState(false)
  useEffect(() => {
    if (!inited && allSubjects.length > 0) {
      setSelected(new Set(allSubjects.map((s) => s.subject_id)))
      setInited(true)
    }
  }, [allSubjects, inited])

  const subjectFilter = [...selected]
  const subjectLabel = (s: GradeCardSubject) =>
    s.subject_system_key
      ? t(`subject.${s.subject_system_key}`)
      : (s.subject_display_name ?? '—')

  function toggle(id: string) {
    setSelected((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  return (
    <div className="min-h-screen bg-white text-slate-900">
      {/* Toolbar — hidden when printing */}
      <div className="print:hidden border-b border-slate-200 bg-slate-50 px-4 py-3 sticky top-0 z-10">
        <div className="max-w-5xl mx-auto flex flex-wrap items-center gap-3">
          <h1 className="text-base font-semibold">{t('print.title')}</h1>
          <div className="grow" />
          <button
            onClick={() => window.print()}
            disabled={loading || classes.length === 0}
            className="px-4 py-1.5 rounded-lg bg-slate-900 text-white text-sm font-medium disabled:opacity-50"
          >
            🖨 {t('print.print_button')}
          </button>
        </div>
        {allSubjects.length > 0 && (
          <div className="max-w-5xl mx-auto mt-3">
            <div className="text-xs text-slate-500 mb-1">
              {t('print.pick_subjects')}
            </div>
            <div className="flex flex-wrap gap-x-4 gap-y-1">
              {allSubjects.map((s) => (
                <label
                  key={s.subject_id}
                  className="inline-flex items-center gap-1.5 text-sm cursor-pointer"
                >
                  <input
                    type="checkbox"
                    checked={selected.has(s.subject_id)}
                    onChange={() => toggle(s.subject_id)}
                  />
                  {subjectLabel(s)}
                </label>
              ))}
            </div>
          </div>
        )}
      </div>

      {loading && (
        <div className="text-center text-slate-400 py-16">
          {t('common.loading')}
        </div>
      )}

      {!loading && classes.length === 0 && (
        <div className="text-center text-slate-400 py-16">
          {t('print.empty')}
        </div>
      )}

      {/* Print body — one section per class, page break between classes */}
      <div className="px-4 py-4">
        {classes.map((c, ci) => (
          <section
            key={ci}
            className="print-class max-w-5xl mx-auto mb-6 print:mb-0"
          >
            <h2 className="text-sm font-semibold text-slate-700 mb-2 print:mb-2">
              {c.classroom_grade}
              {t('print.grade_suffix')}
              {c.classroom_name}
              {t('print.class_suffix')}
            </h2>
            <div className="grid grid-cols-2 gap-3">
              {c.cards.map((card) => (
                <div key={card.student_id} className="break-inside-avoid">
                  <StudentSummaryCard
                    classroomGrade={c.classroom_grade}
                    classroomName={c.classroom_name}
                    seatNumber={card.seat_number}
                    name={card.name}
                    metCount={card.met_count_total}
                    semesterPoints={card.semester_points}
                    subjects={card.subjects}
                    subjectFilter={subjectFilter}
                  />
                </div>
              ))}
            </div>
          </section>
        ))}
      </div>
    </div>
  )
}
