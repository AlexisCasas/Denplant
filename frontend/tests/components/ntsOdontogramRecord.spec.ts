/**
 * NTS-05A — data layer: `useNtsApi` transport + `useNtsOdontogramRecord`
 * lifecycle state.
 *
 * Module-layer files are imported by relative path for the same reason as
 * `odontogramProfile.spec.ts`: the `frontend/module_layers` symlink does not
 * resolve on this Windows host, so Nuxt never extends the odontogram layer in
 * the test environment. Host-level auto-imports (`useApi`, `useClinicState`)
 * still resolve and are doubled via `mockNuxtImport`.
 *
 * Nothing here asserts normative content: the 38 rules come from the catalog
 * endpoint and this suite only checks that the catalog is *fetched*, never
 * what it says.
 */

import { mockNuxtImport, mountSuspended } from '@nuxt/test-utils/runtime'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { defineComponent, h, nextTick, ref } from 'vue'

import { useNtsApi, toNtsApiError } from '../../../backend/app/modules/odontogram/frontend/composables/useNtsApi'
import { useNtsOdontogramRecord } from '../../../backend/app/modules/odontogram/frontend/composables/useNtsOdontogramRecord'
import type { NtsRecord, NtsRecordSummary } from '../../../backend/app/modules/odontogram/frontend/types/nts'

const state = vi.hoisted(() => ({
  get: vi.fn(),
  post: vi.fn(),
  put: vi.fn()
}))

mockNuxtImport('useApi', () => () => ({
  get: state.get,
  post: state.post,
  put: state.put
}))

mockNuxtImport('useClinicState', () => () => ({
  currentClinic: { get value() { return { id: 'clinic-a' } } }
}))

async function runInSetup<T>(fn: () => T): Promise<T> {
  let captured!: T
  await mountSuspended(defineComponent({
    setup() {
      captured = fn()
      return () => h('div')
    }
  }))
  return captured
}

/** Let pending microtasks settle. */
async function settle() {
  await nextTick()
  await new Promise(resolve => setTimeout(resolve, 0))
  await nextTick()
}

// ---------------------------------------------------------------------------
// fixtures
// ---------------------------------------------------------------------------

const CATALOG = {
  norm_version: 'pe_nts_188_2022',
  norm_label: 'NTS N.° 188-MINSA/DGIESP-2022',
  country: 'PE',
  expected_rule_count: 38,
  rules: [],
  pending_decisions: []
}

function makeRecord(overrides: Partial<NtsRecord> = {}): NtsRecord {
  return {
    id: 'rec-1',
    clinic_id: 'clinic-a',
    patient_id: 'p1',
    norm_version: 'pe_nts_188_2022',
    stage: 'diagnosis',
    stage_label: null,
    status: 'draft',
    version: 7,
    observations: null,
    recorded_at: '2026-01-02T10:00:00Z',
    recorded_by: 'u1',
    finalized_at: null,
    finalized_by: null,
    discarded_at: null,
    discarded_by: null,
    discard_reason: null,
    recorded_by_name: 'Dra. Ruiz',
    recorded_by_role: 'dentist',
    recorded_by_professional_id: 'COP-1',
    supersedes_record_id: null,
    supersession_reason: null,
    content_hash: null,
    hash_algorithm: null,
    canonicalization_version: null,
    created_at: '2026-01-02T10:00:00Z',
    updated_at: '2026-01-02T10:00:00Z',
    findings: [],
    specifications: [],
    ...overrides
  }
}

function makeSummary(overrides: Partial<NtsRecordSummary> = {}): NtsRecordSummary {
  return {
    id: 'rec-1',
    patient_id: 'p1',
    norm_version: 'pe_nts_188_2022',
    stage: 'diagnosis',
    stage_label: null,
    status: 'finalized',
    version: 2,
    recorded_at: '2026-01-02T10:00:00Z',
    finalized_at: '2026-01-02T11:00:00Z',
    discarded_at: null,
    supersedes_record_id: null,
    content_hash: 'abc',
    is_superseded: false,
    ...overrides
  }
}

