/**
 * Thin wrapper for calling the Grades backend.
 * Adds the Supabase Auth bearer token to every request.
 */
import { supabase } from './supabase'

const RAW_API_BASE = import.meta.env.VITE_API_BASE_URL ?? ''
if (RAW_API_BASE.endsWith('/')) {
  // A trailing slash combined with paths like `/api/me/seed` produces `//api/me/seed`,
  // which Vercel 308-redirects to the single-slash version. Browsers refuse to follow
  // redirects on CORS preflight (OPTIONS), so every API call fails with a misleading
  // "Redirect is not allowed for a preflight request" error. Strip it defensively.
  console.warn(
    '[api] VITE_API_BASE_URL has a trailing slash; stripping it. Fix the env var to avoid CORS preflight failures.',
  )
}
const API_BASE = RAW_API_BASE.replace(/\/+$/, '')

export interface MeResponse {
  user: { id: string; email: string | null }
  setup: {
    has_classes: boolean
    has_subjects: boolean
    has_current_semester: boolean
  }
  terms_per_year: 2 | 3 | 4
  subject_order: string[]
  item_order: string[]
  point_reasons: PointReason[]
}

export interface PointReason {
  id: string
  name: string
  default_points: number
  system_key?: string | null
}

export interface ClassPointsSummary {
  classroom_id: string
  grade: number
  name: string
  student_count: number
  semester_points: number
}

export interface StudentPointsSummary {
  student_id: string
  seat_number: number
  name: string | null
  semester_points: number
}

export interface StudentPointsSummaryList {
  classroom_id: string
  classroom_grade: number
  classroom_name: string
  data: StudentPointsSummary[]
}

export interface MeSettingsUpdate {
  terms_per_year: 2 | 3 | 4
}

export interface SeedResult {
  categories_created: number
  semesters_created: number
}

export type ClassroomSource = 'manual' | 'duotopia' | 'google_classroom'

export interface Classroom {
  id: string
  grade: number
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
  if (res.status === 401) {
    // Backend rejected the token (expired / wrong signer / etc). Clear the
    // local Supabase session — AuthProvider's onAuthStateChange listener
    // then sets session=null and ProtectedRoute redirects to /login.
    void supabase.auth.signOut({ scope: 'local' }).catch(() => {})
  }
  if (res.status === 204) return undefined as T
  const text = await res.text()
  const json = text ? JSON.parse(text) : null
  if (!res.ok) {
    const body: ApiErrorBody | null = json?.error ?? null
    throw new ApiError(res.status, body)
  }
  return json as T
}

export interface Category {
  id: string
  system_key: string
  weight: number
}

export interface CategoryList {
  data: Category[]
}

export interface CategoryWeightUpdate {
  system_key: string
  weight: number
}

// Per-subject student standard (issue #10).
export interface StudentStandard {
  student_id: string
  subject_id: string
  threshold: number
}

export interface StandardsView {
  data: StudentStandard[]
}

export interface StandardsBatchPayload {
  student_ids: string[]
  subject_id: string
  threshold: number
}

export interface Student {
  id: string
  classroom_id: string
  seat_number: number
  name: string | null
  email: string | null
  source: ClassroomSource
  created_at: string
  updated_at: string
}

export interface StudentList {
  data: Student[]
  meta: { total: number }
}

export interface StudentPayload {
  seat_number: number
  name?: string | null
  email?: string | null
}

// ---------- Student detail (issue #11) ----------

export interface StudentDetail {
  id: string
  classroom_id: string
  classroom_grade: number
  classroom_name: string
  seat_number: number
  name: string | null
  email: string | null
  semester_id: string | null
  semester_label: string | null
  semester_points: number
}

export interface StudentGradeRow {
  grade_id: string
  item_id: string
  item_name: string
  subject_id: string
  subject_system_key: string | null
  subject_display_name: string | null
  category_system_key: string
  score: number
  threshold: number | null
  met_standard: boolean
  created_at: string
}

