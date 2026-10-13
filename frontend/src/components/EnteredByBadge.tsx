import { useEffect, useId, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'

import type { EnteredByRole } from '../lib/api'

/** The "entered by" stamp fields every grade payload carries (#260). */
export interface EnteredByStamp {
  entered_by_role?: EnteredByRole | null
  entered_by_name?: string | null
  updated_at?: string | null
}

function pad2(n: number) {
  return n < 10 ? `0${n}` : String(n)
}

/** MM/DD HH:mm in the viewer's local time. */
function formatStampTime(iso: string | null | undefined) {
  if (!iso) return ''
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return ''
  return `${pad2(d.getMonth() + 1)}/${pad2(d.getDate())} ${pad2(d.getHours())}:${pad2(d.getMinutes())}`
}

/**
 * Tiny corner badge on a score cell marking a score entered by a student
 * assistant (小老師, #260 / #262). Teacher-entered scores render nothing, so
 * callers can drop it in unconditionally.
 *
 * Absolutely positioned — the parent cell must be `relative`. It takes no
 * layout space. Hover shows the native tooltip; tap / click (touch has no
 * hover) toggles a small fixed-position popover with the same text.
 */
export function EnteredByBadge({ stamp }: { stamp: EnteredByStamp | undefined }) {
  const { t } = useTranslation()
  const btnRef = useRef<HTMLButtonElement>(null)
  const tipRef = useRef<HTMLSpanElement>(null)
  const tipId = useId()
  const [pos, setPos] = useState<{ top: number; right: number } | null>(null)

  useEffect(() => {
    if (!pos) return
    const close = () => setPos(null)
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') close()
    }
    // Safari doesn't focus a button on click, so onBlur alone never fires
    // there — close on any pointer press outside the badge and its popover.
    const onPointerDown = (e: PointerEvent) => {
      const target = e.target as Node | null
      if (!target) return
      if (btnRef.current?.contains(target) || tipRef.current?.contains(target)) return
      close()
    }
    window.addEventListener('scroll', close, true)
    window.addEventListener('resize', close)
    document.addEventListener('keydown', onKeyDown)
    document.addEventListener('pointerdown', onPointerDown)
    return () => {
      window.removeEventListener('scroll', close, true)
      window.removeEventListener('resize', close)
      document.removeEventListener('keydown', onKeyDown)
      document.removeEventListener('pointerdown', onPointerDown)
    }
  }, [pos])

  if (!stamp || stamp.entered_by_role !== 'assistant') return null

  const time = formatStampTime(stamp.updated_at)
  const label = stamp.entered_by_name
    ? t('grade_entry.entered_by.assistant_tooltip', {
        name: stamp.entered_by_name,
        time,
      })
    : t('grade_entry.entered_by.assistant_tooltip_no_name', { time })

  function toggle() {
    if (pos) {
      setPos(null)
      return
    }
    const r = btnRef.current?.getBoundingClientRect()
    if (!r) return
    setPos({ top: r.bottom + 4, right: window.innerWidth - r.right })
  }

  return (
    <>
      <button
        ref={btnRef}
        type="button"
        onClick={toggle}
        onBlur={() => setPos(null)}
        title={label}
        aria-label={label}
        aria-describedby={pos ? tipId : undefined}
        aria-expanded={pos !== null}
        className="absolute top-0.5 right-0.5 rounded px-0.5 text-[9px] font-semibold leading-none bg-amber-100 text-amber-800 ring-1 ring-amber-300 focus:outline-none focus:ring-2 focus:ring-amber-500"
      >
        {t('grade_entry.entered_by.badge')}
      </button>
      {pos && (
        <span
          ref={tipRef}
          id={tipId}
          role="tooltip"
          style={{ top: pos.top, right: pos.right }}
          className="fixed z-50 whitespace-nowrap rounded-lg bg-slate-900 px-2 py-1 text-xs text-white shadow-lg"
        >
          {label}
        </span>
      )}
    </>
  )
}
