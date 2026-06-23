/**
 * Student name rendered as a link to that student's detail page, opening in a
 * new tab (#210). Used everywhere a student name shows on the class grades page
 * — every tab (依學生 / 依科目 / 標準分) — so a teacher can always jump straight
 * to the individual transcript.
 */
export function StudentNameLink({
  id,
  name,
  className,
}: {
  id: string
  name: string | null
  className?: string
}) {
  return (
    <a
      href={`/students/${id}`}
      target="_blank"
      rel="noopener noreferrer"
      className={`hover:text-amber-700 hover:underline ${className ?? ''}`}
    >
      {name || <span className="text-slate-400">—</span>}
    </a>
  )
}
