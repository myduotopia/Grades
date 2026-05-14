import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'

import {
  api,
  type Student,
  type StudentList,
  type StudentPayload,
} from '../lib/api'

export const studentsKey = (classroomId: string) =>
  ['students', classroomId] as const

export function useStudents(classroomId: string | undefined) {
  return useQuery<StudentList>({
    queryKey: studentsKey(classroomId ?? ''),
    queryFn: () => api.students.list(classroomId as string),
    enabled: !!classroomId,
  })
}

export function useCreateStudent(classroomId: string) {
  const qc = useQueryClient()
  return useMutation<Student, Error, StudentPayload>({
    mutationFn: (body) => api.students.create(classroomId, body),
    onSuccess: () =>
      qc.invalidateQueries({ queryKey: studentsKey(classroomId) }),
  })
}

export function useUpdateStudent(classroomId: string) {
  const qc = useQueryClient()
  return useMutation<
    Student,
    Error,
    { id: string; body: StudentPayload & { classroom_id?: string } }
  >({
    mutationFn: ({ id, body }) => api.students.update(id, body),
    onSuccess: () =>
      qc.invalidateQueries({ queryKey: studentsKey(classroomId) }),
  })
}

export function useDeleteStudent(classroomId: string) {
  const qc = useQueryClient()
  return useMutation<void, Error, string>({
    mutationFn: (id) => api.students.remove(id),
    onSuccess: () =>
      qc.invalidateQueries({ queryKey: studentsKey(classroomId) }),
  })
}
