import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
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
  type GroupPayload,
  type Student,
} from '../lib/api'
import { classroomDisplayName } from '../lib/classroomFormat'

const SECONDARY_BTN =
  'inline-flex items-center px-4 py-2 rounded-lg bg-white border border-slate-200 hover:border-slate-300 hover:bg-slate-50 text-slate-700 text-sm font-medium shadow-sm transition-colors disabled:opacity-60'

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

type SaveState = 'idle' | 'saving' | 'saved' | 'failed'

function draftFromGroup(g: Group): Draft {
  return {
    name: g.name,
    color: g.color,
    memberIds: g.members.map((m) => m.student_id),
    leaderId: g.leader_student_id,
  }
}

function toPayload(d: Draft): GroupPayload {
  return {
    name: d.name.trim(),
    color: d.color,
    member_student_ids: d.memberIds,
    leader_student_id: d.leaderId,
  }
}

/**
 * Smallest group number free in EVERY supported language, named in the current
 * one. Two things this guards against:
 *
 * - Plain `groups.length + 1` collides after a delete (3 groups, remove #2,
 *   next add computes 「第 3 組」 again). The group is created the instant the
 *   button is clicked, so the user gets no chance to rename around the 409.
 * - Checking only the current language lets a teacher who made 「第 1 組」 in
 *   Chinese add a second group also numbered 1 ("Group 1") in English, sitting
 *   right next to it.
 *
 * `labelsFor(n)` returns every locale's rendering of n, current locale first —
 * that first entry is the name actually used.
 */