/** An `$fetch`-shaped rejection carrying the API's error envelope. */
function apiError(status: number, code: string, errors: string[] = []) {
  return {
    statusCode: status,
    data: { message: errors[0] ?? code, code, errors }
  }
}

/**
 * Route GETs the way the backend does. Each entry may be a value or a thenable
 * factory, which is how the late-response test controls ordering.
 */
function routeGets(options: {
  current?: NtsRecord | null
  draft?: NtsRecord | null
  records?: NtsRecordSummary[]
  catalog?: unknown
} = {}) {
  state.get.mockImplementation(async (url: string) => {
    if (url.includes('/catalogs/')) return { data: options.catalog ?? CATALOG }
    if (url.endsWith('/current')) return { data: options.current ?? null }
    if (url.endsWith('/draft')) return { data: options.draft ?? null }
    if (url.endsWith('/records')) {
      return { data: options.records ?? [], total: (options.records ?? []).length, page: 1, page_size: 20 }
    }
    throw new Error(`unrouted GET ${url}`)
  })
}

beforeEach(() => {
  state.get.mockReset()
  state.post.mockReset()
  state.put.mockReset()
  routeGets()
})

// ---------------------------------------------------------------------------
// §36 A–G — the transport speaks the B.3 contract
// ---------------------------------------------------------------------------

describe('useNtsApi (§36 A–G — request contract)', () => {
  it('A — catalog is read from the catalog endpoint with GET', async () => {
    const api = await runInSetup(() => useNtsApi())
    await api.getCatalog('pe_nts_188_2022')

    expect(state.get).toHaveBeenCalledTimes(1)
    const [url] = state.get.mock.calls[0]!
    expect(url).toBe('/api/v1/odontogram/nts/catalogs/pe_nts_188_2022')
    // A catalog read is never a POST: it mutates nothing.
    expect(state.post).not.toHaveBeenCalled()
  })

  it('B — current and draft carry patient_id in the path and norm_version in the query', async () => {
    const api = await runInSetup(() => useNtsApi())
    await api.getCurrentRecord('p1', 'pe_nts_188_2022')
    await api.getDraft('p1', 'pe_nts_188_2022')

    const [currentUrl, currentOpts] = state.get.mock.calls[0]!
    const [draftUrl, draftOpts] = state.get.mock.calls[1]!

    expect(currentUrl).toBe('/api/v1/odontogram/nts/patients/p1/records/current')
    expect(draftUrl).toBe('/api/v1/odontogram/nts/patients/p1/records/draft')
    expect(currentOpts.query.norm_version).toBe('pe_nts_188_2022')
    expect(draftOpts.query.norm_version).toBe('pe_nts_188_2022')
  })

  it('C — a null current record is an ordinary state, not an error', async () => {
    const api = await runInSetup(() => useNtsApi())
    await expect(api.getCurrentRecord('p1', 'pe_nts_188_2022')).resolves.toBeNull()
  })

  it('D — a null draft is an ordinary state, not an error', async () => {
    const api = await runInSetup(() => useNtsApi())
    await expect(api.getDraft('p1', 'pe_nts_188_2022')).resolves.toBeNull()
  })

  it('E — create draft sends seed=empty and never clinic_id, actor or expected_version', async () => {
    state.post.mockResolvedValue({ data: makeRecord() })

    const api = await runInSetup(() => useNtsApi())
    await api.createDraft('p1', {
      norm_version: 'pe_nts_188_2022',
      stage: 'diagnosis',
      stage_label: null,
      seed: 'empty'
    })

    const [url, body] = state.post.mock.calls[0]!
    expect(url).toBe('/api/v1/odontogram/nts/patients/p1/records')
    expect(body.seed).toBe('empty')
    // The backend derives these; the request schema is extra="forbid".
    expect(body).not.toHaveProperty('clinic_id')
    expect(body).not.toHaveProperty('actor_id')
    expect(body).not.toHaveProperty('recorded_by')
    expect(body).not.toHaveProperty('expected_version')
  })

  it('F — finalize sends the draft\'s real version', async () => {
    state.post.mockResolvedValue({ data: makeRecord({ status: 'finalized' }) })

    const api = await runInSetup(() => useNtsApi())
    await api.finalize('rec-1', { expected_version: 7 })

    expect(state.post).toHaveBeenCalledWith(
      '/api/v1/odontogram/nts/records/rec-1/finalize',
      { expected_version: 7 }
    )
  })

  it('G — discard sends both expected_version and a reason', async () => {
    state.post.mockResolvedValue({ data: makeRecord({ status: 'discarded' }) })

    const api = await runInSetup(() => useNtsApi())
    await api.discard('rec-1', { expected_version: 7, reason: 'abierto por error' })

    expect(state.post).toHaveBeenCalledWith(
      '/api/v1/odontogram/nts/records/rec-1/discard',
      { expected_version: 7, reason: 'abierto por error' }
    )
  })
})

