import { useEffect, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useParams } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
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
  useSortable,
  verticalListSortingStrategy,
} from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'

import { PageContainer } from '../layout/PageContainer'
import { PageHeader } from '../layout/PageHeader'
import { useStudents } from '../hooks/useStudents'
import {
  useCreateGroup,
  useDeleteGroup,
  useGroups,
  useReorderGroups,
  useUpdateGroup,
} from '../hooks/useGroups'
import {
  api,
  ApiError,
  GROUP_COLORS,
  type Group,
  type GroupColor,
  type Student,
} from '../lib/api'
import { classroomDisplayName } from '../lib/classroomFormat'

const PRIMARY_BTN =
  'inline-flex items-center px-4 py-2 rounded-lg bg-amber-500 hover:bg-amber-600 active:bg-amber-700 text-white text-sm font-medium shadow-sm transition-colors disabled:bg-slate-300 disabled:cursor-not-allowed'

const SECONDARY_BTN =
  'inline-flex items-center px-4 py-2 rounded-lg bg-white border border-slate-200 hover:border-slate-300 hover:bg-slate-50 text-slate-700 text-sm font-medium shadow-sm transition-colors disabled:opacity-60'

const DANGER_BTN =
  'inline-flex items-center px-4 py-2 rounded-lg bg-white border border-rose-200 hover:border-rose-300 hover:bg-rose-50 text-rose-600 text-sm font-medium transition-colors disabled:opacity-60'

// Tailwind can only see class names it finds as complete literals, so the
// palette must be a static map — never `bg-${color}-500`.
const COLOR_DOT: Record<GroupColor, string> = {
  amber: 'bg-amber-500',
  rose: 'bg-rose-500',
  sky: 'bg-sky-500',
  emerald: 'bg-emerald-500',
  violet: 'bg-violet-500',
  slate: 'bg-slate-500',
}

const COLOR_RING: Record<GroupColor, string> = {
  amber: 'ring-amber-500',
  rose: 'ring-rose-500',
  sky: 'ring-sky-500',
  emerald: 'ring-emerald-500',
  violet: 'ring-violet-500',
  slate: 'ring-slate-500',
}

interface Draft {
  name: string
  color: GroupColor | null
  memberIds: string[]
  leaderId: string | null
}

const NEW = '__new__'

function draftFromGroup(g: Group): Draft {
  return {
    name: g.name,
    color: g.color,
    memberIds: g.members.map((m) => m.student_id),
    leaderId: g.leader_student_id,
  }
}

function sameDraft(a: Draft, b: Draft) {
  return (
    a.name === b.name &&
    a.color === b.color &&
    a.leaderId === b.leaderId &&
    a.memberIds.length === b.memberIds.length &&
    a.memberIds.every((id, i) => id === b.memberIds[i])
  )
}

