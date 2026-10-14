import { useTranslation } from 'react-i18next'

import type { ItemAssistantsView } from '../lib/api'
import { classroomDisplayName } from '../lib/classroomFormat'

/**
 * "開放登記的小老師" multi-select inside the item edit window (#262).
 * Lists the 小老師 of all the teacher's classes, grouped by class. A class
 * where the item isn't active yet (or is archived) can't be picked — the
 * assistant would have nothing to enter there.
 */
export function ItemAssistantsPicker({
  view,
  selected,
  onChange,
}: {
  view: ItemAssistantsView
  selected: Set<string>
  onChange: (next: Set<string>) => void
}) {
  const { t, i18n } = useTranslation()

  if (view.candidates.length === 0) {
    return (
      <p className="text-sm text-slate-500">{t('assistant_admin.picker_empty')}</p>
    )
  }

  const groups = new Map<string, typeof view.candidates>()
  for (const c of view.candidates) {
    const list = groups.get(c.classroom_id) ?? []
    list.push(c)
    groups.set(c.classroom_id, list)
  }

  function toggle(id: string, checked: boolean) {
    const next = new Set(selected)
    if (checked) next.add(id)
    else next.delete(id)
    onChange(next)
  }

  return (
    <div className="space-y-3 max-h-64 overflow-y-auto border border-slate-200 rounded-lg p-3">
      {!view.writable && (
        <p className="text-xs text-amber-700">{t('assistant_admin.picker_archived')}</p>
      )}
      {[...groups.values()].map((list) => {
        const first = list[0]
        const active = first.item_active
        return (
          <fieldset key={first.classroom_id}>
            <legend className="text-xs font-semibold text-slate-500 uppercase tracking-wide">
              {classroomDisplayName(first.classroom_grade, first.classroom_name, i18n.language)}
            </legend>
            {!active && (
              <p className="text-xs text-slate-400 mt-0.5">
                {t('assistant_admin.picker_inactive')}
              </p>
            )}
            <div className="mt-1 flex flex-wrap gap-x-4">
              {list.map((c) => {
                const disabled =
                  !view.writable || (!active && !selected.has(c.student_id))
                return (
                  <label
                    key={c.student_id}
                    className={`flex items-center gap-2 min-h-[44px] text-sm ${
                      disabled ? 'text-slate-400 cursor-not-allowed' : 'text-slate-700 cursor-pointer'
                    }`}
                  >
                    <input
                      type="checkbox"
                      checked={selected.has(c.student_id)}
                      disabled={disabled}
                      onChange={(e) => toggle(c.student_id, e.target.checked)}
                      className="h-4 w-4 rounded border-slate-300 text-amber-500 focus:ring-amber-500"
                    />
                    {t('assistant_admin.picker_student', {
                      seat: c.seat_number,
                      name: c.name || t('students.no_name'),
                    })}
                  </label>
                )
              })}
            </div>
          </fieldset>
        )
      })}
    </div>
  )
}