// ---------------------------------------------------------------------------
// §36 E–L — the lifecycle composable
// ---------------------------------------------------------------------------

describe('useNtsOdontogramRecord (§36 E–L — lifecycle)', () => {
  async function mountRecord(patientId = 'p1') {
    const patient = ref(patientId)
    const record = await runInSetup(() =>
      useNtsOdontogramRecord({ patientId: () => patient.value, normVersion: 'pe_nts_188_2022' })
    )
    return { record, patient }
  }

  it('C/D — no current and no draft resolve to the empty state, with no error', async () => {
    const { record } = await mountRecord()
    await record.load()

    expect(record.currentRecord.value).toBeNull()
    expect(record.draft.value).toBeNull()
    expect(record.isEmpty.value).toBe(true)
    expect(record.error.value).toBeNull()
    expect(record.clinicalErrors.value).toEqual([])
  })

  it('E — createDraft always seeds empty (05A never offers carry-forward)', async () => {
    state.post.mockResolvedValue({ data: makeRecord() })

    const { record } = await mountRecord()
    await record.load()
    const ok = await record.createDraft({ stage: 'diagnosis' })

    expect(ok).toBe(true)
    const [, body] = state.post.mock.calls[0]!
    expect(body).toEqual({
      norm_version: 'pe_nts_188_2022',
      stage: 'diagnosis',
      stage_label: null,
      seed: 'empty'
    })
  })

  it('F — finalize takes the version from the loaded draft, not from arithmetic', async () => {
    routeGets({ draft: makeRecord({ version: 9 }) })
    state.post.mockResolvedValue({ data: makeRecord({ status: 'finalized' }) })

    const { record } = await mountRecord()
    await record.load()
    await record.finalizeDraft()

    expect(state.post).toHaveBeenCalledWith(
      '/api/v1/odontogram/nts/records/rec-1/finalize',
      { expected_version: 9 }
    )
  })

  it('G — discard refuses to send a blank reason', async () => {
    routeGets({ draft: makeRecord({ version: 4 }) })

    const { record } = await mountRecord()
    await record.load()

    expect(await record.discardDraft('   ')).toBe(false)
    expect(state.post).not.toHaveBeenCalled()

    state.post.mockResolvedValue({ data: makeRecord({ status: 'discarded' }) })
    expect(await record.discardDraft('  duplicado  ')).toBe(true)
    expect(state.post).toHaveBeenCalledWith(
      '/api/v1/odontogram/nts/records/rec-1/discard',
      { expected_version: 4, reason: 'duplicado' }
    )
  })

  it('H/I — a version conflict refetches and reports, and never retries', async () => {
    routeGets({ draft: makeRecord({ version: 3 }) })

    const { record } = await mountRecord()
    await record.load()
    const loadsBefore = state.get.mock.calls.length

    state.post.mockRejectedValue(apiError(409, 'nts_version_conflict'))
    const ok = await record.finalizeDraft()

    expect(ok).toBe(false)
    // H — exactly one attempt: no silent retry with a bumped version.
    expect(state.post).toHaveBeenCalledTimes(1)
    // I — the authoritative state was refetched and the user is told.
    expect(state.get.mock.calls.length).toBeGreaterThan(loadsBefore)
    expect(record.conflict.value).toBe('version')

    record.dismissConflict()
    expect(record.conflict.value).toBeNull()
  })

  it('J — a draft conflict refetches so the existing draft becomes visible', async () => {
    const existing = makeRecord({ id: 'rec-existing', version: 2 })
    routeGets({ draft: null })

    const { record } = await mountRecord()
    await record.load()
    expect(record.hasDraft.value).toBe(false)

    // Another session opened a draft in the meantime.
    state.post.mockRejectedValue(apiError(409, 'nts_draft_conflict'))
    routeGets({ draft: existing })

    const ok = await record.createDraft({ stage: 'diagnosis' })

    expect(ok).toBe(false)
    expect(state.post).toHaveBeenCalledTimes(1)
    expect(record.conflict.value).toBe('draft')
    expect(record.draft.value?.id).toBe('rec-existing')
  })

  it('a state conflict (already finalized elsewhere) refetches too', async () => {
    routeGets({ draft: makeRecord({ version: 3 }) })

    const { record } = await mountRecord()
    await record.load()

    state.post.mockRejectedValue(apiError(409, 'nts_state_conflict'))
    routeGets({ draft: null, current: makeRecord({ status: 'finalized', version: 4 }) })

    expect(await record.finalizeDraft()).toBe(false)
    expect(record.conflict.value).toBe('state')
    expect(record.hasDraft.value).toBe(false)
    expect(record.hasCurrent.value).toBe(true)
  })

  it('K — every error a 422 reports is preserved, in order', async () => {
    routeGets({ draft: makeRecord({ version: 1 }) })

    const { record } = await mountRecord()
    await record.load()

    const problems = [
      'finding 1: falta la especificación requerida',
      'finding 2: el rol pilar no tiene anclaje',
      'finding 3: atributo obligatorio ausente'
    ]
    state.post.mockRejectedValue(apiError(422, 'nts_clinical_validation', problems))

    expect(await record.finalizeDraft()).toBe(false)
    expect(record.clinicalErrors.value).toEqual(problems)
    // A clinical problem is not a transport failure.
    expect(record.error.value).toBeNull()
    expect(record.conflict.value).toBeNull()
  })

  it('L — an unknown norm version puts the shell in the unavailable state', async () => {
    state.get.mockImplementation(async (url: string) => {
      if (url.includes('/catalogs/')) throw apiError(404, 'nts_norm_version_unknown')
      throw new Error(`unexpected GET ${url}`)
    })

    const { record } = await mountRecord()
    await record.load()

    expect(record.normUnavailable.value).toBe(true)
    // The clinical reads are never attempted under an uninterpretable norm.
    expect(state.get).toHaveBeenCalledTimes(1)
    expect(record.error.value).toBeNull()
  })

  it('a transport failure surfaces as an error, not as an empty odontogram', async () => {
    state.get.mockImplementation(async () => {
      throw new Error('offline')
    })

    const { record } = await mountRecord()
    await record.load()

    expect(record.error.value?.message).toBe('offline')
    expect(record.normUnavailable.value).toBe(false)
  })
})

