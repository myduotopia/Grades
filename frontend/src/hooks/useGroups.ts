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
  return useMutation<GroupList, Error, string[]>({
    mutationFn: (groupIds) => api.groups.updateOrder(classroomId, groupIds),
    onSuccess: () => qc.invalidateQueries({ queryKey: groupsKey(classroomId) }),
  })
}
