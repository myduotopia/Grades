/**
 * Thin wrapper for calling the Grades backend.
 * Adds the Supabase Auth bearer token to every request.
 */
import { supabase } from './supabase'

const API_BASE = import.meta.env.VITE_API_BASE_URL

export interface MeResponse {
  user: { id: string; email: string | null }
  setup: {
    has_classes: boolean
    has_subjects: boolean
    has_current_semester: boolean
  }
}

export interface SeedResult {
  categories_created: number
  semesters_created: number
}

export type ClassroomSource = 'manual' | 'duotopia' | 'google_classroom'

export interface Classroom {
  id: string
  name: string
  source: ClassroomSource
  source_external_id: string | null
  created_at: string
  updated_at: string
}

export interface ClassroomDetail extends Classroom {
  student_count: number
}

export interface ClassroomList {
  data: Classroom[]
  meta: { total: number }
}

export interface ApiErrorBody {
  code: string
  message_key: string
  message: string
  details?: Record<string, unknown> | null
}

export class ApiError extends Error {
  constructor(
    public status: number,
    public body: ApiErrorBody | null,
  ) {
    super(body?.message ?? `HTTP ${status}`)
  }
}

async function authedToken(): Promise<string> {
  const { data } = await supabase.auth.getSession()
  const token = data.session?.access_token
  if (!token) throw new ApiError(401, { code: 'UNAUTHORIZED', message_key: 'errors.auth.no_session', message: 'Not signed in' })
  return token
}

async function request<T>(path: string, init: RequestInit = {}): Promise<T> {
  const token = await authedToken()
  const res = await fetch(`${API_BASE}${path}`, {
    ...init,
    headers: {
      ...(init.headers ?? {}),
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
  })
  if (res.status === 204) return undefined as T
  const text = await res.text()
  const json = text ? JSON.parse(text) : null
  if (!res.ok) {
    const body: ApiErrorBody | null = json?.error ?? null
    throw new ApiError(res.status, body)
  }
  return json as T
}

export const api = {
  me: {
    get: () => request<MeResponse>('/api/me'),
    seed: () => request<SeedResult>('/api/me/seed', { method: 'POST' }),
  },
  classrooms: {
    list: () => request<ClassroomList>('/api/classrooms'),
    get: (id: string) => request<ClassroomDetail>(`/api/classrooms/${id}`),
    create: (body: { name: string }) =>
      request<Classroom>('/api/classrooms', {
        method: 'POST',
        body: JSON.stringify(body),
      }),
    update: (id: string, body: { name: string }) =>
      request<Classroom>(`/api/classrooms/${id}`, {
        method: 'PUT',
        body: JSON.stringify(body),
      }),
    remove: (id: string) =>
      request<void>(`/api/classrooms/${id}`, { method: 'DELETE' }),
  },
}
