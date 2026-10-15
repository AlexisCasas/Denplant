import { describe, expect, it, vi } from 'vitest'
import {
  buildPatientListParams,
  canArchivePatient,
  requestPatientArchive
} from '../../../backend/app/modules/patients/frontend/utils/patientList'

describe('patient archive request', () => {
  it('uses the existing soft-archive endpoint', async () => {
    const del = vi.fn().mockResolvedValue(undefined)
    await requestPatientArchive({ del }, 'patient-123')
    expect(del).toHaveBeenCalledWith('/api/v1/patients/patient-123')
  })

  it('propagates API failures so callers cannot show false success', async () => {
    const failure = new Error('request failed')
    const del = vi.fn().mockRejectedValue(failure)
    await expect(requestPatientArchive({ del }, 'patient-123')).rejects.toBe(failure)
  })
})

describe('patient archive UX policy', () => {
  it('allows archiving only active patients with patients.write', () => {
    expect(canArchivePatient({ status: 'active' }, true)).toBe(true)
    expect(canArchivePatient({ status: 'active' }, false)).toBe(false)
    expect(canArchivePatient({ status: 'archived' }, true)).toBe(false)
    expect(canArchivePatient(null, true)).toBe(false)
  })
})

describe('patient list status filters', () => {
  const base = {
    q: '',
    status: ['active'],
    city: '',
    do_not_contact: null
  }

  it('requests active patients by default', () => {
    const params = buildPatientListParams(base, 1, 20, 'last_visit:desc')
    expect(params?.getAll('status')).toEqual(['active'])
    expect(params?.get('include_archived')).toBeNull()
  })

  it('requests only archived patients when that filter is selected', () => {
    const params = buildPatientListParams(
      { ...base, status: ['archived'] },
      1,
      20,
      'last_visit:desc'
    )
    expect(params?.getAll('status')).toEqual(['archived'])
    expect(params?.get('include_archived')).toBe('true')
  })

  it('requests both statuses when both filters are selected', () => {
    const params = buildPatientListParams(
      { ...base, status: ['active', 'archived'] },
      1,
      20,
      'last_visit:desc'
    )
    expect(params?.getAll('status')).toEqual(['active', 'archived'])
  })

  it('returns no query for an empty status selection', () => {
    expect(buildPatientListParams({ ...base, status: [] }, 1, 20, '')).toBeNull()
  })
})
