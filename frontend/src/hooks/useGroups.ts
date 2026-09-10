import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'

import { api, type Group, type GroupList, type GroupPayload } from '../lib/api'

export const groupsKey = (classroomId: string) =>
  ['groups', classroomId] as const

export function useGroups(classroomId: string | undefined) {
  return useQuery<GroupList>({
    queryKey: groupsKey(classroomId ?? ''),
    queryFn: () => api.groups.list(classroomId as string),
    enabled: !!classroomId,
  })
}

export function useCreateGroup(classroomId: string) {
  const qc = useQueryClient()
  return useMutation<Group, Error, GroupPayload>({
    mutationFn: (body) => api.groups.create(classroomId, body),
    onSuccess: () => qc.invalidateQueries({ queryKey: groupsKey(classroomId) }),
  })
}

export function useUpdateGroup(classroomId: string) {
  const qc = useQueryClient()
  return useMutation<Group, Error, { id: string; body: GroupPayload }>({
    mutationFn: ({ id, body }) => api.groups.update(id, body),
    onSuccess: () => qc.invalidateQueries({ queryKey: groupsKey(classroomId) }),
  })
}

export function useDeleteGroup(classroomId: string) {
  const qc = useQueryClient()
  return useMutation<void, Error, string>({
    mutationFn: (id) => api.groups.remove(id),
    onSuccess: () => qc.invalidateQueries({ queryKey: groupsKey(classroomId) }),
  })
}

export function useReorderGroups(classroomId: string) {
  const qc = useQueryClient()
  return useMutation<GroupList, Error, string[], { previous?: GroupList }>({
    mutationFn: (groupIds) => api.groups.updateOrder(classroomId, groupIds),
    // Reorder the cache up front so the list stays where the user dropped it.
    // Without this the row snaps back to the server order until the PUT lands.
    onMutate: async (groupIds) => {
      await qc.cancelQueries({ queryKey: groupsKey(classroomId) })
      const previous = qc.getQueryData<GroupList>(groupsKey(classroomId))
      if (previous) {
        const byId = new Map(previous.data.map((g) => [g.id, g]))
        const reordered = groupIds
          .map((id) => byId.get(id))
          .filter((g): g is Group => !!g)
        // keep anything the caller didn't mention, matching the backend
        const seen = new Set(groupIds)
        for (const g of previous.data) if (!seen.has(g.id)) reordered.push(g)
        qc.setQueryData<GroupList>(groupsKey(classroomId), {
          ...previous,
          data: reordered,
        })
      }
      return { previous }
    },
    onError: (_err, _groupIds, ctx) => {
      if (ctx?.previous) qc.setQueryData(groupsKey(classroomId), ctx.previous)
    },
    // The endpoint returns the authoritative ordered list, so no refetch needed.
    onSuccess: (data) => qc.setQueryData(groupsKey(classroomId), data),
  })
}
