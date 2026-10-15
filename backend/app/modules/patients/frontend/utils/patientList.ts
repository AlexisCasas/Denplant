import type { Patient } from '~~/app/types'

export type PatientListStatus = 'active' | 'archived'

export interface PatientArchiveApi {
  del: (path: string) => Promise<unknown>
}

export function requestPatientArchive(api: PatientArchiveApi, patientId: string): Promise<unknown> {
  return api.del(`/api/v1/patients/${patientId}`)
}

export function canArchivePatient(
  patient: Pick<Patient, 'status'> | null | undefined,
  canWrite: boolean
): boolean {
  return canWrite && patient?.status === 'active'
}

export function buildPatientListParams(
  filters: {
    q: string
    status: string[]
    city: string
    do_not_contact: boolean | null
  },
  page: number,
  pageSize: number,
  sort: string,
  patientIds?: string[]
): URLSearchParams | null {
  const statuses = filters.status.filter(
    (value): value is PatientListStatus => value === 'active' || value === 'archived'
  )

  // An explicitly empty status selection means no results, rather than
  // silently falling back to the default active-only API behaviour.
  if (!statuses.length) return null

  const params = new URLSearchParams()
  params.set('page', String(page))
  params.set('page_size', String(pageSize))
  if (filters.q) params.set('search', filters.q)
  if (filters.city) params.set('city', filters.city)
  if (filters.do_not_contact !== null) {
    params.set('do_not_contact', filters.do_not_contact ? 'true' : 'false')
  }
  for (const status of statuses) params.append('status', status)
  if (statuses.includes('archived')) params.set('include_archived', 'true')
  for (const id of patientIds ?? []) params.append('patient_ids', id)
  if (sort) params.set('sort', sort)
  return params
}