export interface StudentSubjectSummary {
  subject_id: string
  subject_system_key: string | null
  subject_display_name: string | null
  weighted_total: number | null
  category_averages: Record<string, number>
}

export interface StudentGradesView {
  semester_id: string | null
  subjects: StudentSubjectSummary[]
  grades: StudentGradeRow[]
}

export interface StudentPointRow {
  id: string
  points: number
  reason: string
  source_grade_id: string | null
  created_at: string
  // Running balance at the moment this record was written (within the
  // current filter scope). Last row in date order equals the filter's total.
  balance_after: number
}

export interface StudentPointsView {
  semester_id: string | null
  total: number
  record_count: number
  page: number
  page_size: number
  total_pages: number
  reasons: string[]
  data: StudentPointRow[]
}

export interface PointResetResult {
  skipped: boolean
  current: number
  record: {
    id: string
    student_id: string
    points: number
    reason: string
    created_at: string
  } | null
}

export interface ClassPointsResetResult {
  written: number
  skipped: number
}

export interface ImportRowPreview {
  row_number: number
  action: 'create' | 'update' | 'error'
  seat_number: number | null
  name: string | null
  email: string | null
  existing_id: string | null
  errors: string[]
}

export interface ImportResult {
  dry_run: boolean
  summary: {
    total_rows: number
    to_create: number
    to_update: number
    errors: number
  }
  rows: ImportRowPreview[]
}

export const SYSTEM_SUBJECT_KEYS = [
  'chinese',
  'math',
  'english',
  'science',
  'social_studies',
  'music',
  'art',
  'pe',
  'integrated',
] as const

export type SystemSubjectKey = (typeof SYSTEM_SUBJECT_KEYS)[number]

export interface ItemGradesStudentRow {
  student_id: string
  seat_number: number
  name: string | null
  grade_id: string | null
  score: number | null
}

export interface ItemGradesView {
  item_id: string
  item_name: string
  subject_id: string
  subject_system_key: string | null
  subject_display_name: string | null
  category_system_key: string
  semester_id: string
  classroom_id: string
  students: ItemGradesStudentRow[]
}

export interface GradeWriteOut {
  id: string
  item_id: string
  student_id: string
  score: number
  awarded_points: number
}

export interface GradeBulkEntry {
  student_id: string
  score: number | null
}

export interface GradeBulkUpsertBody {
  item_id: string
  classroom_id: string
  snapshot_id?: string
  entries: GradeBulkEntry[]
}

export interface GradeBulkResult {
  written: number
  deleted: number
  awarded: number
  revoked: number
}

export interface ItemDetail {
  id: string
  name: string
  subject_id: string
  subject_system_key: string | null
  subject_display_name: string | null
  category_id: string
  category_system_key: string
  semester_id: string
  grade_count: number
  point_record_count: number
  created_at: string
}

export interface ItemDetailList {
  data: ItemDetail[]
}

export interface ItemCreatePayload {
  subject_id: string
  category_id: string
  semester_id: string
  name: string
}

export interface ItemUpdatePayload {
  name: string
}

export interface ItemFilters {
  semester_id?: string
  subject_id?: string
  category_id?: string
}

export interface GradeImportColumnPreview {
  column_index: number
  category_input: string | null
  category_system_key: string | null
  exam_date: string | null
  exam_name: string
  errors: string[]
}

export interface GradeImportStudentRow {
  row_number: number
  seat_number: number | null
  student_id: string | null
  scores: Record<number, number>
  errors: string[]
}

export interface Semester {
  id: string
  academic_year: number
  term: 1 | 2 | 3 | 4
  is_current: boolean
  start_date: string  // YYYY-MM-DD
  end_date: string    // YYYY-MM-DD
}

export interface SemesterList {
  data: Semester[]
  meta: { total: number }
}

export interface CategoryWeight {
  system_key: string
  weight: number
}

export interface Subject {
  id: string
  system_key: string | null
  display_name: string | null
  is_custom: boolean
}

