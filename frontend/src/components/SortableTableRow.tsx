import type { ReactNode } from 'react'
import { useSortable } from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'

/**
 * One sortable `<tr>` driven by dnd-kit. Wrap the table in a `<DndContext>`
 * + `<SortableContext items={ids}>` (one for each draggable id) and render
 * each draggable row with this component.
 *
 * The component renders a leading `<td>` for the drag handle so callers
 * don't have to wire `attributes`/`listeners` themselves. Children should
 * be the remaining `<td>` cells.
 *
 * If `disabled` is true the row renders as a normal `<tr>` (no handle, no
 * transform, no drag). Use this for pinned rows interleaved with sortable
 * ones (e.g. fixed academic subjects on top of teacher-orderable extras).
 */
export function SortableTableRow({
  id,
  children,
  disabled = false,
  handleTitle,
  className = '',
}: {
  id: string
  children: ReactNode
  disabled?: boolean
  handleTitle?: string
  className?: string
}) {
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id, disabled })

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.5 : 1,
    // While dragging, lift this row above the rest so its translate is on
    // top of the sliding siblings.
    position: isDragging ? ('relative' as const) : undefined,
    zIndex: isDragging ? 10 : undefined,
  }

  return (
    <tr
      ref={setNodeRef}
      style={style}
      className={`border-b border-slate-100 last:border-b-0 ${className}`}
    >
      <td
        className={`px-2 py-2.5 w-8 text-slate-300 text-center select-none ${
          disabled ? '' : 'cursor-grab active:cursor-grabbing'
        }`}
        aria-hidden={disabled}
        title={disabled ? undefined : handleTitle}
        {...(disabled ? {} : { ...attributes, ...listeners })}
      >
        {disabled ? '' : '⋮⋮'}
      </td>
      {children}
    </tr>
  )
}
