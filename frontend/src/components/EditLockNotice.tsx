import type { ReactNode } from 'react'
import { useTranslation } from 'react-i18next'

import type { LockHolder, LockedItem } from '../lib/api'

/**
 * "Who is editing" display shared by the teacher grades page, the 小老師
 * page and the grade import modal (#264 B12).
 */
export function useLockHolderLabel() {
  const { t } = useTranslation()
  return (holder: LockHolder | null | undefined): string => {
    if (!holder || holder.holder_role === null) return t('edit_lock.holder_unknown')
    if (holder.holder_role === 'teacher') return t('edit_lock.holder_teacher')
    return holder.holder_name
      ? t('edit_lock.holder_assistant', { name: holder.holder_name })
      : t('edit_lock.holder_assistant_no_name')
  }
}

/** Small pill: "小明（小老師）編輯中". Fits in a column header. */
export function LockBadge({ holder }: { holder: LockHolder }) {
  const { t } = useTranslation()
  const who = useLockHolderLabel()(holder)
  const text = t('edit_lock.badge', { who })
  return (
    <span
      title={text}
      className="inline-flex max-w-full items-center gap-1 truncate rounded px-1 py-0.5 text-[10px] font-medium leading-none bg-violet-100 text-violet-800 ring-1 ring-violet-200"
    >
      <span aria-hidden>✎</span>
      <span className="truncate">{text}</span>
    </span>
  )
}

/** Banner above a score table for lock states (read-only, paused, lost). */
export function LockNotice({
  tone = 'info',
  children,
  action,
}: {
  tone?: 'info' | 'warn'
  children: ReactNode
  action?: ReactNode
}) {
  const cls =
    tone === 'warn'
      ? 'bg-rose-50 border-rose-200 text-rose-700'
      : 'bg-violet-50 border-violet-200 text-violet-800'
  return (
    <div
      role="status"
      className={`flex flex-wrap items-center justify-between gap-2 border rounded-lg px-3 py-2 text-sm ${cls}`}
    >
      <span>{children}</span>
      {action}
    </div>
  )
}

/** Lines for a blocked Excel import: "期中考：小明（小老師）正在編輯". */
export function LockedItemsList({ items }: { items: LockedItem[] }) {
  const { t } = useTranslation()
  const label = useLockHolderLabel()
  return (
    <ul className="mt-1 list-disc pl-5 space-y-0.5">
      {items.map((it) => (
        <li key={it.item_id}>
          {t('edit_lock.import_item_line', {
            item: it.item_name || t('edit_lock.unnamed_item'),
            who: label(it),
          })}
        </li>
      ))}
    </ul>
  )
}
