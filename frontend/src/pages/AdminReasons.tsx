import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import {
  closestCenter,
  DndContext,
  KeyboardSensor,
  PointerSensor,
  useSensor,
  useSensors,
  type DragEndEvent,
} from '@dnd-kit/core'
import {
  arrayMove,
  SortableContext,
  sortableKeyboardCoordinates,
  verticalListSortingStrategy,
} from '@dnd-kit/sortable'

import { SignedNumberInput } from '../components/SignedNumberInput'
import { SortableTableRow } from '../components/SortableTableRow'
import { useMe } from '../hooks/useMe'
import { PageContainer } from '../layout/PageContainer'
import { PageHeader } from '../layout/PageHeader'
import { api, type PointReason } from '../lib/api'

const PRIMARY_BTN =
  'inline-flex items-center px-4 py-2 rounded-lg bg-amber-500 hover:bg-amber-600 active:bg-amber-700 text-white text-sm font-medium shadow-sm transition-colors disabled:bg-slate-300 disabled:cursor-not-allowed'

const SECONDARY_BTN =
  'inline-flex items-center px-4 py-2 rounded-lg bg-white border border-slate-200 hover:border-slate-300 hover:bg-slate-50 text-slate-700 text-sm font-medium shadow-sm transition-colors disabled:opacity-60'

function newId() {
  if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) {
    return crypto.randomUUID()
  }
  return `tmp_${Math.random().toString(36).slice(2)}`
}

export function AdminReasons() {
  const { t } = useTranslation()
  const qc = useQueryClient()
  const meQ = useMe()
  const stored = meQ.data?.point_reasons ?? []

  // Working draft of the reasons list — diffs against `stored` decide
  // whether the "全部儲存" button lights up. Saving sends the whole array.
  const [draft, setDraft] = useState<PointReason[]>([])
  useEffect(() => {
    setDraft(stored)
  }, [meQ.data])

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 4 } }),
    useSensor(KeyboardSensor, {
      coordinateGetter: sortableKeyboardCoordinates,
    }),
  )
  function onDragEnd(e: DragEndEvent) {
    const { active, over } = e
    if (!over || active.id === over.id) return
    const from = draft.findIndex((r) => r.id === active.id)
    const to = draft.findIndex((r) => r.id === over.id)
    if (from === -1 || to === -1) return
    setDraft(arrayMove(draft, from, to))
  }

  function updateRow(id: string, patch: Partial<PointReason>) {
    setDraft((d) =>
      d.map((r) => (r.id === id ? { ...r, ...patch } : r)),
    )
  }
  function removeRow(id: string) {
    setDraft((d) => d.filter((r) => r.id !== id))
  }
  function addRow() {
    setDraft((d) => [
      ...d,
      { id: newId(), name: '', default_points: 1 },
    ])
  }

  const dirty = JSON.stringify(draft) !== JSON.stringify(stored)
  const allValid = draft.every(
    (r) => r.name.trim().length > 0 && r.name.trim().length <= 50,
  )

  const saveMut = useMutation({
    mutationFn: () => api.me.updatePointReasons(draft),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['me'] }),
  })

  return (
    <PageContainer>
      <PageHeader
        title={t('admin_reasons.title')}
        subtitle={t('admin_reasons.subtitle')}
        actions={
          <button onClick={addRow} className={PRIMARY_BTN}>
            {t('admin_reasons.add')}
          </button>
        }
      />

      {meQ.isLoading && (
        <div className="text-center text-slate-400 py-12">
          {t('common.loading')}
        </div>
      )}

      {!meQ.isLoading && draft.length === 0 && (
        <div className="bg-white border border-slate-200 rounded-xl p-8 text-center text-sm text-slate-500">
          {t('admin_reasons.empty')}
        </div>
      )}

      {!meQ.isLoading && draft.length > 0 && (
        <section className="bg-white border border-slate-200 rounded-xl shadow-sm overflow-hidden">
          <table className="min-w-full text-sm">
            <thead className="bg-slate-50 border-b border-slate-200 text-slate-600">
              <tr>
                <th className="w-8 px-2 py-3" aria-hidden></th>
                <th className="px-4 py-3 text-left font-medium">
                  {t('admin_reasons.col.name')}
                </th>
                <th className="px-4 py-3 text-left font-medium w-40">
                  {t('admin_reasons.col.default_points')}
                </th>
                <th className="px-4 py-3 text-right font-medium w-24">
                  {t('admin_reasons.col.actions')}
                </th>
              </tr>
            </thead>
            <DndContext
              sensors={sensors}
              collisionDetection={closestCenter}
              onDragEnd={onDragEnd}
            >
              <SortableContext
                items={draft.map((r) => r.id)}
                strategy={verticalListSortingStrategy}
              >
                <tbody>
                  {draft.map((r) => (
                    <SortableTableRow
                      key={r.id}
                      id={r.id}
                      handleTitle={t('admin_reasons.drag_to_reorder')}
                    >
                      <td className="px-4 py-2">
                        <input
                          value={r.name}
                          onChange={(e) =>
                            updateRow(r.id, { name: e.target.value })
                          }
                          maxLength={50}
                          placeholder={t('admin_reasons.name_placeholder')}
                          className="w-full border border-slate-300 rounded-md px-2 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-amber-500"
                        />
                      </td>
                      <td className="px-4 py-2">
                        <SignedNumberInput
                          value={r.default_points}
                          onChange={(n) =>
                            updateRow(r.id, { default_points: n })
                          }
                          className="w-24 border border-slate-300 rounded-md px-2 py-1.5 text-sm text-right tabular-nums focus:outline-none focus:ring-2 focus:ring-amber-500"
                        />
                      </td>
                      <td className="px-4 py-2 text-right">
                        <button
                          onClick={() => removeRow(r.id)}
                          className="text-rose-600 hover:text-rose-800 font-medium text-sm"
                        >
                          {t('common.delete')}
                        </button>
                      </td>
                    </SortableTableRow>
                  ))}
                </tbody>
              </SortableContext>
            </DndContext>
          </table>

          <div className="border-t border-slate-100 px-5 py-3 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
            <p className="text-xs text-slate-500">
              {t('admin_reasons.hint')}
            </p>
            <div className="flex items-center gap-2">
              <button
                onClick={() => setDraft(stored)}
                disabled={!dirty || saveMut.isPending}
                className={SECONDARY_BTN}
              >
                {t('common.reset')}
              </button>
              <button
                onClick={() => saveMut.mutate()}
                disabled={!dirty || !allValid || saveMut.isPending}
                className={PRIMARY_BTN}
                title={!allValid ? t('admin_reasons.invalid_hint') : undefined}
              >
                {saveMut.isPending
                  ? t('common.saving')
                  : t('common.save')}
              </button>
            </div>
          </div>
        </section>
      )}
    </PageContainer>
  )
}