export interface SubjectList {
  data: Subject[]
}

export interface SubjectWeight {
  subject_id: string
  subject_system_key: string | null
  subject_display_name: string | null
  category_id: string
  category_system_key: string
  weight: number
}

export interface SubjectWeightsList {
  data: SubjectWeight[]
}

export interface SubjectWeightsUpdate {
  subject_id: string
  category_id: string
  weight: number
}

export interface SubjectPointRule {
  subject_id: string
  points_awarded: number
}

export interface SubjectPointRulesList {
  data: SubjectPointRule[]
}

export interface SubjectPointRuleUpdate {
  subject_id: string
  points_awarded: number
}

export interface SubjectCategoryWeightView {
  subject_id: string
  subject_system_key: string | null
  subject_display_name: string | null
  category_system_key: string
  weight: number
}

export interface StudentBrief {
  id: string
  seat_number: number
  name: string | null
  email: string | null
}

export interface GradeItem {
  id: string
  name: string
  subject_id: string
  subject_system_key: string | null
  subject_display_name: string | null
  category_system_key: string
  exam_date: string | null
}

export interface GradeEntry {
  item_id: string
  student_id: string
  score: number
}

export interface ClassroomGradesView {
  // Nullable only in the snapshot-view edge case (an emptied snapshot
  // with no current semester to fall back to).
  semester: Semester | null
  classroom_id: string
  classroom_grade: number
  classroom_name: string
  subject_category_weights: SubjectCategoryWeightView[]
  students: StudentBrief[]
  items: GradeItem[]
  grades: GradeEntry[]
}

export interface Snapshot {
  id: string
  classroom_id: string
  classroom_grade: number
  classroom_name: string
  name: string
  created_at: string
}

export interface SnapshotList {
  data: Snapshot[]
  meta: { total: number }
}

export interface GradeImportResult {
  dry_run: boolean
  summary: {
    column_total: number
    row_total: number
    score_total: number
    errors: number
  }
  columns: GradeImportColumnPreview[]
  students: GradeImportStudentRow[]
}

