import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'

import { api, type Classroom, type ClassroomList } from '../lib/api'

export const classroomsKey = ['classrooms'] as const

export function useClassrooms() {
  return useQuery<ClassroomList>({
    queryKey: classroomsKey,
    queryFn: api.classrooms.list,
  })
}

export function useCreateClassroom() {
  const qc = useQueryClient()
  return useMutation<Classroom, Error, { grade: number; name: string }>({
    mutationFn: api.classrooms.create,
    onSuccess: () => qc.invalidateQueries({ queryKey: classroomsKey }),
  })
}

export function useUpdateClassroom() {
  const qc = useQueryClient()
  return useMutation<Classroom, Error, { id: string; grade: number; name: string }>({
    mutationFn: ({ id, grade, name }) =>
      api.classrooms.update(id, { grade, name }),
    onSuccess: () => qc.invalidateQueries({ queryKey: classroomsKey }),
  })
}

export function useDeleteClassroom() {
  const qc = useQueryClient()
  return useMutation<void, Error, string>({
    mutationFn: (id) => api.classrooms.remove(id),
    onSuccess: () => qc.invalidateQueries({ queryKey: classroomsKey }),
  })
}
