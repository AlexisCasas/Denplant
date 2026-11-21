/**
 * NtsCurrentFindingsPanel — the read-only reference to the diagnosis in force,
 * shown on the treatment-plan screen.
 *
 * Module-layer files are imported by relative path: `frontend/module_layers`
 * does not resolve on this Windows host, so the layer's auto-imports are
 * unavailable in the test environment. Host auto-imports are doubled through
 * `mockNuxtImport`.
 *
 * The catalog is the real one, read from disk, so the names and attribute
 * labels asserted here come from the norm and not from the test.
 */

import { mockNuxtImport, mountSuspended } from '@nuxt/test-utils/runtime'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { defineComponent, h, nextTick } from 'vue'

import NtsCurrentFindingsPanel from '../../../backend/app/modules/odontogram/frontend/components/odontogram/NtsCurrentFindingsPanel.vue'
import { useOdontogramProfile } from '../../../backend/app/modules/odontogram/frontend/composables/useOdontogramProfile'

const state = vi.hoisted(() => ({
  profile: 'pe_nts_188_2022' as string,
  get: vi.fn(),
  post: vi.fn(),
  put: vi.fn(),
  patch: vi.fn(),
  granted: new Set<string>(['odontogram.read'])
}))

mockNuxtImport('useApi', () => () => ({
  get: state.get,
  post: state.post,
  put: state.put,
  patch: state.patch
}))

mockNuxtImport('useClinicState', () => () => ({
  currentClinic: { get value() { return { id: 'clinic-a' } } }
}))

mockNuxtImport('usePermissions', () => () => ({
  can: (permission: string) => state.granted.has(permission)
}))

const REAL_CATALOG = JSON.parse(
  readFileSync(
    resolve(process.cwd(), '../backend/app/modules/odontogram/nts/catalog/pe_nts_188_2022.json'),
    'utf8'
  )
)

const NORM = 'pe_nts_188_2022'
const PREFERENCES = '/api/v1/odontogram/preferences'
const CURRENT = '/api/v1/odontogram/nts/patients/p1/records/current'

function ruleName(ruleId: string): string {
  return REAL_CATALOG.rules.find((r: { rule_id: string }) => r.rule_id === ruleId).official_name
}

let seq = 0
function target(tooth: number | null, over: Record<string, unknown> = {}) {
  seq += 1
  return {
    id: `t-${seq}`,
    group_index: 0,
    position: 0,
    participation: 'subject',
    role: null,
    target_kind: tooth === null ? 'arch' : 'fdi_tooth',
    tooth_number: tooth,
    arch: null,
    local_ordinal: null,
    geometry: null,
    ...over
  }
}

function finding(id: string, ruleId: string, targets: unknown[], over: Record<string, unknown> = {}) {
  return {
    id,
    record_id: 'v1',
    norm_version: NORM,
    rule_id: ruleId,
    attributes: {},
    provenance: 'observed',
    source_finding_id: null,
    sequence: 1,
    created_at: '2026-01-02T10:00:00Z',
    created_by: 'u1',
    targets,
    ...over
  }
}

function record(findings: unknown[] = [], over: Record<string, unknown> = {}) {
  return {
    id: 'v1',
    clinic_id: 'clinic-a',
    patient_id: 'p1',
    norm_version: NORM,
    stage: 'diagnosis',
    stage_label: null,
    status: 'finalized',
    version: 3,
    observations: null,
    recorded_at: '2026-01-02T10:00:00Z',
    recorded_by: 'u1',
    finalized_at: '2026-01-02T11:00:00Z',
    finalized_by: 'u1',
    discarded_at: null,
    discarded_by: null,
    discard_reason: null,
    recorded_by_name: 'Dra. Ruiz',
    recorded_by_role: 'dentist',
    recorded_by_professional_id: 'COP-1',
    supersedes_record_id: null,
    supersession_reason: null,
    content_hash: 'abc',
    hash_algorithm: 'sha256',
    canonicalization_version: 1,
    created_at: '2026-01-02T10:00:00Z',
    updated_at: '2026-01-02T11:00:00Z',
    findings,
    specifications: [],
    ...over
  }
}