export function ClassGroups() {
  const { t, i18n } = useTranslation()
  const { classroomId } = useParams<{ classroomId: string }>()

  const classroomQ = useQuery({
    queryKey: ['classroom', classroomId],
    queryFn: () => api.classrooms.get(classroomId as string),
    enabled: !!classroomId,
  })
  const groupsQ = useGroups(classroomId)
  const studentsQ = useStudents(classroomId)

  const createMut = useCreateGroup(classroomId ?? '')
  const updateMut = useUpdateGroup(classroomId ?? '')
  const deleteMut = useDeleteGroup(classroomId ?? '')
  const orderMut = useReorderGroups(classroomId ?? '')

  // `NEW` = the unsaved new-group form; null = nothing selected.
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [draft, setDraft] = useState<Draft | null>(null)
  const [baseline, setBaseline] = useState<Draft | null>(null)
  const [errKey, setErrKey] = useState<string | null>(null)
  const [toast, setToast] = useState<string | null>(null)

  const groups = useMemo(() => groupsQ.data?.data ?? [], [groupsQ.data])
  const students = useMemo(
    () =>
      [...(studentsQ.data?.data ?? [])].sort(
        (a, b) => a.seat_number - b.seat_number,
      ),
    [studentsQ.data],
  )
  const studentById = useMemo(() => {
    const m = new Map<string, Student>()
    students.forEach((s) => m.set(s.id, s))
    return m
  }, [students])

  const dirty = !!draft && !!baseline && !sameDraft(draft, baseline)

  useEffect(() => {
    if (!toast) return
    const id = setTimeout(() => setToast(null), 2500)
    return () => clearTimeout(id)
  }, [toast])

  // If the selected group disappears (deleted elsewhere), drop the editor.
  useEffect(() => {
    if (selectedId && selectedId !== NEW && !groups.some((g) => g.id === selectedId)) {
      setSelectedId(null)
      setDraft(null)
      setBaseline(null)
    }
  }, [groups, selectedId])

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 4 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  )

  if (!classroomId) return null

  const classroom = classroomQ.data
  const title = classroom
    ? `${classroomDisplayName(classroom.grade, classroom.name, i18n.language)} · ${t('groups.title')}`
    : t('groups.title')

  function confirmDiscard() {
    if (!dirty) return true
    return window.confirm(t('groups.confirm_discard'))
  }

  function select(g: Group) {
    if (!confirmDiscard()) return
    setErrKey(null)
    setSelectedId(g.id)
    const d = draftFromGroup(g)
    setDraft(d)
    setBaseline(d)
  }

  function startNew() {
    if (!confirmDiscard()) return
    setErrKey(null)
    setSelectedId(NEW)
    const d: Draft = {
      name: t('groups.default_name', { n: groups.length + 1 }),
      color: GROUP_COLORS[groups.length % GROUP_COLORS.length],
      memberIds: [],
      leaderId: null,
    }
    setDraft(d)
    // Baseline differs from the draft so a brand-new group is dirty from the
    // start — otherwise "save" would look like a no-op.
    setBaseline({ name: '', color: null, memberIds: [], leaderId: null })
  }

  function onGroupDragEnd(e: DragEndEvent) {
    const { active, over } = e
    if (!over || active.id === over.id) return
    const from = groups.findIndex((g) => g.id === active.id)
    const to = groups.findIndex((g) => g.id === over.id)
    if (from < 0 || to < 0) return
    orderMut.mutate(arrayMove(groups, from, to).map((g) => g.id))
  }

  function onMemberDragEnd(e: DragEndEvent) {
    const { active, over } = e
    if (!over || active.id === over.id || !draft) return
    const from = draft.memberIds.indexOf(String(active.id))
    const to = draft.memberIds.indexOf(String(over.id))
    if (from < 0 || to < 0) return
    setDraft({ ...draft, memberIds: arrayMove(draft.memberIds, from, to) })
  }

  function toggleMember(studentId: string) {
    if (!draft) return
    const has = draft.memberIds.includes(studentId)
    const memberIds = has
      ? draft.memberIds.filter((id) => id !== studentId)
      : [...draft.memberIds, studentId]
    // A leader who is no longer a member cannot stay leader (the API rejects it).
    const leaderId =
      has && draft.leaderId === studentId ? null : draft.leaderId
    setDraft({ ...draft, memberIds, leaderId })
  }

  function toggleLeader(studentId: string) {
    if (!draft || !draft.memberIds.includes(studentId)) return
    setDraft({
      ...draft,
      leaderId: draft.leaderId === studentId ? null : studentId,
    })
  }

  async function onSave() {
    if (!draft) return
    setErrKey(null)
    const body = {
      name: draft.name.trim(),
      color: draft.color,
      member_student_ids: draft.memberIds,
      leader_student_id: draft.leaderId,
    }
    if (!body.name) {
      setErrKey('groups.errors.name_required')
      return
    }
    try {
      if (selectedId === NEW) {
        const created = await createMut.mutateAsync(body)
        setSelectedId(created.id)
        const d = draftFromGroup(created)
        setDraft(d)
        setBaseline(d)
      } else {
        const saved = await updateMut.mutateAsync({
          id: selectedId as string,
          body,
        })
        const d = draftFromGroup(saved)
        setDraft(d)
        setBaseline(d)
      }
      setToast(t('groups.saved'))
    } catch (err) {
      if (err instanceof ApiError && err.status === 409) {
        setErrKey('groups.errors.duplicate_name')
      } else {
        setErrKey('common.error_generic')
      }
    }
  }

  async function onDelete() {
    if (selectedId === NEW) {
      setSelectedId(null)
      setDraft(null)
      setBaseline(null)
      return
    }
    const g = groups.find((x) => x.id === selectedId)
    if (!g) return
    if (!window.confirm(t('groups.confirm_delete', { name: g.name }))) return
    await deleteMut.mutateAsync(g.id)
    setSelectedId(null)
    setDraft(null)
    setBaseline(null)
    setToast(t('groups.deleted'))
  }

  const saving = createMut.isPending || updateMut.isPending
  const loading = groupsQ.isLoading || studentsQ.isLoading
  const failed = groupsQ.isError || studentsQ.isError

  return (
    <PageContainer>
      <PageHeader title={title} subtitle={t('groups.subtitle')} />

      {loading && (
        <div className="space-y-3" aria-busy="true">
          <div className="h-10 bg-slate-100 rounded-lg animate-pulse" />
          <div className="h-40 bg-slate-100 rounded-xl animate-pulse" />
        </div>
      )}

      {failed && (
        <div className="bg-white border border-rose-200 rounded-xl p-6 text-center">
          <p className="text-sm text-rose-600 mb-4">{t('common.error_generic')}</p>
          <button
            className={SECONDARY_BTN}
            onClick={() => {
              groupsQ.refetch()
              studentsQ.refetch()
            }}
          >
            {t('common.retry')}
          </button>
        </div>
      )}

      {!loading && !failed && (
        <div className="grid grid-cols-1 lg:grid-cols-[280px_1fr] gap-6 items-start">
          {/* ---------- group list ---------- */}
          <section className="bg-white border border-slate-200 rounded-xl p-5 shadow-sm">
            <h2 className="text-sm font-semibold text-slate-500 uppercase tracking-wide mb-3">
              {t('groups.list_heading')}
            </h2>

            {groups.length === 0 ? (
              <p className="text-sm text-slate-500 mb-4">{t('groups.empty')}</p>
            ) : (
              <DndContext
                sensors={sensors}
                collisionDetection={closestCenter}
                onDragEnd={onGroupDragEnd}
              >
                <SortableContext
                  items={groups.map((g) => g.id)}
                  strategy={verticalListSortingStrategy}
                >
                  <ul className="mb-4 space-y-1">
                    {groups.map((g) => (
                      <SortableGroupRow
                        key={g.id}
                        group={g}
                        active={g.id === selectedId}
                        handleTitle={t('groups.drag_to_reorder')}
                        onSelect={() => select(g)}
                      />
                    ))}
                  </ul>
                </SortableContext>
              </DndContext>
            )}

            <button className={SECONDARY_BTN} onClick={startNew}>
              {t('groups.add')}
            </button>
          </section>

          {/* ---------- editor ---------- */}
          <section className="bg-white border border-slate-200 rounded-xl p-5 lg:p-6 shadow-sm">
            {!draft ? (
              <p className="text-sm text-slate-500 py-8 text-center">
                {groups.length === 0
                  ? t('groups.empty_hint')
                  : t('groups.select_hint')}
              </p>
            ) : (
              <div className="space-y-6">
                <div>
                  <label
                    htmlFor="group-name"
                    className="block text-sm font-medium text-slate-700 mb-1.5"
                  >
                    {t('groups.field_name')}
                  </label>
                  <input
                    id="group-name"
                    value={draft.name}
                    maxLength={100}
                    onChange={(e) =>
                      setDraft({ ...draft, name: e.target.value })
                    }
                    className="w-full max-w-xs px-3 py-2 rounded-lg border border-slate-300 focus:outline-none focus:ring-2 focus:ring-amber-500 focus:border-amber-500"
                  />
                </div>

                <div>
                  <span className="block text-sm font-medium text-slate-700 mb-1.5">
                    {t('groups.field_color')}
                  </span>
                  <div className="flex flex-wrap gap-2">
                    {GROUP_COLORS.map((c) => (
                      <button
                        key={c}
                        type="button"
                        aria-pressed={draft.color === c}
                        aria-label={t(`groups.color.${c}`)}
                        title={t(`groups.color.${c}`)}
                        onClick={() => setDraft({ ...draft, color: c })}
                        className={`h-11 w-11 rounded-full ${COLOR_DOT[c]} transition-shadow focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-slate-400 ${
                          draft.color === c
                            ? `ring-2 ring-offset-2 ${COLOR_RING[c]}`
                            : ''
                        }`}
                      />
                    ))}
                  </div>
                </div>

                <div>
                  <h3 className="font-semibold text-slate-900 tracking-tight mb-1">
                    {t('groups.members_heading', {
                      count: draft.memberIds.length,
                      total: students.length,
                    })}
                  </h3>
                  <p className="text-sm text-slate-500 mb-3">
                    {t('groups.members_hint')}
                  </p>

                  {students.length === 0 ? (
                    <p className="text-sm text-slate-500">
                      {t('groups.no_students')}
                    </p>
                  ) : (
                    <>
                      {/* selected — ordered + draggable */}
                      <DndContext
                        sensors={sensors}
                        collisionDetection={closestCenter}
                        onDragEnd={onMemberDragEnd}
                      >
                        <SortableContext
                          items={draft.memberIds}
                          strategy={verticalListSortingStrategy}
                        >
                          <ul className="space-y-1 mb-3">
                            {draft.memberIds.map((id, index) => {
                              const s = studentById.get(id)
                              if (!s) return null
                              return (
                                <SortableMemberRow
                                  key={id}
                                  id={id}
                                  index={index}
                                  student={s}
                                  isLeader={draft.leaderId === id}
                                  handleTitle={t('groups.drag_to_reorder')}
                                  leaderLabel={t('groups.set_leader', {
                                    name: s.name ?? String(s.seat_number),
                                  })}
                                  onToggle={() => toggleMember(id)}
                                  onToggleLeader={() => toggleLeader(id)}
                                />
                              )
                            })}
                          </ul>
                        </SortableContext>
                      </DndContext>

                      {/* not in this group */}
                      <ul className="space-y-1 border-t border-slate-100 pt-3">
                        {students
                          .filter((s) => !draft.memberIds.includes(s.id))
                          .map((s) => (
                            <li key={s.id}>
                              <label className="flex items-center gap-3 px-2 py-2 rounded-lg hover:bg-slate-50 cursor-pointer min-h-[44px]">
                                <span className="w-6" aria-hidden="true" />
                                <input
                                  type="checkbox"
                                  checked={false}
                                  onChange={() => toggleMember(s.id)}
                                  className="h-4 w-4 rounded border-slate-300 text-amber-500 focus:ring-amber-500"
                                />
                                <span className="text-sm text-slate-500 tabular-nums w-8">
                                  {String(s.seat_number).padStart(2, '0')}
                                </span>
                                <span className="text-sm text-slate-500 truncate">
                                  {s.name || '—'}
                                </span>
                              </label>
                            </li>
                          ))}
                      </ul>
                    </>
                  )}
                </div>

                {errKey && (
                  <p role="alert" className="text-sm text-rose-600">
                    {t(errKey)}
                  </p>
                )}

                <div className="flex flex-wrap gap-3 border-t border-slate-100 pt-4">
                  <button
                    className={PRIMARY_BTN}
                    onClick={onSave}
                    disabled={saving || !dirty}
                  >
                    {saving ? t('common.saving') : t('common.save')}
                  </button>
                  <button
                    className={DANGER_BTN}
                    onClick={onDelete}
                    disabled={deleteMut.isPending}
                  >
                    {selectedId === NEW
                      ? t('common.cancel')
                      : t('groups.delete')}
                  </button>
                </div>
              </div>
            )}
          </section>
        </div>
      )}

      {toast && (
        <div className="fixed bottom-6 right-6 bg-slate-900 text-white text-sm px-4 py-2.5 rounded-lg shadow-lg z-50">
          {toast}
        </div>
      )}
    </PageContainer>
  )
}

