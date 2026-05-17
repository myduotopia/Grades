import { useEffect, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'

/**
 * Search-and-pick combobox for the new-item modal's name field.
 *
 * Existing item names (for the currently-selected subject + category, across
 * every classroom the teacher owns) are surfaced as a dropdown so the
 * teacher can pick the SAME name they already used in another class.
 * Picking an existing name keeps the backend's grouping consistent and
 * makes cross-class analysis easier. Only if no existing name matches do
 * they fall through to creating a fresh one.
 */
export function ItemNameCombobox({
  value,
  onChange,
  suggestions,
  placeholder,
  maxLength = 200,
  inputId,
}: {
  value: string
  onChange: (v: string) => void
  suggestions: string[]
  placeholder?: string
  maxLength?: number
  inputId?: string
}) {
  const { t } = useTranslation()
  const [open, setOpen] = useState(false)
  const wrapperRef = useRef<HTMLDivElement>(null)

  // Click outside closes the panel.
  useEffect(() => {
    if (!open) return
    function onDocDown(e: MouseEvent) {
      if (wrapperRef.current && !wrapperRef.current.contains(e.target as Node)) {
        setOpen(false)
      }
    }
    document.addEventListener('mousedown', onDocDown)
    return () => document.removeEventListener('mousedown', onDocDown)
  }, [open])

  const lowered = value.trim().toLowerCase()
  const filtered = useMemo(() => {
    if (!lowered) return suggestions
    return suggestions.filter((s) => s.toLowerCase().includes(lowered))
  }, [suggestions, lowered])

  const exactMatch = suggestions.some(
    (s) => s.trim().toLowerCase() === lowered,
  )

  return (
    <div ref={wrapperRef} className="relative">
      <input
        id={inputId}
        value={value}
        onChange={(e) => {
          onChange(e.target.value)
          setOpen(true)
        }}
        onFocus={() => setOpen(true)}
        maxLength={maxLength}
        placeholder={placeholder}
        autoComplete="off"
        className="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-amber-500"
      />

      {open && (
        <div className="absolute z-50 left-0 right-0 mt-1 bg-white border border-slate-200 rounded-lg shadow-lg max-h-60 overflow-y-auto">
          {suggestions.length === 0 && (
            <div className="px-3 py-2 text-xs text-slate-400">
              {t('item_name_combobox.no_existing')}
            </div>
          )}

          {suggestions.length > 0 && filtered.length === 0 && (
            <div className="px-3 py-2 text-xs text-slate-400">
              {t('item_name_combobox.no_match')}
            </div>
          )}

          {filtered.length > 0 && (
            <>
              <div className="px-3 pt-2 pb-1 text-[10px] uppercase tracking-wider text-slate-400">
                {t('item_name_combobox.existing_header', {
                  count: filtered.length,
                })}
              </div>
              <ul>
                {filtered.map((s) => (
                  <li key={s}>
                    <button
                      type="button"
                      onClick={() => {
                        onChange(s)
                        setOpen(false)
                      }}
                      className="w-full text-left px-3 py-1.5 text-sm hover:bg-amber-50 text-slate-800"
                    >
                      {s}
                    </button>
                  </li>
                ))}
              </ul>
            </>
          )}

          {value.trim() !== '' && !exactMatch && (
            <div className="border-t border-slate-100 px-3 py-2 text-xs text-amber-700 bg-amber-50/60">
              {t('item_name_combobox.will_create', { name: value.trim() })}
            </div>
          )}
        </div>
      )}
    </div>
  )
}