function route(options: { current?: unknown, catalog?: unknown } = {}) {
  state.get.mockImplementation(async (url: string) => {
    if (url === PREFERENCES) return { data: { profile: state.profile } }
    if (url.includes('/nts/catalogs/')) return { data: options.catalog ?? REAL_CATALOG }
    if (url === CURRENT) return { data: options.current ?? null }
    throw new Error(`unrouted GET ${url}`)
  })
}

function nts(): string[] {
  return state.get.mock.calls
    .map(([url]) => url as string)
    .filter(url => url.startsWith('/api/v1/odontogram/nts'))
}

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

async function settle() {
  await nextTick()
  await new Promise(resolve => setTimeout(resolve, 0))
  await nextTick()
  await new Promise(resolve => setTimeout(resolve, 0))
  await nextTick()
}

const mounted: Array<{ unmount: () => void }> = []

async function panel(patientId = 'p1') {
  const wrapper = await mountSuspended(NtsCurrentFindingsPanel, { props: { patientId } })
  mounted.push(wrapper)
  await settle()
  return wrapper
}

beforeEach(async () => {
  seq = 0
  state.profile = NORM
  state.granted = new Set(['odontogram.read'])
  for (const fn of [state.get, state.post, state.put, state.patch]) fn.mockReset()
  route()
  const profile = await runInSetup(() => useOdontogramProfile())
  profile.reset()
})

afterEach(async () => {
  while (mounted.length) mounted.pop()?.unmount()
  await nextTick()
})

const PANEL = '[data-testid="nts-findings-panel"]'
const rowOf = (w: { find: (s: string) => { text: () => string } }, id: string) =>
  w.find(`[data-testid="nts-findings-panel-row-${id}"]`)

const location = (w: { find: (s: string) => { text: () => string } }, id: string) =>
  rowOf(w, id).find('[data-testid="nts-findings-panel-location"]').text()

describe('NtsCurrentFindingsPanel — when it exists at all', () => {
  it('renders nothing and asks for nothing under the Original profile', async () => {
    state.profile = 'original'
    route({ current: record([finding('f1', '6.1.3', [target(44)])]) })
    const wrapper = await panel()

    expect(wrapper.find(PANEL).exists()).toBe(false)
    expect(nts()).toEqual([])
  })

  it('renders nothing and asks for nothing without odontogram.read', async () => {
    state.granted = new Set()
    route({ current: record([finding('f1', '6.1.3', [target(44)])]) })
    const wrapper = await panel()

    expect(wrapper.find(PANEL).exists()).toBe(false)
    expect(wrapper.text()).toBe('')
    expect(nts()).toEqual([])
  })

  it('asks for nothing without a patient', async () => {
    const wrapper = await panel('')

    expect(wrapper.find(PANEL).exists()).toBe(false)
    expect(nts()).toEqual([])
  })
})

