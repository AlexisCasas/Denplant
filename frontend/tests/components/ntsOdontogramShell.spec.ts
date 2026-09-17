/**
 * NTS-05A — shell behaviour, profile switching and the legacy-panel boundary.
 *
 * §38 profile switch, §39 legacy Original semantics, §40 no confirm-all,
 * §41 no geometry. The data layer itself is covered by
 * `ntsOdontogramRecord.spec.ts`.
 *
 * Module-layer files are imported by relative path: `frontend/module_layers`
 * does not resolve on this Windows host, so the layer's auto-imports are
 * unavailable in the test environment.
 */

import { mockNuxtImport, mountSuspended } from '@nuxt/test-utils/runtime'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { defineComponent, h, nextTick } from 'vue'

import OdontogramProfileView from '../../../backend/app/modules/odontogram/frontend/components/odontogram/OdontogramProfileView.vue'
import NtsOdontogramShell from '../../../backend/app/modules/odontogram/frontend/components/odontogram/NtsOdontogramShell.vue'
import { useOdontogramProfile } from '../../../backend/app/modules/odontogram/frontend/composables/useOdontogramProfile'

const state = vi.hoisted(() => ({
  profile: 'original' as string,
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

const CATALOG = {
  norm_version: 'pe_nts_188_2022',
  norm_label: 'NTS N.° 188-MINSA/DGIESP-2022',
  country: 'PE',
  expected_rule_count: 38,
  rules: [],
  pending_decisions: []
}

/**
 * One router for every GET the two profiles make: the preference endpoint
 * plus the NTS reads. Keeping them in one place is what makes "did the switch
 * fire a mutation?" answerable by looking at `state.post`/`state.put` alone.
 */
function routeGets() {
  state.get.mockImplementation(async (url: string) => {
    if (url === '/api/v1/odontogram/preferences') return { data: { profile: state.profile } }
    if (url.includes('/nts/catalogs/')) return { data: CATALOG }
    if (url.endsWith('/current')) return { data: null }
    if (url.endsWith('/draft')) return { data: null }
    if (url.endsWith('/nts/patients/p1/records')) {
      return { data: [], total: 0, page: 1, page_size: 20 }
    }
    throw new Error(`unrouted GET ${url}`)
  })
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

beforeEach(async () => {
  state.profile = 'original'
  state.get.mockReset()
  state.post.mockReset()
  state.put.mockReset()
  routeGets()
  const api = await runInSetup(() => useOdontogramProfile())
  api.reset()
})

afterEach(async () => {
  while (mounted.length) mounted.pop()?.unmount()
  await nextTick()
})

// ---------------------------------------------------------------------------
// the shell itself
// ---------------------------------------------------------------------------

describe('NtsOdontogramShell', () => {
  async function mountShell() {
    const wrapper = await mountSuspended(NtsOdontogramShell, {
      props: { patientId: 'p1', normVersion: 'pe_nts_188_2022' }
    })
    mounted.push(wrapper)
    await settle()
    return wrapper
  }

  it('loads the catalog and the patient state on mount', async () => {
    const wrapper = await mountShell()

    const urls = state.get.mock.calls.map(([url]) => url as string)
    expect(urls).toContain('/api/v1/odontogram/nts/catalogs/pe_nts_188_2022')
    expect(urls).toContain('/api/v1/odontogram/nts/patients/p1/records/current')
    expect(urls).toContain('/api/v1/odontogram/nts/patients/p1/records/draft')
    expect(wrapper.find('[data-testid="nts-odontogram-shell"]').exists()).toBe(true)
  })

  it('renders the official dental layout in place of the old pending region', async () => {
    const wrapper = await mountShell()

    expect(wrapper.find('[data-testid="nts-chart-pending"]').exists()).toBe(false)
    expect(wrapper.find('[data-testid="nts-odontogram-chart"]').exists()).toBe(true)
    expect(wrapper.findAll('[data-fdi]')).toHaveLength(52)
  })

  it('still says the finding renderer is pending — the chart is layout only', async () => {
    const wrapper = await mountShell()
    // The layout existing is not the odontogram being finished.
    expect(wrapper.text()).toContain('Finding rendering pending')
  })

  it('mounting never mutates: no POST is issued on load', async () => {
    await mountShell()
    expect(state.post).not.toHaveBeenCalled()
  })
})

// ---------------------------------------------------------------------------
// NTS-05B §31 — which record the chart stands for
// ---------------------------------------------------------------------------

/** A record shaped like the API returns one, minimal for chart purposes. */
function chartRecord(overrides: Record<string, unknown> = {}) {
  return {
    id: 'rec-1',
    clinic_id: 'clinic-a',
    patient_id: 'p1',
    norm_version: 'pe_nts_188_2022',
    stage: 'diagnosis',
    stage_label: null,
    status: 'draft',
    version: 3,
    observations: null,
    recorded_at: '2026-01-02T10:00:00Z',
    recorded_by: 'u1',
    finalized_at: null,
    finalized_by: null,
    discarded_at: null,
    discarded_by: null,
    discard_reason: null,
    recorded_by_name: null,
    recorded_by_role: null,
    recorded_by_professional_id: null,
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

describe('NTS-05B §31 — chart / shell integration', () => {
  function routeRecords(options: { current?: unknown, draft?: unknown }) {
    state.get.mockImplementation(async (url: string) => {
      if (url === '/api/v1/odontogram/preferences') return { data: { profile: state.profile } }
      if (url.includes('/nts/catalogs/')) return { data: CATALOG }
      if (url.endsWith('/current')) return { data: options.current ?? null }
      if (url.endsWith('/draft')) return { data: options.draft ?? null }
      if (url.endsWith('/nts/patients/p1/records')) {
        return { data: [], total: 0, page: 1, page_size: 20 }
      }
      throw new Error(`unrouted GET ${url}`)
    })
  }

  async function mountShell() {
    const wrapper = await mountSuspended(NtsOdontogramShell, {
      props: { patientId: 'p1', normVersion: 'pe_nts_188_2022' }
    })
    mounted.push(wrapper)
    await settle()
    return wrapper
  }

  it('an open draft is what the chart stands for, and it is not read-only', async () => {
    routeRecords({
      draft: chartRecord({ id: 'draft-1' }),
      current: chartRecord({ id: 'cur-1', status: 'finalized' })
    })

    const wrapper = await mountShell()
    const chart = wrapper.find('[data-testid="nts-odontogram-chart"]')

    expect(chart.exists()).toBe(true)
    expect(chart.attributes('data-readonly')).toBe('false')
    expect(wrapper.find('[data-testid="nts-chart-readonly"]').exists()).toBe(false)
    expect(wrapper.find('[data-testid="nts-chart-no-record"]').exists()).toBe(false)
  })

  it('with no draft, the record in force is shown read-only', async () => {
    routeRecords({ current: chartRecord({ id: 'cur-1', status: 'finalized' }) })

    const wrapper = await mountShell()
    const chart = wrapper.find('[data-testid="nts-odontogram-chart"]')

    expect(chart.attributes('data-readonly')).toBe('true')
    expect(wrapper.find('[data-testid="nts-chart-readonly"]').exists()).toBe(true)
    expect(wrapper.find('[data-testid="nts-chart-no-record"]').exists()).toBe(false)
  })

  it('with neither, the structure is shown and explicitly not a record', async () => {
    routeRecords({})

    const wrapper = await mountShell()

    expect(wrapper.findAll('[data-fdi]')).toHaveLength(52)
    expect(wrapper.find('[data-testid="nts-chart-no-record"]').exists()).toBe(true)
    // Nothing was fabricated to fill the gap.
    expect(state.post).not.toHaveBeenCalled()
  })

  it('findings on the shown record are surfaced, never silently omitted', async () => {
    routeRecords({
      draft: chartRecord({
        findings: [
          { id: 'f1', record_id: 'rec-1', norm_version: 'pe_nts_188_2022', rule_id: 'x', attributes: {}, provenance: 'observed', source_finding_id: null, sequence: 1, created_at: '', created_by: 'u1', targets: [] }
        ]
      })
    })

    const wrapper = await mountShell()
    expect(wrapper.find('[data-testid="nts-chart-findings-pending"]').exists()).toBe(true)
  })

  it('the lifecycle shell is intact around the chart', async () => {
    routeRecords({ draft: chartRecord() })

    const wrapper = await mountShell()

    expect(wrapper.find('[data-testid="nts-norm-label"]').exists()).toBe(true)
    expect(wrapper.find('[data-testid="nts-draft"]').exists()).toBe(true)
    expect(wrapper.find('[data-testid="nts-finalize-draft"]').exists()).toBe(true)
    expect(wrapper.find('[data-testid="nts-discard-draft"]').exists()).toBe(true)
  })
})

// ---------------------------------------------------------------------------
// NTS-05C — the structured finding editor, seen from the shell
// ---------------------------------------------------------------------------

describe('NTS-05C — finding editor integration', () => {
  function editorFinding(overrides: Record<string, unknown> = {}) {
    return {
      id: 'f1',
      record_id: 'rec-1',
      norm_version: 'pe_nts_188_2022',
      rule_id: '6.1.20',
      attributes: {},
      provenance: 'observed',
      source_finding_id: null,
      sequence: 1,
      created_at: '2026-01-02T10:00:00Z',
      created_by: 'u1',
      targets: [{
        id: 't1',
        group_index: 0,
        position: 0,
        participation: 'subject',
        role: null,
        target_kind: 'fdi_tooth',
        tooth_number: 16,
        arch: null,
        local_ordinal: null,
        geometry: null
      }],
      ...overrides
    }
  }

  /** A catalog with one rule of each shape the editor must handle. */
  const EDITOR_CATALOG = {
    ...CATALOG,
    rules: [
      {
        rule_id: '6.1.20',
        ordinal: 20,
        official_name: 'Pieza dentaria ausente',
        scope: 'tooth',
        target_identity: 'numbered',
        anchor: null,
        arch_cardinality: null,
        range_grouping: null,
        attributes: [],
        target_roles: [],
        specification_requirement: null,
        status: 'verified'
      },
      {
        rule_id: '6.1.2',
        ordinal: 2,
        official_name: 'Aparato ortodóntico removible',
        scope: 'arch',
        target_identity: 'numbered',
        anchor: null,
        arch_cardinality: 'one',
        range_grouping: null,
        attributes: [],
        target_roles: [],
        specification_requirement: null,
        status: 'verified'
      }
    ]
  }

  function routeEditor(options: { current?: unknown, draft?: unknown, catalog?: unknown }) {
    state.get.mockImplementation(async (url: string) => {
      if (url === '/api/v1/odontogram/preferences') return { data: { profile: state.profile } }
      if (url.includes('/nts/catalogs/')) return { data: options.catalog ?? EDITOR_CATALOG }
      if (url.endsWith('/current')) return { data: options.current ?? null }
      if (url.endsWith('/draft')) return { data: options.draft ?? null }
      if (url.endsWith('/nts/patients/p1/records')) {
        return { data: [], total: 0, page: 1, page_size: 20 }
      }
      throw new Error(`unrouted GET ${url}`)
    })
  }

  async function mountShell() {
    const wrapper = await mountSuspended(NtsOdontogramShell, {
      props: { patientId: 'p1', normVersion: 'pe_nts_188_2022' }
    })
    mounted.push(wrapper)
    await settle()
    return wrapper
  }

  it('offers the editor over a draft and lists its findings', async () => {
    routeEditor({ draft: chartRecord({ findings: [editorFinding()] }) })

    const wrapper = await mountShell()

    expect(wrapper.find('[data-testid="nts-add-finding"]').exists()).toBe(true)
    expect(wrapper.find('[data-testid="nts-finding-list"]').exists()).toBe(true)
    // The label is resolved through the catalog, not stored on the finding.
    expect(wrapper.find('[data-testid="nts-finding-f1"]').text()).toContain('Pieza dentaria ausente')
  })

  it('a finalized record is read-only: no add, no edit, no remove, no confirm', async () => {
    routeEditor({
      current: chartRecord({ status: 'finalized', findings: [editorFinding()] })
    })

    const wrapper = await mountShell()

    expect(wrapper.find('[data-testid="nts-finding-list"]').exists()).toBe(true)
    expect(wrapper.find('[data-testid="nts-add-finding"]').exists()).toBe(false)
    expect(wrapper.find('[data-testid="nts-edit-f1"]').exists()).toBe(false)
    expect(wrapper.find('[data-testid="nts-remove-f1"]').exists()).toBe(false)
    expect(wrapper.find('[data-testid="nts-confirm-f1"]').exists()).toBe(false)
  })

  it('the chart stays inert until a rule that needs teeth is open', async () => {
    routeEditor({ draft: chartRecord() })

    const wrapper = await mountShell()

    // 52 permanent tab stops with nothing to select would be noise.
    expect(wrapper.findAll('[data-fdi][aria-pressed]')).toHaveLength(0)

    await wrapper.find('[data-testid="nts-add-finding"]').trigger('click')
    await settle()
    await wrapper.find('[data-testid="nts-rule-6.1.20"]').trigger('click')
    await settle()

    expect(wrapper.findAll('[data-fdi][aria-pressed]')).toHaveLength(52)
  })

  it('an arch-scoped rule shows an arch selector and never a tooth range', async () => {
    routeEditor({ draft: chartRecord() })

    const wrapper = await mountShell()
    await wrapper.find('[data-testid="nts-add-finding"]').trigger('click')
    await settle()
    // Chosen by scope: the component is never told which rule id this is.
    await wrapper.find('[data-testid="nts-rule-6.1.2"]').trigger('click')
    await settle()

    expect(wrapper.find('[data-testid="nts-arch-selector"]').exists()).toBe(true)
    expect(wrapper.find('[data-testid="nts-target-editor"]').attributes('data-scope')).toBe('arch')
    // Teeth are not selectable for it.
    expect(wrapper.findAll('[data-fdi][aria-pressed]')).toHaveLength(0)
  })

  it('a carried-forward finding shows its state and an individual confirm', async () => {
    routeEditor({
      draft: chartRecord({ findings: [editorFinding({ id: 'cf1', provenance: 'carried_forward' })] })
    })

    const wrapper = await mountShell()

    expect(wrapper.find('[data-testid="nts-finding-pending"]').exists()).toBe(true)
    expect(wrapper.find('[data-testid="nts-confirm-cf1"]').exists()).toBe(true)
    expect(wrapper.html()).not.toMatch(/confirmAll|confirm_all|confirm-all/)
  })

  it('an observed finding offers no confirm action', async () => {
    routeEditor({ draft: chartRecord({ findings: [editorFinding()] }) })

    const wrapper = await mountShell()

    expect(wrapper.find('[data-testid="nts-finding-pending"]').exists()).toBe(false)
    expect(wrapper.find('[data-testid="nts-confirm-f1"]').exists()).toBe(false)
  })

  it('a draft with no findings still offers the editor', async () => {
    routeEditor({ draft: chartRecord({ findings: [] }) })

    const wrapper = await mountShell()

    expect(wrapper.find('[data-testid="nts-finding-list-empty"]').exists()).toBe(true)
    expect(wrapper.find('[data-testid="nts-add-finding"]').exists()).toBe(true)
  })

  it('without a catalog the editor never appears and nothing is mutated', async () => {
    routeEditor({ draft: chartRecord(), catalog: { ...CATALOG, rules: [] } })

    const wrapper = await mountShell()

    expect(wrapper.find('[data-testid="nts-add-finding"]').exists()).toBe(false)
    expect(state.post).not.toHaveBeenCalled()
    expect(state.put).not.toHaveBeenCalled()
  })

  it('a finding whose rule the catalog no longer serves degrades to its id', async () => {
    routeEditor({
      draft: chartRecord({ findings: [editorFinding({ id: 'gone', rule_id: '9.9.9' })] })
    })

    const wrapper = await mountShell()
    const row = wrapper.find('[data-testid="nts-finding-gone"]')

    expect(row.exists()).toBe(true)
    expect(row.text()).toContain('9.9.9')
    expect(wrapper.find('[data-testid="nts-finding-unknown-rule"]').exists()).toBe(true)
  })
})

// ---------------------------------------------------------------------------
// §38 — Original -> MINSA -> Original
// ---------------------------------------------------------------------------

describe('§38 — profile switch', () => {
  async function mountView() {
    const wrapper = await mountSuspended(OdontogramProfileView, {
      props: { patientId: 'p1', mode: 'diagnosis' },
      shallow: true
    })
    mounted.push(wrapper)
    await settle()
    return wrapper
  }

  /** Which branch a freshly mounted view chose, read from the shallow stubs. */
  function rendered(wrapper: { html: () => string }): 'original' | 'nts' | 'loading' {
    const html = wrapper.html()
    if (html.includes('nts-odontogram-shell-stub')) return 'nts'
    if (html.includes('odontogram-chart-stub')) return 'original'
    return 'loading'
  }

  /**
   * Switch the stored preference, then re-enter the screen.
   *
   * The remount is not cosmetic: `shallow` only stubs the components resolved
   * on the first render, so an in-place switch back to Original would mount
   * the real `OdontogramChart`, whose layer auto-imports (`useOdontogram`) do
   * not resolve here. Remounting is also what the app does when the clinician
   * navigates back to the odontogram after changing the format.
   */
  async function switchTo(profile: string) {
    // Unmount first: the profile lives in a shared `useState`, so changing it
    // under a still-mounted view would re-render that view in place — the
    // very thing this helper exists to avoid.
    while (mounted.length) mounted.pop()?.unmount()
    await nextTick()

    const api = await runInSetup(() => useOdontogramProfile())
    expect(await api.setProfile(profile)).toBe(true)
    return await mountView()
  }

  it('round-trips without losing Original data or creating an NTS draft', async () => {
    state.put.mockImplementation(async (_url: string, body: { profile: string }) => {
      state.profile = body.profile
      return { data: { profile: body.profile } }
    })

    expect(rendered(await mountView())).toBe('original')

    // Original -> MINSA
    expect(rendered(await switchTo('pe_nts_188_2022'))).toBe('nts')

    // MINSA -> Original: the existing chart comes back, untouched.
    expect(rendered(await switchTo('original'))).toBe('original')

    // MINSA again: the shell reappears with its own data.
    expect(rendered(await switchTo('pe_nts_188_2022'))).toBe('nts')

    // The only writes in the whole round-trip are the preference PUTs that
    // NTS-02 already owned. Switching format never writes clinical data, and
    // in particular never opens a draft on the clinician's behalf.
    expect(state.post).not.toHaveBeenCalled()
    expect(state.put.mock.calls.every(([url]) => url === '/api/v1/odontogram/preferences')).toBe(true)
    expect(state.put).toHaveBeenCalledTimes(3)
  })

  it('does not delete or rewrite Original odontogram data when MINSA is selected', async () => {
    state.put.mockImplementation(async (_url: string, body: { profile: string }) => {
      state.profile = body.profile
      return { data: { profile: body.profile } }
    })

    await mountView()
    await switchTo('pe_nts_188_2022')

    const destructive = state.get.mock.calls
      .concat(state.post.mock.calls, state.put.mock.calls)
      .map(([url]) => String(url))
      .filter(url => url.includes('/odontogram/teeth') || url.includes('/odontogram/treatments'))

    expect(destructive).toEqual([])
  })
})

// ---------------------------------------------------------------------------
// §40 / §41 — what 05A deliberately does not do
// ---------------------------------------------------------------------------

/** Production NTS frontend sources (tests excluded on purpose). */
const NTS_SOURCES = [
  '../../../backend/app/modules/odontogram/frontend/types/nts.ts',
  '../../../backend/app/modules/odontogram/frontend/composables/useNtsApi.ts',
  '../../../backend/app/modules/odontogram/frontend/composables/useNtsOdontogramRecord.ts',
  '../../../backend/app/modules/odontogram/frontend/components/odontogram/NtsOdontogramShell.vue',
  '../../../backend/app/modules/odontogram/frontend/components/odontogram/OdontogramProfileView.vue',
  '../../../backend/app/modules/odontogram/frontend/utils/ntsDentition.ts',
  '../../../backend/app/modules/odontogram/frontend/components/odontogram/NtsOdontogramChart.vue',
  '../../../backend/app/modules/odontogram/frontend/components/odontogram/NtsDentitionRow.vue',
  '../../../backend/app/modules/odontogram/frontend/components/odontogram/NtsToothCell.vue'
].map(relative => ({
  relative,
  source: readFileSync(fileURLToPath(new URL(relative, import.meta.url)), 'utf8')
}))

describe('§40 — no confirm-all', () => {
  it.each(NTS_SOURCES)('$relative exposes no bulk-confirm action', ({ source }) => {
    expect(source).not.toMatch(/confirmAll|confirm_all|confirm-all/)
  })

  it('confirms one finding at a time — the editor added that, not a bulk action', () => {
    // 05C introduced per-finding confirmation, which is what the norm's
    // individual review needs. What must never appear is a bulk endpoint or
    // a "confirm everything" control.
    for (const { source } of NTS_SOURCES) {
      expect(source).not.toMatch(/confirmAll|confirm_all|confirm-all/)
    }
    const api = NTS_SOURCES.find(f => f.relative.endsWith('useNtsApi.ts'))!
    expect(api.source).toContain('/confirm')
  })
})

describe('§41 — no geometry', () => {
  it('no request built by the data layer carries geometry', async () => {
    const wrapper = await mountSuspended(NtsOdontogramShell, {
      props: { patientId: 'p1', normVersion: 'pe_nts_188_2022' }
    })
    mounted.push(wrapper)
    await settle()

    const bodies = state.post.mock.calls.map(([, body]) => JSON.stringify(body ?? {}))
    expect(bodies.every(body => !body.includes('geometry'))).toBe(true)
  })

  it('the shell captures no coordinates and adds no editable canvas/SVG', () => {
    const shell = NTS_SOURCES.find(f => f.relative.endsWith('NtsOdontogramShell.vue'))!
    expect(shell.source).not.toMatch(/<canvas|<svg|getBoundingClientRect|offsetX|clientX/)
    expect(shell.source).not.toMatch(/geometry/)
  })

  it('geometry exists in the types only as the reserved, always-null field', () => {
    const types = NTS_SOURCES.find(f => f.relative.endsWith('types/nts.ts'))!
    const occurrences = types.source.match(/geometry/g) ?? []
    expect(occurrences).toHaveLength(1)
    expect(types.source).toMatch(/GEOMETRY CONTRACT PENDING/)
  })
})

// ---------------------------------------------------------------------------
// the normative catalog is never duplicated in the frontend
// ---------------------------------------------------------------------------

describe('single source of the norm', () => {
  it.each(NTS_SOURCES)('$relative hardcodes no rule ids', ({ source }) => {
    expect(source).not.toMatch(/6\.1\.\d/)
  })

  it.each(NTS_SOURCES)('$relative stores no clinical data in the browser', ({ source }) => {
    // Matches actual use (`localStorage.setItem`, `window.sessionStorage[...]`),
    // not the prose in the file headers explaining why there is none.
    expect(source).not.toMatch(/\b(?:localStorage|sessionStorage|indexedDB)\s*[.[]/)
  })
})
