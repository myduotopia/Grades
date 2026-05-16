import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'

import { api, type Semester, type SemesterList } from '../lib/api'

export const semestersKey = ['semesters'] as const

export function useSemesters() {
  return useQuery<SemesterList>({
    queryKey: semestersKey,
    queryFn: api.semesters.list,
  })
}

/** Convenience: the user's current semester, or null while loading / before
 *  any exists. Other pages consume this to default their semester filter. */
export function useCurrentSemester(): Semester | null {
  const { data } = useSemesters()
  return data?.data.find((s) => s.is_current) ?? null
}

export function useCreateSemester() {
  const qc = useQueryClient()
  return useMutation<Semester, Error, void>({
    mutationFn: () => api.semesters.create(),
    onSuccess: () => qc.invalidateQueries({ queryKey: semestersKey }),
  })
}

export function useSetCurrentSemester() {
  const qc = useQueryClient()
  return useMutation<Semester, Error, string>({
    mutationFn: (id) => api.semesters.setCurrent(id),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: semestersKey })
      qc.invalidateQueries({ queryKey: ['me'] })
    },
  })
}

export function useUpdateSemester() {
  const qc = useQueryClient()
  return useMutation<
    Semester,
    Error,
    {
      id: string
      academic_year: number
      term: 1 | 2 | 3 | 4
      start_date: string
      end_date: string
    }
  >({
    mutationFn: ({ id, ...body }) => api.semesters.update(id, body),
    onSuccess: () => qc.invalidateQueries({ queryKey: semestersKey }),
  })
}

export function useDeleteSemester() {
  const qc = useQueryClient()
  return useMutation<void, Error, string>({
    mutationFn: (id) => api.semesters.remove(id),
    onSuccess: () => qc.invalidateQueries({ queryKey: semestersKey }),
  })
}