describe('NtsCurrentFindingsPanel — loading and the record in force', () => {
  it('shows a skeleton while the record is in flight', async () => {
    let release: (value: unknown) => void = () => {}
    state.get.mockImplementation(async (url: string) => {
      if (url === PREFERENCES) return { data: { profile: NORM } }
      if (url === CURRENT) {
        return await new Promise((resolve) => {
          release = resolve
        })
      }
      if (url.includes('/nts/catalogs/')) return { data: REAL_CATALOG }
      throw new Error(`unrouted GET ${url}`)
    })
    const wrapper = await panel()

    expect(wrapper.find('[data-testid="nts-findings-panel-loading"]').exists()).toBe(true)
    release({ data: record([finding('f1', '6.1.3', [target(44)])]) })
    await settle()
    expect(wrapper.find('[data-testid="nts-findings-panel-loading"]').exists()).toBe(false)
    expect(wrapper.find('[data-testid="nts-findings-panel-list"]').exists()).toBe(true)
  })

  it('lists the findings of the current finalized record, by name', async () => {
    route({
      current: record([
        finding('f1', '6.1.3', [target(44)]),
        finding('f2', '6.1.16', [target(36)], { sequence: 2 })
      ])
    })
    const wrapper = await panel()

    expect(wrapper.find('[data-testid="nts-findings-panel-count"]').text()).toBe('2')
    expect(rowOf(wrapper, 'f1').text()).toContain(ruleName('6.1.3'))
    expect(rowOf(wrapper, 'f2').text()).toContain(ruleName('6.1.16'))
    expect(wrapper.find('[data-testid="nts-findings-panel-date"]').text()).toContain('Latest diagnosis:')
  })

  it('asks only for the current record: no draft, no history', async () => {
    route({ current: record([finding('f1', '6.1.3', [target(44)])]) })
    await panel()

    expect(nts()).toEqual([CURRENT, `/api/v1/odontogram/nts/catalogs/${NORM}`])
    expect(state.get).toHaveBeenCalledWith(
      CURRENT,
      expect.objectContaining({ query: { norm_version: NORM } })
    )
  })

  it('reads the record under ITS norm, not the profile\'s', async () => {
    route({ current: record([finding('f1', '6.1.3', [target(44)])], { norm_version: 'pe_nts_999_2099' }) })
    await panel()

    expect(nts()).toContain('/api/v1/odontogram/nts/catalogs/pe_nts_999_2099')
    expect(nts()).not.toContain(`/api/v1/odontogram/nts/catalogs/${NORM}`)
  })

  it('says so when the current record has no findings', async () => {
    route({ current: record([]) })
    const wrapper = await panel()

    expect(wrapper.find('[data-testid="nts-findings-panel-empty"]').text())
      .toBe('The current diagnosis records no findings.')
    expect(wrapper.find('[data-testid="nts-findings-panel-count"]').text()).toBe('0')
  })

  it('says so when there is no finalized diagnosis, and fetches no catalog', async () => {
    route({ current: null })
    const wrapper = await panel()

    expect(wrapper.find('[data-testid="nts-findings-panel-none"]').text())
      .toBe('There is no finalized diagnosis yet.')
    expect(nts()).toEqual([CURRENT])
  })
})

describe('NtsCurrentFindingsPanel — location comes from the targets', () => {
  it('tooth, pair, range, arch and surface each read the structured targets', async () => {
    route({
      current: record([
        finding('tooth', '6.1.3', [target(44)], { sequence: 1 }),
        finding('surface', '6.1.16', [target(36)], {
          sequence: 2,
          attributes: { caries_type: 'CE', surfaces: ['O'] }
        }),
        finding('pair', '6.1.6', [target(11), target(21, { position: 1 })], { sequence: 3 }),
        finding('range', '6.1.1', [
          target(13, { position: 0 }),
          target(21, { position: 1 }),
          target(23, { position: 2 })
        ], { sequence: 4 }),
        finding('arch', '6.1.7', [target(null, { arch: 'upper' })], { sequence: 5 })
      ])
    })
    const wrapper = await panel()

    expect(location(wrapper, 'tooth')).toBe('44')
    expect(location(wrapper, 'surface')).toBe('36')
    expect(location(wrapper, 'pair')).toBe('11 + 21')
    expect(location(wrapper, 'range')).toContain('13 → 23')
    expect(location(wrapper, 'arch')).toBe('Upper')
  })

  it('a surface stays an attribute, resolved through the catalog', async () => {
    route({
      current: record([
        finding('surface', '6.1.16', [target(36)], {
          attributes: { caries_type: 'CE', surfaces: ['O'] }
        })
      ])
    })
    const wrapper = await panel()

    const attributes = rowOf(wrapper, 'surface').find('[data-testid="nts-findings-panel-attributes"]').text()
    expect(attributes).toContain('Oclusal/Incisal')
    expect(attributes).toContain('Lesión de caries dental a nivel del esmalte')
    // The location is the tooth alone: no surface is spliced into it.
    expect(location(wrapper, 'surface')).toBe('36')
  })

  it('a finding with no attributes renders no attribute line', async () => {
    route({ current: record([finding('f1', '6.1.6', [target(11), target(21, { position: 1 })])]) })
    const wrapper = await panel()

    expect(rowOf(wrapper, 'f1').find('[data-testid="nts-findings-panel-attributes"]').exists()).toBe(false)
  })
})