function nextGroupName(taken: Set<string>, labelsFor: (n: number) => string[]) {
  for (let n = 1; ; n += 1) {
    const candidates = labelsFor(n)
    if (candidates.every((c) => !taken.has(c))) return candidates[0]
  }
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

  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [draft, setDraft] = useState<Draft | null>(null)
  const [nameInput, setNameInput] = useState('')
  const [saveState, setSaveState] = useState<SaveState>('idle')
  const [errKey, setErrKey] = useState<string | null>(null)

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

  // Read inside the save loop, which must not close over a stale render.
  const groupsRef = useRef(groups)
  groupsRef.current = groups

  // Serialised, coalescing save queue. Rapid clicks (ticking five students in
  // a row) must not race: writes are drained one at a time, and a second edit
  // to the same group before its turn simply overwrites the queued draft. The
  // queue is keyed by group id so switching groups mid-save still flushes the
  // previous group's pending write instead of dropping it. Last-write-wins is
  // correct because the API replaces the whole group on every write.
  const selectedRef = useRef<string | null>(null)
  selectedRef.current = selectedId

  const pending = useRef(new Map<string, Draft>())
  const draining = useRef(false)

  const drain = useCallback(async () => {
    if (draining.current) return
    draining.current = true
    setSaveState('saving')
    try {
      while (pending.current.size > 0) {
        const [id, d] = pending.current.entries().next().value as [string, Draft]
        pending.current.delete(id)
        try {
          await updateMut.mutateAsync({ id, body: toPayload(d) })
          setErrKey(null)
        } catch (err) {
          if (err instanceof ApiError && err.status === 409) {
            // Keep what the user typed so they can fix it in place; rolling
            // back would silently discard their edit.
            setErrKey('groups.errors.duplicate_name')
          } else {
            setErrKey('common.error_generic')
            const server = groupsRef.current.find((g) => g.id === id)
            if (server) {
              const restored = draftFromGroup(server)
              setDraft((cur) => (cur && id === selectedRef.current ? restored : cur))
              if (id === selectedRef.current) setNameInput(restored.name)
            }
          }
          setSaveState('failed')
          return
        }
      }
      setSaveState('saved')
    } finally {
      draining.current = false
    }
  }, [updateMut])

  /** Apply a draft change locally (optimistic) and persist it. */
  const commit = useCallback(
    (next: Draft) => {
      if (!selectedId) return
      setDraft(next)
      pending.current.set(selectedId, next)
      void drain()
    },
    [selectedId, drain],
  )

  // Drop the editor if the selected group disappears (deleted in another tab).
  useEffect(() => {
    if (selectedId && !groups.some((g) => g.id === selectedId)) {
      setSelectedId(null)
      setDraft(null)
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

  function select(g: Group) {
    setErrKey(null)
    setSaveState('idle')
    setSelectedId(g.id)
    const d = draftFromGroup(g)
    setDraft(d)
    setNameInput(d.name)
  }

  async function addGroup() {
    setErrKey(null)
    // Every existing name, so a hand-typed "Group 3" also reserves n=3.
    const taken = new Set(groups.map((g) => g.name))
    // 'cimode' is i18next's own debug pseudo-language, not a real one.
    const langs = (i18n.options.supportedLngs || ['zh-TW', 'en']).filter(
      (l) => l !== 'cimode',
    )
    const name = nextGroupName(taken, (n) => [
      t('groups.default_name', { n }),
      ...langs.map((lng) => t('groups.default_name', { n, lng })),
    ])
    setSaveState('saving')
    try {
      const created = await createMut.mutateAsync({
        name,
        color: GROUP_COLORS[groups.length % GROUP_COLORS.length],
        member_student_ids: [],
        leader_student_id: null,
      })
      select(created)
      setSaveState('saved')
    } catch {
      setErrKey('common.error_generic')
      setSaveState('failed')
    }
  }

  async function removeGroup(g: Group) {
    if (!window.confirm(t('groups.confirm_delete', { name: g.name }))) return
    await deleteMut.mutateAsync(g.id)
    if (g.id === selectedId) {
      setSelectedId(null)
      setDraft(null)
    }
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
    commit({ ...draft, memberIds: arrayMove(draft.memberIds, from, to) })
  }

  function toggleMember(studentId: string) {
    if (!draft) return
    const has = draft.memberIds.includes(studentId)
    commit({
      ...draft,
      memberIds: has
        ? draft.memberIds.filter((id) => id !== studentId)
        : [...draft.memberIds, studentId],
      // A leader who is no longer a member is rejected by the API.
      leaderId: has && draft.leaderId === studentId ? null : draft.leaderId,
    })
  }

  function toggleLeader(studentId: string) {
    if (!draft || !draft.memberIds.includes(studentId)) return
    commit({
      ...draft,
      leaderId: draft.leaderId === studentId ? null : studentId,
    })
  }

  function commitName() {
    if (!draft) return
    const trimmed = nameInput.trim()
    // An empty name cannot be saved; fall back to the last good one rather
    // than nagging with an error.
    if (!trimmed) {
      setNameInput(draft.name)
      return
    }
    if (trimmed === draft.name) return
    commit({ ...draft, name: trimmed })
  }

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
          <p className="text-sm text-rose-600 mb-4">
            {t('common.error_generic')}
          </p>
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
        <div className="grid grid-cols-1 lg:grid-cols-[240px_minmax(0,1fr)_300px] gap-6 items-start">
          {/* ---------- column 1: group list ---------- */}
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
                        deleteLabel={t('groups.delete_group_aria', {
                          name: g.name,
                        })}
                        onSelect={() => select(g)}
                        onDelete={() => removeGroup(g)}
                      />
                    ))}
                  </ul>
                </SortableContext>
              </DndContext>
            )}

            <button
              className={SECONDARY_BTN}
              onClick={addGroup}
              disabled={createMut.isPending}
            >
              {t('groups.add')}
            </button>
          </section>

          {/* ---------- column 2: selected group ---------- */}
          <section className="bg-white border border-slate-200 rounded-xl p-5 lg:p-6 shadow-sm">
            {!draft ? (
              <p className="text-sm text-slate-500 py-8 text-center">
                {groups.length === 0
                  ? t('groups.empty_hint')
                  : t('groups.select_hint')}
              </p>
            ) : (
              <div className="space-y-6">
                <div className="flex items-center justify-between gap-3">
                  <h2 className="font-semibold text-slate-900 tracking-tight truncate">
                    {draft.name}
                  </h2>
                  <SaveStatus state={saveState} />
                </div>

                <div>
                  <label
                    htmlFor="group-name"
                    className="block text-sm font-medium text-slate-700 mb-1.5"
                  >
                    {t('groups.field_name')}
                  </label>
                  <input
                    id="group-name"
                    value={nameInput}
                    maxLength={100}
                    onChange={(e) => setNameInput(e.target.value)}
                    onBlur={commitName}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') {
                        e.preventDefault()
                        e.currentTarget.blur()
                      } else if (e.key === 'Escape') {
                        setNameInput(draft.name)
                      }
                    }}
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
                        onClick={() => commit({ ...draft, color: c })}
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
                    })}
                  </h3>
                  <p className="text-sm text-slate-500 mb-3">
                    {t('groups.members_hint')}
                  </p>

                  {draft.memberIds.length === 0 ? (
                    <p className="text-sm text-slate-500 py-4">
                      {t('groups.no_members')}
                    </p>
                  ) : (
                    <DndContext
                      sensors={sensors}
                      collisionDetection={closestCenter}
                      onDragEnd={onMemberDragEnd}
                    >
                      <SortableContext
                        items={draft.memberIds}
                        strategy={verticalListSortingStrategy}
                      >
                        <ul className="space-y-1 max-h-[28rem] overflow-y-auto">
                          {draft.memberIds.map((id, index) => {
                            const s = studentById.get(id)
                            if (!s) return null
                            const who = s.name || String(s.seat_number)
                            return (
                              <SortableMemberRow
                                key={id}
                                id={id}
                                index={index}
                                student={s}
                                isLeader={draft.leaderId === id}
                                handleTitle={t('groups.drag_to_reorder')}
                                leaderLabel={t('groups.set_leader', {
                                  name: who,
                                })}
                                removeLabel={t('groups.remove_member_aria', {
                                  name: who,
                                })}
                                onToggleLeader={() => toggleLeader(id)}
                                onRemove={() => toggleMember(id)}
                              />
                            )
                          })}
                        </ul>
                      </SortableContext>
                    </DndContext>
                  )}
                </div>

                {errKey && (
                  <p role="alert" className="text-sm text-rose-600">
                    {t(errKey)}
                  </p>
                )}
              </div>
            )}
          </section>

          {/* ---------- column 3: class roster ---------- */}
          <section className="bg-white border border-slate-200 rounded-xl p-5 shadow-sm">
            <h2 className="text-sm font-semibold text-slate-500 uppercase tracking-wide mb-3">
              {t('groups.roster_heading', { count: students.length })}
            </h2>

            {students.length === 0 ? (
              <p className="text-sm text-slate-500">{t('groups.no_students')}</p>
            ) : !draft ? (
              <p className="text-sm text-slate-500">
                {t('groups.roster_disabled_hint')}
              </p>
            ) : (
              <ul className="space-y-0.5 max-h-[32rem] overflow-y-auto">
                {students.map((s) => {
                  const checked = draft.memberIds.includes(s.id)
                  return (
                    <li key={s.id}>
                      <label
                        className={`flex items-center gap-3 px-2 py-2 rounded-lg cursor-pointer min-h-[44px] transition-colors ${
                          checked ? 'bg-amber-50' : 'hover:bg-slate-50'
                        }`}
                      >
                        <input
                          type="checkbox"
                          checked={checked}
                          onChange={() => toggleMember(s.id)}
                          className="h-4 w-4 rounded border-slate-300 text-amber-500 focus:ring-amber-500"
                        />
                        <span className="text-sm text-slate-500 tabular-nums w-8">
                          {String(s.seat_number).padStart(2, '0')}
                        </span>
                        <span
                          className={`text-sm truncate ${
                            checked ? 'text-slate-900' : 'text-slate-600'
                          }`}
                        >
                          {s.name || '—'}
                        </span>
                      </label>
                    </li>
                  )
                })}
              </ul>
            )}
          </section>
        </div>
      )}
    </PageContainer>
  )
}