// ---------- sortable rows ----------

function SortableGroupRow({
  group,
  active,
  handleTitle,
  onSelect,
}: {
  group: Group
  active: boolean
  handleTitle: string
  onSelect: () => void
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } =
    useSortable({ id: group.id })
  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.5 : 1,
  }
  return (
    <li ref={setNodeRef} style={style} className="flex items-center gap-1">
      <span
        {...attributes}
        {...listeners}
        title={handleTitle}
        className="px-1 py-2 text-slate-300 select-none cursor-grab active:cursor-grabbing"
      >
        ⋮⋮
      </span>
      <button
        onClick={onSelect}
        aria-current={active ? 'true' : undefined}
        className={`flex-1 flex items-center gap-2 min-h-[44px] px-2 rounded-lg text-left text-sm transition-colors ${
          active
            ? 'bg-amber-50 text-amber-900 font-medium'
            : 'text-slate-700 hover:bg-slate-50'
        }`}
      >
        <span
          className={`h-2.5 w-2.5 rounded-full shrink-0 ${
            group.color ? COLOR_DOT[group.color] : 'bg-slate-200'
          }`}
          aria-hidden="true"
        />
        <span className="truncate">{group.name}</span>
        <span className="ml-auto text-xs text-slate-400 tabular-nums">
          {group.members.length}
        </span>
      </button>
    </li>
  )
}

