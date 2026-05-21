import type { Semester } from './api'

function formatYearMonth(iso: string): string {
  const [y, m] = iso.split('-')
  return `${y}/${parseInt(m, 10)}`
}

export function formatSemesterLabel(
  s: Pick<Semester, 'academic_year' | 'term' | 'start_date' | 'end_date'>,
): string {
  return `民國 ${s.academic_year} 學年度 第 ${s.term} 學期 (${formatYearMonth(s.start_date)} - ${formatYearMonth(s.end_date)})`
}

export function formatSemesterShort(
  s: Pick<Semester, 'academic_year' | 'term'>,
): string {
  return `民國 ${s.academic_year} 學年度 第 ${s.term} 學期`
}

export function formatDateRange(start: string, end: string): string {
  return `${formatYearMonth(start)} - ${formatYearMonth(end)}`
}
