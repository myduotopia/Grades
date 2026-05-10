/**
 * Display helpers for the (grade, name) pair on a classroom.
 *
 * Layout examples:
 *   zh-TW: "六年甲班"  ({grade in Chinese numeral}年{name}班)
 *   en:    "Grade 6 · 甲"
 */

const ZH_DIGITS = ['', '一', '二', '三', '四', '五', '六', '七', '八', '九', '十', '十一', '十二']

export function gradeLabel(grade: number, lang: string): string {
  if (lang === 'zh-TW') return `${ZH_DIGITS[grade] ?? grade}年級`
  return `Grade ${grade}`
}

export function classroomDisplayName(
  grade: number,
  name: string,
  lang: string,
): string {
  if (lang === 'zh-TW') return `${ZH_DIGITS[grade] ?? grade}年${name}班`
  return `Grade ${grade} · ${name}`
}