function SortableMemberRow({
  id,
  index,
  student,
  isLeader,
  handleTitle,
  leaderLabel,
  onToggle,
  onToggleLeader,
}: {
  id: string
  index: number
  student: Student
  isLeader: boolean
  handleTitle: string
  leaderLabel: string
  onToggle: () => void
  onToggleLeader: () => void
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } =
    useSortable({ id })
  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.5 : 1,
  }
  return (
    <li
      ref={setNodeRef}
      style={style}
      className="flex items-center gap-3 px-2 py-2 rounded-lg bg-slate-50 min-h-[44px]"
    >
      <span
        {...attributes}
        {...listeners}
        title={handleTitle}
        className="w-6 text-slate-400 select-none cursor-grab active:cursor-grabbing text-center"
      >
        ⋮⋮
      </span>
      <input
        type="checkbox"
        checked
        onChange={onToggle}
        className="h-4 w-4 rounded border-slate-300 text-amber-500 focus:ring-amber-500"
      />
      <span className="text-xs text-slate-400 tabular-nums w-5">
        {index + 1}
      </span>
      <span className="text-sm text-slate-500 tabular-nums w-8">
        {String(student.seat_number).padStart(2, '0')}
      </span>
      <span className="text-sm text-slate-900 truncate">
        {student.name || '—'}
      </span>
      <button
        type="button"
        onClick={onToggleLeader}
        aria-pressed={isLeader}
        aria-label={leaderLabel}
        title={leaderLabel}
        className={`ml-auto h-8 w-8 rounded-full text-base leading-none transition-colors focus:outline-none focus:ring-2 focus:ring-amber-500 ${
          isLeader
            ? 'text-amber-500'
            : 'text-slate-300 hover:text-slate-400'
        }`}
      >
        {isLeader ? '★' : '☆'}
      </button>
    </li>
  )
}
