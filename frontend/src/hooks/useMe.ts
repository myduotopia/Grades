import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'

import { api, type MeResponse, type MeSettingsUpdate } from '../lib/api'

export const meKey = ['me'] as const

export function useMe() {
  return useQuery<MeResponse>({
    queryKey: meKey,
    queryFn: api.me.get,
  })
}

export function useUpdateMeSettings() {
  const qc = useQueryClient()
  return useMutation<{ terms_per_year: number }, Error, MeSettingsUpdate>({
    mutationFn: api.me.updateSettings,
    onSuccess: () => qc.invalidateQueries({ queryKey: meKey }),
  })
}
