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
  // System rows (e.g. 達成標準) are pinned to the top, read-only, and not
  // draggable. We split the draft conceptually but keep it as one array so
  // the save payload stays simple — the backend re-prepends system rows on
  // PUT regardless of order.
  const systemRows = draft.filter((r) => r.system_key)
  const userRows = draft.filter((r) => !r.system_key)

  function onDragEnd(e: DragEndEvent) {
    const { active, over } = e
    if (!over || active.id === over.id) return
    const from = userRows.findIndex((r) => r.id === active.id)
    const to = userRows.findIndex((r) => r.id === over.id)
    if (from === -1 || to === -1) return
    const reordered = arrayMove(userRows, from, to)
    setDraft([...systemRows, ...reordered])
  }

  function updateRow(id: string, patch: Partial<PointReason>) {
    setDraft((d) =>
      d.map((r) =>
        r.id === id && !r.system_key ? { ...r, ...patch } : r,
      ),
    )
  }
  function removeRow(id: string) {
    setDraft((d) => d.filter((r) => r.id !== id || r.system_key))
  }
  function addRow() {
    setDraft((d) => [
      ...d,
      { id: newId(), name: '', default_points: 1 },
    ])
  }

  const dirty = JSON.stringify(draft) !== JSON.stringify(stored)
  const allValid = userRows.every(
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
            <tbody>
              {systemRows.map((r) => (
                <tr
                  key={r.id}
                  className="border-b border-slate-100 last:border-b-0 bg-slate-50/60"
                >
                  <td className="w-8 px-2 py-2" aria-hidden></td>
                  <td className="px-4 py-2">
                    <div className="flex items-center gap-2">
                      <span className="text-sm text-slate-900 font-medium">
                        {r.name}
                      </span>
                      <span className="inline-flex items-center px-2 py-0.5 rounded-full text-[10px] bg-slate-200 text-slate-700 font-medium">
                        {t('admin_reasons.system_badge')}
                      </span>
                    </div>
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
                  <td className="px-4 py-2 text-right text-xs text-slate-400">
                    —
                  </td>
                </tr>
              ))}
            </tbody>
            <DndContext
              sensors={sensors}
              collisionDetection={closestCenter}
              onDragEnd={onDragEnd}
            >
              <SortableContext
                items={userRows.map((r) => r.id)}
                strategy={verticalListSortingStrategy}
              >
                <tbody>
                  {userRows.map((r) => (
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

          <div className="border-t border-slate-100 px-5 py-3 flex flex-col sm:flex-row sm:items-start sm:justify-between gap-3">
            <div className="text-xs text-slate-500 space-y-1">
              <p>{t('admin_reasons.hint')}</p>
              {systemRows.length > 0 && (
                <p className="text-slate-400">
                  {t('admin_reasons.system_hint')}
                </p>
              )}
            </div>
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