describe('NtsCurrentFindingsPanel — deterministic order', () => {
  it('orders findings by sequence without mutating what the API returned', async () => {
    const findings = [
      finding('third', '6.1.3', [target(13)], { sequence: 3 }),
      finding('first', '6.1.3', [target(11)], { sequence: 1 }),
      finding('second', '6.1.3', [target(12)], { sequence: 2 })
    ]
    route({ current: record(findings) })
    const wrapper = await panel()

    const ids = wrapper.findAll('[data-testid^="nts-findings-panel-row-"]').map(r => r.attributes('data-testid'))
    expect(ids).toEqual([
      'nts-findings-panel-row-first',
      'nts-findings-panel-row-second',
      'nts-findings-panel-row-third'
    ])
    expect(findings.map(f => f.id)).toEqual(['third', 'first', 'second'])
  })

  it('orders targets by group_index then position before describing them', async () => {
    const targets = [
      target(23, { group_index: 0, position: 2 }),
      target(13, { group_index: 0, position: 0 }),
      target(21, { group_index: 0, position: 1 })
    ]
    const pair = [
      target(26, { group_index: 0, position: 1 }),
      target(16, { group_index: 0, position: 0 })
    ]
    route({
      current: record([
        finding('range', '6.1.1', targets, { sequence: 1 }),
        finding('pair', '6.1.6', pair, { sequence: 2 })
      ])
    })
    const wrapper = await panel()

    expect(rowOf(wrapper, 'range').find('[data-testid="nts-findings-panel-location"]').text()).toContain('13 → 23')
    expect(rowOf(wrapper, 'pair').find('[data-testid="nts-findings-panel-location"]').text()).toBe('16 + 26')
    // The arrays the API handed over keep their original order.
    expect(targets.map(t => t.tooth_number)).toEqual([23, 13, 21])
  })

  it('group_index decides before position', async () => {
    const targets = [
      target(26, { group_index: 1, position: 0 }),
      target(16, { group_index: 0, position: 5 })
    ]
    route({ current: record([finding('pair', '6.1.6', targets)]) })
    const wrapper = await panel()

    expect(rowOf(wrapper, 'pair').find('[data-testid="nts-findings-panel-location"]').text()).toBe('16 + 26')
  })
})

describe('NtsCurrentFindingsPanel — failure stays in the panel', () => {
  it('a failed record read shows a retryable, non-blocking alert', async () => {
    state.get.mockImplementation(async (url: string) => {
      if (url === PREFERENCES) return { data: { profile: NORM } }
      if (url === CURRENT) throw { statusCode: 500, data: { message: 'boom' } }
      throw new Error(`unrouted GET ${url}`)
    })
    const wrapper = await panel()

    expect(wrapper.find('[data-testid="nts-findings-panel-error"]').exists()).toBe(true)
    expect(wrapper.find('[data-testid="nts-findings-panel-list"]').exists()).toBe(false)

    route({ current: record([finding('f1', '6.1.3', [target(44)])]) })
    await wrapper.find('[data-testid="nts-findings-panel-retry"]').trigger('click')
    await settle()

    expect(wrapper.find('[data-testid="nts-findings-panel-error"]').exists()).toBe(false)
    expect(rowOf(wrapper, 'f1').text()).toContain(ruleName('6.1.3'))
  })

  it('a failed catalog is an error: no other norm, no rule ids in its place', async () => {
    state.get.mockImplementation(async (url: string) => {
      if (url === PREFERENCES) return { data: { profile: NORM } }
      if (url === CURRENT) {
        return { data: record([finding('f1', '6.1.3', [target(44)])], { norm_version: 'pe_nts_999_2099' }) }
      }
      if (url.includes('/nts/catalogs/')) throw { statusCode: 404, data: { code: 'nts_norm_version_unknown' } }
      throw new Error(`unrouted GET ${url}`)
    })
    const wrapper = await panel()

    expect(wrapper.find('[data-testid="nts-findings-panel-error"]').exists()).toBe(true)
    expect(wrapper.find('[data-testid="nts-findings-panel-list"]').exists()).toBe(false)
    expect(wrapper.text()).not.toContain('6.1.3')
    // Exactly one catalog was tried: the record's. No fallback to the profile's.
    expect(nts().filter(url => url.includes('/catalogs/'))).toEqual([
      '/api/v1/odontogram/nts/catalogs/pe_nts_999_2099'
    ])
  })

  it('a rule missing from a loaded catalog degrades that row to its id, with a notice', async () => {
    route({
      current: record([
        finding('known', '6.1.3', [target(44)], { sequence: 1 }),
        finding('stale', '9.9.9', [target(11)], { sequence: 2 })
      ])
    })
    const wrapper = await panel()

    expect(rowOf(wrapper, 'known').text()).toContain(ruleName('6.1.3'))
    expect(rowOf(wrapper, 'stale').find('[data-testid="nts-findings-panel-name"]').text()).toBe('9.9.9')
    expect(rowOf(wrapper, 'stale').find('[data-testid="nts-findings-panel-unknown-rule"]').exists()).toBe(true)
    expect(rowOf(wrapper, 'known').find('[data-testid="nts-findings-panel-unknown-rule"]').exists()).toBe(false)
  })
})