// ---------------------------------------------------------------------------
// §37 — a late response can never win
// ---------------------------------------------------------------------------

describe('§37 — late-response race', () => {
  it('patient A answering after patient B leaves B on screen', async () => {
    const patient = ref('patient-a')

    // Hand-controlled deferrals so A can be made to answer *after* B.
    let releaseA!: () => void
    let releaseB!: () => void
    const gateA = new Promise<void>((resolve) => {
      releaseA = resolve
    })
    const gateB = new Promise<void>((resolve) => {
      releaseB = resolve
    })

    state.get.mockImplementation(async (url: string) => {
      if (url.includes('/catalogs/')) return { data: CATALOG }

      const isA = url.includes('/patients/patient-a/')
      await (isA ? gateA : gateB)

      const id = isA ? 'rec-a' : 'rec-b'
      if (url.endsWith('/current')) return { data: makeRecord({ id, patient_id: isA ? 'patient-a' : 'patient-b', status: 'finalized' }) }
      if (url.endsWith('/draft')) return { data: null }
      return { data: [makeSummary({ id })], total: 1, page: 1, page_size: 20 }
    })

    const record = await runInSetup(() =>
      useNtsOdontogramRecord({ patientId: () => patient.value, normVersion: 'pe_nts_188_2022' })
    )

    // Request A is in flight and pending.
    const loadA = record.load()
    await settle()

    // The caller navigates to patient B before A answered.
    patient.value = 'patient-b'
    const loadB = record.load()
    await settle()

    // B answers first, then A answers late.
    releaseB()
    await loadB
    expect(record.currentRecord.value?.id).toBe('rec-b')

    releaseA()
    await loadA
    await settle()

    // The late A response was dropped: the screen still shows B.
    expect(record.currentRecord.value?.id).toBe('rec-b')
    expect(record.currentRecord.value?.patient_id).toBe('patient-b')
    expect(record.isLoading.value).toBe(false)
  })

  it('switching patient clears the previous record before the new one arrives', async () => {
    const patient = ref('patient-a')
    routeGets({ current: makeRecord({ id: 'rec-a', status: 'finalized' }) })

    const record = await runInSetup(() =>
      useNtsOdontogramRecord({ patientId: () => patient.value, normVersion: 'pe_nts_188_2022' })
    )
    await record.load()
    expect(record.currentRecord.value?.id).toBe('rec-a')

    // A load that never settles: the state must already be cleared.
    patient.value = 'patient-b'
    state.get.mockImplementation(() => new Promise(() => {}))
    void record.load()
    await settle()

    expect(record.currentRecord.value).toBeNull()
    expect(record.history.value).toEqual([])
  })
})

