/**
 * Client-side mirror of backend `default_semester_dates`
 * (backend/models/curriculum.py).
 *
 * Source of truth is still the backend — this exists only so the admin form
 * can show a live preview of the start/end dates as the teacher edits
 * (year, term). Backend validates the final POST anyway (issue #142).
 *
 * Taiwan 學年度 starts Aug 1 of (minguo + 1911) and ends Jul 31 of the next
 * calendar year. Terms divide that 12-month window evenly (2 → 6 months,
 * 3 → 4 months, 4 → 3 months); boundaries fall on first/last day of month.
 */

export interface SemesterRange {
  start_date: string  // YYYY-MM-DD
  end_date: string    // YYYY-MM-DD
}

function toIso(year: number, month: number, day: number): string {
  const mm = String(month).padStart(2, '0')
  const dd = String(day).padStart(2, '0')
  return `${year}-${mm}-${dd}`
}

function lastDayOfMonth(year: number, month: number): number {
  // month is 1-indexed; Date with day=0 gives the previous month's last day.
  return new Date(year, month, 0).getDate()
}

export function defaultSemesterDates(
  academicYearMinguo: number,
  term: number,
  termsPerYear: number,
): SemesterRange {
  if (![2, 3, 4].includes(termsPerYear)) {
    throw new Error(`terms_per_year must be 2/3/4, got ${termsPerYear}`)
  }
  if (term < 1 || term > termsPerYear) {
    throw new Error(`term ${term} out of range for ${termsPerYear}-term year`)
  }
  const gregorianStart = academicYearMinguo + 1911
  const monthsPerTerm = 12 / termsPerYear  // 6 / 4 / 3 — always integer
  const startOffset = (term - 1) * monthsPerTerm  // 0-indexed month from Aug
  const endOffset = startOffset + monthsPerTerm - 1

  // Aug = month 8 of gregorianStart. After Dec (month 12) we wrap into next year.
  const startMonthAbs = 8 + startOffset
  const endMonthAbs = 8 + endOffset
  const startYear = gregorianStart + Math.floor((startMonthAbs - 1) / 12)
  const startMonth = ((startMonthAbs - 1) % 12) + 1
  const endYear = gregorianStart + Math.floor((endMonthAbs - 1) / 12)
  const endMonth = ((endMonthAbs - 1) % 12) + 1

  return {
    start_date: toIso(startYear, startMonth, 1),
    end_date: toIso(endYear, endMonth, lastDayOfMonth(endYear, endMonth)),
  }
}