describe('NtsCurrentFindingsPanel — another patient', () => {
  it('clears the previous patient at once and ignores a late answer for them', async () => {
    let releaseFirst: (value: unknown) => void = () => {}
    state.get.mockImplementation(async (url: string) => {
      if (url === PREFERENCES) return { data: { profile: NORM } }
      if (url.includes('/nts/catalogs/')) return { data: REAL_CATALOG }
      if (url === CURRENT) {
        return { data: record([finding('first-patient', '6.1.3', [target(11)])]) }
      }
      if (url === '/api/v1/odontogram/nts/patients/p2/records/current') {
        return { data: record([finding('second-patient', '6.1.3', [target(22)])], { patient_id: 'p2' }) }
      }
      throw new Error(`unrouted GET ${url}`)
    })
    // p1's answer is held back so it can arrive after p2's.
    const original = state.get.getMockImplementation()!
    state.get.mockImplementation(async (url: string, ...rest: unknown[]) => {
      if (url === CURRENT) {
        return await new Promise((resolve) => {
          releaseFirst = resolve
        })
      }
      return await original(url, ...rest)
    })

    const wrapper = await panel('p1')
    expect(wrapper.find('[data-testid="nts-findings-panel-loading"]').exists()).toBe(true)

    await wrapper.setProps({ patientId: 'p2' })
    await settle()
    expect(rowOf(wrapper, 'second-patient').exists()).toBe(true)

    releaseFirst({ data: record([finding('first-patient', '6.1.3', [target(11)])]) })
    await settle()

    expect(wrapper.find('[data-testid="nts-findings-panel-row-first-patient"]').exists()).toBe(false)
    expect(rowOf(wrapper, 'second-patient').exists()).toBe(true)
  })

  it('shows nothing of the previous patient while the next one loads', async () => {
    route({ current: record([finding('first-patient', '6.1.3', [target(11)])]) })
    const wrapper = await panel('p1')
    expect(rowOf(wrapper, 'first-patient').exists()).toBe(true)

    state.get.mockImplementation(async (url: string) => {
      if (url === PREFERENCES) return { data: { profile: NORM } }
      return await new Promise(() => {})
    })
    await wrapper.setProps({ patientId: 'p2' })
    await nextTick()

    expect(wrapper.find('[data-testid="nts-findings-panel-row-first-patient"]').exists()).toBe(false)
    expect(wrapper.find('[data-testid="nts-findings-panel-loading"]').exists()).toBe(true)
  })
})

describe('NtsCurrentFindingsPanel — read-only', () => {
  it('never writes, and offers no control beyond retry', async () => {
    route({
      current: record([
        finding('f1', '6.1.3', [target(44)]),
        finding('carried', '6.1.3', [target(45)], { sequence: 2, provenance: 'carried_forward' })
      ])
    })
    const wrapper = await panel()

    expect(state.post).not.toHaveBeenCalled()
    expect(state.put).not.toHaveBeenCalled()
    expect(state.patch).not.toHaveBeenCalled()
    expect(wrapper.findAll('button')).toHaveLength(0)
    expect(wrapper.find('[data-testid="nts-findings-panel-pending"]').exists()).toBe(false)
  })
})