// ---------------------------------------------------------------------------
// §42 — zero findings is a legitimate record
// ---------------------------------------------------------------------------

describe('§42 — zero-findings draft', () => {
  it('finalizes a draft with no findings and shows it as the current record', async () => {
    routeGets({ draft: makeRecord({ version: 1, findings: [] }) })

    const record = await runInSetup(() =>
      useNtsOdontogramRecord({ patientId: 'p1', normVersion: 'pe_nts_188_2022' })
    )
    await record.load()

    expect(record.draft.value?.findings).toEqual([])
    // No client-side "at least one finding" rule exists to block this.
    state.post.mockResolvedValue({ data: makeRecord({ status: 'finalized', version: 2 }) })
    routeGets({ draft: null, current: makeRecord({ status: 'finalized', version: 2 }) })

    expect(await record.finalizeDraft()).toBe(true)
    expect(record.hasDraft.value).toBe(false)
    expect(record.hasCurrent.value).toBe(true)
    expect(record.currentRecord.value?.status).toBe('finalized')
  })
})

// ---------------------------------------------------------------------------
// error normalisation
// ---------------------------------------------------------------------------

describe('toNtsApiError', () => {
  it('keeps the server envelope when there is one', () => {
    const normalised = toNtsApiError(apiError(422, 'nts_clinical_validation', ['a', 'b']))
    expect(normalised).toEqual({
      status: 422,
      code: 'nts_clinical_validation',
      message: 'a',
      errors: ['a', 'b']
    })
  })

  it('degrades gracefully when the transport failed before the API answered', () => {
    const normalised = toNtsApiError(new Error('Network Error'))
    expect(normalised.status).toBeNull()
    expect(normalised.code).toBeNull()
    expect(normalised.errors).toEqual(['Network Error'])
  })
})