async function uploadMultipart<T>(
  path: string,
  formData: FormData,
): Promise<T> {
  const token = await authedToken()
  const res = await fetch(`${API_BASE}${path}`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}` },
    body: formData,
  })
  if (res.status === 401) {
    void supabase.auth.signOut({ scope: 'local' }).catch(() => {})
  }
  const text = await res.text()
  const json = text ? JSON.parse(text) : null
  if (!res.ok) {
    const body: ApiErrorBody | null = json?.error ?? null
    throw new ApiError(res.status, body)
  }
  return json as T
}

async function downloadFile(path: string, filename: string): Promise<void> {
  const token = await authedToken()
  const res = await fetch(`${API_BASE}${path}`, {
    headers: { Authorization: `Bearer ${token}` },
  })
  if (!res.ok) {
    throw new ApiError(res.status, null)
  }
  const blob = await res.blob()
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  a.click()
  URL.revokeObjectURL(url)
}

export const api = {
  me: {
    get: () => request<MeResponse>('/api/me'),
    seed: () => request<SeedResult>('/api/me/seed', { method: 'POST' }),
    updateSettings: (body: MeSettingsUpdate) =>
      request<{ terms_per_year: number }>('/api/me/settings', {
        method: 'PATCH',
        body: JSON.stringify(body),
      }),
    updateSubjectOrder: (subjectIds: string[]) =>
      request<{ subject_order: string[] }>('/api/me/subject-order', {
        method: 'PUT',
        body: JSON.stringify({ subject_ids: subjectIds }),
      }),
    updateItemOrder: (itemIds: string[]) =>
      request<{ item_order: string[] }>('/api/me/item-order', {
        method: 'PUT',
        body: JSON.stringify({ item_ids: itemIds }),
      }),
    reset: () => request<SeedResult>('/api/me/reset', { method: 'POST' }),
    updatePointReasons: (reasons: PointReason[]) =>
      request<{ point_reasons: PointReason[] }>('/api/me/point-reasons', {
        method: 'PUT',
        body: JSON.stringify({ reasons }),
      }),
  },
  points: {
    listClassrooms: () =>
      request<{ data: ClassPointsSummary[] }>('/api/points/classrooms'),
    listClassroomStudents: (classroomId: string) =>
      request<StudentPointsSummaryList>(
        `/api/points/classrooms/${classroomId}/students`,
      ),
    classBatch: (
      classroomId: string,
      body: { points: number; reason: string },
    ) =>
      request<{ written: number }>(
        `/api/classrooms/${classroomId}/points/batch`,
        { method: 'POST', body: JSON.stringify(body) },
      ),
    addStudent: (
      studentId: string,
      body: { points: number; reason: string },
    ) =>
      request<{ id: string; points: number; reason: string }>(
        `/api/students/${studentId}/points`,
        { method: 'POST', body: JSON.stringify(body) },
      ),
    resetStudent: (studentId: string, body: { reason?: string } = {}) =>
      request<PointResetResult>(
        `/api/students/${studentId}/points/reset`,
        { method: 'POST', body: JSON.stringify({ reason: body.reason ?? '' }) },
      ),
    resetClassroom: (classroomId: string, body: { reason?: string } = {}) =>
      request<ClassPointsResetResult>(
        `/api/classrooms/${classroomId}/points/reset`,
        { method: 'POST', body: JSON.stringify({ reason: body.reason ?? '' }) },
      ),
  },
  classrooms: {
    list: () => request<ClassroomList>('/api/classrooms'),
    get: (id: string) => request<ClassroomDetail>(`/api/classrooms/${id}`),
    create: (body: { grade: number; name: string }) =>
      request<Classroom>('/api/classrooms', {
        method: 'POST',
        body: JSON.stringify(body),
      }),
    update: (id: string, body: { grade: number; name: string }) =>
      request<Classroom>(`/api/classrooms/${id}`, {
        method: 'PUT',
        body: JSON.stringify(body),
      }),
    remove: (id: string) =>
      request<void>(`/api/classrooms/${id}`, { method: 'DELETE' }),
    activateItem: (
      classroomId: string,
      itemId: string,
      snapshotId?: string | null,
    ) => {
      const qs = snapshotId ? `?snapshot_id=${snapshotId}` : ''
      return request<void>(
        `/api/classrooms/${classroomId}/items/${itemId}/activation${qs}`,
        { method: 'POST' },
      )
    },
    deactivateItem: (
      classroomId: string,
      itemId: string,
      snapshotId?: string | null,
    ) => {
      const qs = snapshotId ? `?snapshot_id=${snapshotId}` : ''
      return request<void>(
        `/api/classrooms/${classroomId}/items/${itemId}/activation${qs}`,
        { method: 'DELETE' },
      )
    },
  },
  categories: {
    list: () => request<CategoryList>('/api/categories'),
    updateWeights: (body: CategoryWeightUpdate[]) =>
      request<CategoryList>('/api/categories/weights', {
        method: 'PUT',
        body: JSON.stringify(body),
      }),
  },
  students: {
    list: (classroomId: string) =>
      request<StudentList>(`/api/classrooms/${classroomId}/students`),
    create: (classroomId: string, body: StudentPayload) =>
      request<Student>(`/api/classrooms/${classroomId}/students`, {
        method: 'POST',
        body: JSON.stringify(body),
      }),
    update: (id: string, body: StudentPayload & { classroom_id?: string }) =>
      request<Student>(`/api/students/${id}`, {
        method: 'PUT',
        body: JSON.stringify(body),
      }),
    remove: (id: string) =>
      request<void>(`/api/students/${id}`, { method: 'DELETE' }),
    standards: (classroomId: string) =>
      request<StandardsView>(
        `/api/classrooms/${classroomId}/standards`,
      ),
    upsertStandard: (
      studentId: string,
      subjectId: string,
      threshold: number,
    ) =>
      request<StudentStandard>(
        `/api/students/${studentId}/standards/${subjectId}`,
        {
          method: 'PUT',
          body: JSON.stringify({ threshold }),
        },
      ),
    deleteStandard: (studentId: string, subjectId: string) =>
      request<void>(
        `/api/students/${studentId}/standards/${subjectId}`,
        { method: 'DELETE' },
      ),
    batchStandards: (classroomId: string, body: StandardsBatchPayload) =>
      request<{ written: number }>(
        `/api/classrooms/${classroomId}/standards/batch`,
        {
          method: 'POST',
          body: JSON.stringify(body),
        },
      ),
    detail: (studentId: string, semesterId?: string) => {
      const qs = semesterId ? `?semester_id=${semesterId}` : ''
      return request<StudentDetail>(`/api/students/${studentId}${qs}`)
    },
    grades: (studentId: string, semesterId?: string) => {
      const qs = semesterId ? `?semester_id=${semesterId}` : ''
      return request<StudentGradesView>(
        `/api/students/${studentId}/grades${qs}`,
      )
    },
    points: (
      studentId: string,
      params: {
        semesterId?: string
        page?: number
        pageSize?: number
        reason?: string | null
        sort?: 'newest' | 'oldest'
      } = {},
    ) => {
      const qs = new URLSearchParams()
      if (params.semesterId) qs.set('semester_id', params.semesterId)
      if (params.page) qs.set('page', String(params.page))
      if (params.pageSize) qs.set('page_size', String(params.pageSize))
      if (params.reason !== undefined && params.reason !== null && params.reason !== '')
        qs.set('reason', params.reason)
      if (params.sort) qs.set('sort', params.sort)
      const suffix = qs.toString() ? `?${qs.toString()}` : ''
      return request<StudentPointsView>(
        `/api/students/${studentId}/points${suffix}`,
      )
    },
    import: (classroomId: string, file: File, dryRun: boolean) => {
      const fd = new FormData()
      fd.append('file', file)
      return uploadMultipart<ImportResult>(
        `/api/classrooms/${classroomId}/students/import?dry_run=${dryRun}`,
        fd,
      )
    },
    downloadTemplate: (classroomId: string) =>
      downloadFile(
        `/api/classrooms/${classroomId}/students/template.xlsx`,
        'students_template.xlsx',
      ),
  },
  semesters: {
    list: () => request<SemesterList>('/api/semesters'),
    create: (body: {
      academic_year: number
      term: 1 | 2 | 3 | 4
      start_date: string
      end_date: string
    }) =>
      request<Semester>('/api/semesters', {
        method: 'POST',
        body: JSON.stringify(body),
      }),
    setCurrent: (id: string) =>
      request<Semester>(`/api/semesters/${id}/set-current`, { method: 'PUT' }),
    update: (
      id: string,
      body: {
        academic_year: number
        term: 1 | 2 | 3 | 4
        start_date: string
        end_date: string
      },
    ) =>
      request<Semester>(`/api/semesters/${id}`, {
        method: 'PUT',
        body: JSON.stringify(body),
      }),
    remove: (id: string) =>
      request<void>(`/api/semesters/${id}`, { method: 'DELETE' }),
  },
  subjects: {
    list: () => request<SubjectList>('/api/subjects'),
    create: (display_name: string) =>
      request<Subject>('/api/subjects', {
        method: 'POST',
        body: JSON.stringify({ display_name }),
      }),
    remove: (id: string) =>
      request<void>(`/api/subjects/${id}`, { method: 'DELETE' }),
  },
  subjectWeights: {
    list: () => request<SubjectWeightsList>('/api/subject-weights'),
    update: (body: SubjectWeightsUpdate[]) =>
      request<SubjectWeightsList>('/api/subject-weights', {
        method: 'PUT',
        body: JSON.stringify(body),
      }),
  },
  subjectPointRules: {
    list: () =>
      request<SubjectPointRulesList>('/api/subject-point-rules'),
    update: (body: SubjectPointRuleUpdate[]) =>
      request<SubjectPointRulesList>('/api/subject-point-rules', {
        method: 'PUT',
        body: JSON.stringify(body),
      }),
  },
  items: {
    list: (filters: ItemFilters = {}) => {
      const qs = new URLSearchParams()
      for (const [k, v] of Object.entries(filters)) {
        if (v) qs.set(k, v)
      }
      const tail = qs.toString() ? `?${qs.toString()}` : ''
      return request<ItemDetailList>(`/api/items${tail}`)
    },
    create: (body: ItemCreatePayload) =>
      request<ItemDetail>('/api/items', {
        method: 'POST',
        body: JSON.stringify(body),
      }),
    update: (id: string, body: ItemUpdatePayload) =>
      request<ItemDetail>(`/api/items/${id}`, {
        method: 'PUT',
        body: JSON.stringify(body),
      }),
    remove: (id: string) =>
      request<void>(`/api/items/${id}`, { method: 'DELETE' }),
  },
  gradeEntry: {
    forItem: (itemId: string, classroomId: string) =>
      request<ItemGradesView>(
        `/api/items/${itemId}/grades?classroom_id=${classroomId}`,
      ),
    create: (body: { item_id: string; student_id: string; score: number }) =>
      request<GradeWriteOut>('/api/grades', {
        method: 'POST',
        body: JSON.stringify(body),
      }),
    update: (gradeId: string, score: number) =>
      request<GradeWriteOut>(`/api/grades/${gradeId}`, {
        method: 'PUT',
        body: JSON.stringify({ score }),
      }),
    remove: (gradeId: string) =>
      request<void>(`/api/grades/${gradeId}`, { method: 'DELETE' }),
    bulk: (body: GradeBulkUpsertBody) =>
      request<GradeBulkResult>('/api/grades/bulk', {
        method: 'POST',
        body: JSON.stringify(body),
      }),
  },
  grades: {
    view: (classroomId: string, semesterId?: string) => {
      const qs = semesterId ? `?semester_id=${semesterId}` : ''
      return request<ClassroomGradesView>(
        `/api/classrooms/${classroomId}/grades${qs}`,
      )
    },
    downloadTemplate: (classroomId: string) =>
      downloadFile(
        `/api/classrooms/${classroomId}/grades/template.xlsx`,
        'grades_template.xlsx',
      ),
    preview: (classroomId: string, file: File) => {
      const fd = new FormData()
      fd.append('file', file)
      return uploadMultipart<GradeImportResult>(
        `/api/classrooms/${classroomId}/grades/import?dry_run=true`,
        fd,
      )
    },
    commit: (
      classroomId: string,
      file: File,
      subjects: Record<number, SystemSubjectKey>,
    ) => {
      const fd = new FormData()
      fd.append('file', file)
      fd.append('subjects', JSON.stringify(subjects))
      return uploadMultipart<GradeImportResult>(
        `/api/classrooms/${classroomId}/grades/import?dry_run=false`,
        fd,
      )
    },
  },
  snapshots: {
    list: (params?: {
      classroom_id?: string
      from_date?: string
      to_date?: string
      semester_id?: string
    }) => {
      const qs = new URLSearchParams()
      if (params?.classroom_id) qs.set('classroom_id', params.classroom_id)
      if (params?.from_date) qs.set('from_date', params.from_date)
      if (params?.to_date) qs.set('to_date', params.to_date)
      if (params?.semester_id) qs.set('semester_id', params.semester_id)
      const tail = qs.toString() ? `?${qs.toString()}` : ''
      return request<SnapshotList>(`/api/snapshots${tail}`)
    },
    create: (classroomId: string) =>
      request<Snapshot>(`/api/classrooms/${classroomId}/snapshots`, {
        method: 'POST',
      }),
    viewGrades: (snapshotId: string) =>
      request<ClassroomGradesView>(`/api/snapshots/${snapshotId}/grades`),
  },
}
