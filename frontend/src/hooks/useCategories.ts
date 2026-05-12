import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'

import {
  api,
  type CategoryList,
  type CategoryWeightUpdate,
} from '../lib/api'

export const categoriesKey = ['categories'] as const

export function useCategories() {
  return useQuery<CategoryList>({
    queryKey: categoriesKey,
    queryFn: api.categories.list,
  })
}

export function useUpdateCategoryWeights() {
  const qc = useQueryClient()
  return useMutation<CategoryList, Error, CategoryWeightUpdate[]>({
    mutationFn: api.categories.updateWeights,
    onSuccess: () => qc.invalidateQueries({ queryKey: categoriesKey }),
  })
}
