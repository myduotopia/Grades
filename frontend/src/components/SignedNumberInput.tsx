import { useEffect, useState } from 'react'

/**
 * Integer input that lets the user type a leading "-" without losing it.
 *
 * Why this exists: a vanilla `<input type="number">` with `value={number}`
 * + `onChange={Number(e.target.value)}` silently discards a typed "-"
 * because `Number("-")` is `NaN` — the parent's onChange handler returns
 * early and the controlled value stays at the previous integer, so the
 * user never sees the minus they typed.
 *
 * This component owns a string draft while typing, validates against
 * `^-?\d*$`, and only reports a parsed number back through `onChange`
 * when the draft is a valid integer. On blur it normalises (empty / "-"
 * → 0) and clamps to [min, max].
 */
export function SignedNumberInput({
  value,
  onChange,
  min = -100,
  max = 100,
  className,
  ariaLabel,
}: {
  value: number
  onChange: (v: number) => void
  min?: number
  max?: number
  className?: string
  ariaLabel?: string
}) {
  const [text, setText] = useState<string>(String(value))

  // Keep local draft in sync if the controlled value changes externally
  // (e.g., parent reset, preset chip click).
  useEffect(() => {
    setText(String(value))
  }, [value])

  function commit() {
    const n = Number(text)
    const safe = Number.isFinite(n)
      ? Math.max(min, Math.min(max, Math.trunc(n)))
      : 0
    if (safe !== value) onChange(safe)
    setText(String(safe))
  }

  return (
    <input
      type="text"
      inputMode="numeric"
      autoComplete="off"
      aria-label={ariaLabel}
      value={text}
      onChange={(e) => {
        const raw = e.target.value
        if (!/^-?\d*$/.test(raw)) return
        setText(raw)
        const n = Number(raw)
        if (Number.isFinite(n) && raw !== '' && raw !== '-') {
          const safe = Math.max(min, Math.min(max, Math.trunc(n)))
          if (safe !== value) onChange(safe)
        }
      }}
      onBlur={commit}
      onKeyDown={(e) => {
        if (e.key === 'Enter') {
          e.currentTarget.blur()
        }
      }}
      className={className}
    />
  )
}