// ---------- save indicator ----------

function SaveStatus({ state }: { state: SaveState }) {
  const { t } = useTranslation()
  if (state === 'idle') return null
  const tone =
    state === 'failed'
      ? 'text-rose-600'
      : state === 'saving'
        ? 'text-slate-400'
        : 'text-emerald-600'
  const key =
    state === 'failed'
      ? 'groups.save_failed'
      : state === 'saving'
        ? 'groups.saving'
        : 'groups.saved'
  return (
    <span
      aria-live="polite"
      className={`shrink-0 text-xs tabular-nums ${tone}`}
    >
      {t(key)}
    </span>
  )
}

// ---------- sortable rows ----------

function SortableGroupRow({
  group,
  active,
  handleTitle,
  deleteLabel,
  onSelect,
  onDelete,
}: {
  group: Group
  active: boolean
  handleTitle: string
  deleteLabel: string
  onSelect: () => void
  onDelete: () => void
}) {
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id: group.id })
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
        className={`flex-1 min-w-0 flex items-center gap-2 min-h-[44px] px-2 rounded-lg text-left text-sm transition-colors ${
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
      <button
        type="button"
        onClick={onDelete}
        aria-label={deleteLabel}
        title={deleteLabel}
        className="shrink-0 h-11 w-8 rounded-lg text-slate-300 hover:text-rose-600 hover:bg-rose-50 transition-colors focus:outline-none focus:ring-2 focus:ring-rose-400"
      >
        ✕
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
  removeLabel,
  onToggleLeader,
  onRemove,
}: {
  id: string
  index: number
  student: Student
  isLeader: boolean
  handleTitle: string
  leaderLabel: string
  removeLabel: string
  onToggleLeader: () => void
  onRemove: () => void
}) {
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id })
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
        className={`ml-auto shrink-0 h-11 w-9 rounded-full text-base leading-none transition-colors focus:outline-none focus:ring-2 focus:ring-amber-500 ${
          isLeader ? 'text-amber-500' : 'text-slate-300 hover:text-slate-400'
        }`}
      >
        {isLeader ? '★' : '☆'}
      </button>
      <button
        type="button"
        onClick={onRemove}
        aria-label={removeLabel}
        title={removeLabel}
        className="shrink-0 h-11 w-8 rounded-lg text-slate-300 hover:text-rose-600 hover:bg-rose-50 transition-colors focus:outline-none focus:ring-2 focus:ring-rose-400"
      >
        ✕
      </button>
    </li>
  )
}
