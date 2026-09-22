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
import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { defineComponent, h, nextTick } from 'vue'

import OdontogramProfileView from '../../../backend/app/modules/odontogram/frontend/components/odontogram/OdontogramProfileView.vue'
import NtsOdontogramShell from '../../../backend/app/modules/odontogram/frontend/components/odontogram/NtsOdontogramShell.vue'
import { useOdontogramProfile } from '../../../backend/app/modules/odontogram/frontend/composables/useOdontogramProfile'
import { useNtsUnsavedChanges } from '../../../backend/app/modules/odontogram/frontend/composables/useNtsUnsavedChanges'

const state = vi.hoisted(() => ({
  profile: 'original' as string,
  get: vi.fn(),
  post: vi.fn(),
  put: vi.fn(),
  patch: vi.fn()
}))

mockNuxtImport('useApi', () => () => ({
  get: state.get,
  post: state.post,
  put: state.put,
  patch: state.patch
}))

/**
 * The real 38 rules, for the one test that needs a sigla to overflow.
 *
 * Resolved from the working directory: `import.meta.url` is not always a
 * file: URL under the Nuxt test runtime.
 */
const REAL_CATALOG = JSON.parse(
  readFileSync(
    resolve(process.cwd(), '../backend/app/modules/odontogram/nts/catalog/pe_nts_188_2022.json'),
    'utf8'
  )
)

/**
 * Capture the route-leave guard the shell registers.
 *
 * There is no router in this environment, so the real `onBeforeRouteLeave`
 * would silently do nothing and the guard would be untestable. Doubling it
 * keeps the handler reachable and lets a test ask it the question the router
 * would.
 */
const routeGuard = vi.hoisted(() => ({ handler: null as null | (() => unknown) }))
mockNuxtImport('onBeforeRouteLeave', () => (fn: () => unknown) => {
  routeGuard.handler = fn
})

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
  state.patch.mockReset()
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
// MANUAL-QA-05C — the target of a saved finding must be reachable from the UI
// ---------------------------------------------------------------------------

/**
 * Reproduces the defect manual QA found on the migrated database: a saved
 * finding could be re-opened and its attributes changed, but its tooth could
 * not, because nothing on screen could make the chart selectable again.
 */
describe('MANUAL-QA-05C — retargeting a saved finding from the UI', () => {
  const TOOTH_RULE = {
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
  }

  const RETARGET_CATALOG = { ...CATALOG, rules: [TOOTH_RULE] }

  function savedFinding() {
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
        id: 't1', group_index: 0, position: 0, participation: 'subject', role: null,
        target_kind: 'fdi_tooth', tooth_number: 16, arch: null, local_ordinal: null, geometry: null
      }]
    }
  }

  function routeRetarget() {
    state.get.mockImplementation(async (url: string) => {
      if (url === '/api/v1/odontogram/preferences') return { data: { profile: state.profile } }
      if (url.includes('/nts/catalogs/')) return { data: RETARGET_CATALOG }
      if (url.endsWith('/current')) return { data: null }
      if (url.endsWith('/draft')) return { data: chartRecord({ findings: [savedFinding()] }) }
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

  it('opens the editor with the chart inert, then offers a way to change it', async () => {
    routeRetarget()
    const wrapper = await mountShell()

    await wrapper.find('[data-testid="nts-edit-f1"]').trigger('click')
    await settle()

    // The stored target is shown...
    expect(wrapper.find('[data-testid="nts-selected-teeth"]').text()).toContain('16')
    // ...and the chart is inert, so a stray click cannot move the finding.
    expect(wrapper.findAll('[data-fdi][aria-pressed]')).toHaveLength(0)

    // This control is what was missing entirely.
    const change = wrapper.find('[data-testid="nts-retarget-subject"]')
    expect(change.exists()).toBe(true)

    await change.trigger('click')
    await settle()
    expect(wrapper.findAll('[data-fdi][aria-pressed]')).toHaveLength(52)
  })

  it('a click then moves the finding to the new tooth, locally only', async () => {
    routeRetarget()
    const wrapper = await mountShell()

    await wrapper.find('[data-testid="nts-edit-f1"]').trigger('click')
    await settle()
    await wrapper.find('[data-testid="nts-retarget-subject"]').trigger('click')
    await settle()
    await wrapper.find('[data-testid="nts-tooth-26"]').trigger('click')
    await settle()

    expect(wrapper.find('[data-testid="nts-selected-teeth"]').text()).toContain('26')
    expect(wrapper.find('[data-testid="nts-selected-teeth"]').text()).not.toContain('16')
    // Nothing is persisted until Save.
    expect(state.put).not.toHaveBeenCalled()
    expect(state.post).not.toHaveBeenCalled()
  })

  it('cancelling leaves the server untouched', async () => {
    routeRetarget()
    const wrapper = await mountShell()

    await wrapper.find('[data-testid="nts-edit-f1"]').trigger('click')
    await settle()
    await wrapper.find('[data-testid="nts-retarget-subject"]').trigger('click')
    await settle()
    await wrapper.find('[data-testid="nts-tooth-26"]').trigger('click')
    await settle()
    await wrapper.find('[data-testid="nts-editor-cancel"]').trigger('click')
    await settle()

    expect(state.put).not.toHaveBeenCalled()
    expect(state.post).not.toHaveBeenCalled()
    expect(wrapper.find('[data-testid="nts-finding-editor"]').exists()).toBe(false)
  })
})

// ---------------------------------------------------------------------------
// MANUAL-QA-05C #2 — stale role rows and Cancel, reproduced through the DOM
// ---------------------------------------------------------------------------

/**
 * The first fix passed its unit tests and still failed in the browser, so
 * these drive the real component tree: the shell renders the editor, the
 * editor renders the target panel, and every interaction is a DOM click.
 *
 * Both rules are synthetic. The role one mirrors the shape the catalog serves
 * for the fixed-bridge rule — a single `subject` role with no cardinality —
 * without the production code ever seeing a real rule id.
 */
describe('MANUAL-QA-05C #2 — role rows and Cancel through the DOM', () => {
  const RANGE_ROLE_RULE = {
    rule_id: 'X.29',
    ordinal: 29,
    official_name: 'Synthetic fixed bridge',
    scope: 'range',
    target_identity: 'numbered',
    anchor: null,
    arch_cardinality: null,
    range_grouping: 'single_segment',
    attributes: [],
    target_roles: [{
      code: 'pilar',
      name: 'Pilar',
      applies_to: 'subject',
      min_count: null,
      max_count: null,
      status: 'needs_clinical_review',
      notes: null
    }],
    specification_requirement: null,
    status: 'verified'
  }

  const TOOTH_RULE = {
    rule_id: 'X.20',
    ordinal: 20,
    official_name: 'Synthetic tooth rule',
    scope: 'tooth',
    target_identity: 'numbered',
    anchor: null,
    arch_cardinality: null,
    range_grouping: null,
    attributes: [],
    target_roles: [],
    specification_requirement: null,
    status: 'verified'
  }

  const QA_CATALOG = { ...CATALOG, rules: [TOOTH_RULE, RANGE_ROLE_RULE] }

  function findingOn(ruleId: string, teeth: number[], roles: Record<number, string> = {}) {
    return {
      id: 'f1',
      record_id: 'rec-1',
      norm_version: 'pe_nts_188_2022',
      rule_id: ruleId,
      attributes: {},
      provenance: 'observed',
      source_finding_id: null,
      sequence: 1,
      created_at: '2026-01-02T10:00:00Z',
      created_by: 'u1',
      targets: teeth.map((tooth, index) => ({
        id: `t${index}`,
        group_index: 0,
        position: index,
        participation: 'subject',
        role: roles[tooth] ?? null,
        target_kind: 'fdi_tooth',
        tooth_number: tooth,
        arch: null,
        local_ordinal: null,
        geometry: null
      }))
    }
  }

  function routeQa(finding: unknown) {
    state.get.mockImplementation(async (url: string) => {
      if (url === '/api/v1/odontogram/preferences') return { data: { profile: state.profile } }
      if (url.includes('/nts/catalogs/')) return { data: QA_CATALOG }
      if (url.endsWith('/current')) return { data: null }
      if (url.endsWith('/draft')) return { data: chartRecord({ findings: [finding] }) }
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

  type Wrapper = Awaited<ReturnType<typeof mountShell>>

  /** The teeth the role editor currently offers a control for. */
  function roleRowTeeth(wrapper: Wrapper): number[] {
    return wrapper.findAll('[data-testid^="nts-role-"]')
      .map(el => el.attributes('data-testid')!)
      .filter(id => /^nts-role-\d+$/.test(id))
      .map(id => Number(id.replace('nts-role-', '')))
  }

  /**
   * The role select of row `index`.
   *
   * Matched by DOM order rather than by test id: the id lands on the
   * component's rendered button, not on its root, and the rows are emitted in
   * `selection.teeth` order.
   */
  function roleSelect(wrapper: Wrapper, index: number) {
    return wrapper.findAllComponents({ name: 'USelectMenu' })[index]!
  }

  /** The teeth the summary says are selected. */
  function summaryTeeth(wrapper: Wrapper): number[] {
    const text = wrapper.find('[data-testid="nts-selected-teeth"]').text()
    return text.split('·').map(part => Number(part.trim())).filter(n => !Number.isNaN(n))
  }

  async function click(wrapper: Wrapper, testid: string) {
    const el = wrapper.find(`[data-testid="${testid}"]`)
    expect(el.exists(), `missing [data-testid="${testid}"]`).toBe(true)
    await el.trigger('click')
    await settle()
  }

  // --- roles ---------------------------------------------------------------

  it('C/D — after retargeting a range, the role rows follow the new teeth', async () => {
    routeQa(findingOn('X.29', [46, 45, 44, 43, 42]))
    const wrapper = await mountShell()

    await click(wrapper, 'nts-edit-f1')
    expect(roleRowTeeth(wrapper)).toEqual([46, 45, 44, 43, 42])

    await click(wrapper, 'nts-retarget-subject')
    await click(wrapper, 'nts-tooth-32')
    await click(wrapper, 'nts-tooth-37')

    // The summary and the role rows must read the same selection.
    expect(summaryTeeth(wrapper)).toEqual([32, 33, 34, 35, 36, 37])
    expect(roleRowTeeth(wrapper)).toEqual([32, 33, 34, 35, 36, 37])
    // Not one control for a tooth that is no longer part of the finding.
    for (const gone of [46, 45, 44, 43, 42]) {
      expect(roleRowTeeth(wrapper)).not.toContain(gone)
    }
  })

  it('A/B — each role control offers "no role" plus the catalog role', async () => {
    routeQa(findingOn('X.29', [46, 45]))
    const wrapper = await mountShell()

    await click(wrapper, 'nts-edit-f1')
    const control = wrapper.find('[data-testid="nts-role-46"]')
    expect(control.exists()).toBe(true)

    // A select menu renders only its current value; the offered options live
    // on the component. They must come from the catalog, in row order.
    const items = roleSelect(wrapper, 0).props('items') as Array<{ label: string, value: string }>

    expect(items.map(i => i.label)).toEqual(['No role', 'Pilar'])
    expect(items[1]!.value).toBe('pilar')
    // "No role" carries a sentinel, never an empty value: the combobox
    // underneath reserves the empty string for clearing a selection and
    // throws on an item that uses it.
    expect(items[0]!.value).not.toBe('')
    expect(wrapper.find('[data-testid="nts-roles-optional-hint"]').exists()).toBe(true)
  })

  it('E/F — a role assigned after retargeting rides only on its own tooth', async () => {
    const finding = findingOn('X.29', [46, 45, 44, 43, 42])
    routeQa(finding)
    state.put
      .mockResolvedValueOnce({ data: { record_version: 4, finding } })
      .mockResolvedValueOnce({ data: { record_version: 5, finding } })
    const wrapper = await mountShell()

    await click(wrapper, 'nts-edit-f1')
    await click(wrapper, 'nts-retarget-subject')
    await click(wrapper, 'nts-tooth-32')
    await click(wrapper, 'nts-tooth-37')
    // Row 0 is tooth 32, the first of the new span.
    expect(roleRowTeeth(wrapper)[0]).toBe(32)
    roleSelect(wrapper, 0).vm.$emit('update:modelValue', 'pilar')
    await settle()

    await click(wrapper, 'nts-editor-save')

    const [url, body] = state.put.mock.calls[1]!
    expect(url).toBe('/api/v1/odontogram/nts/records/rec-1/findings/f1/targets')
    expect(body.targets.map((t: { tooth_number: number, role: string | null }) => [t.tooth_number, t.role]))
      .toEqual([[32, 'pilar'], [33, null], [34, null], [35, null], [36, null], [37, null]])
  })

  it('a select handing back the whole option still stores a plain code', async () => {
    const finding = findingOn('X.29', [46, 45])
    routeQa(finding)
    state.put
      .mockResolvedValueOnce({ data: { record_version: 4, finding } })
      .mockResolvedValueOnce({ data: { record_version: 5, finding } })
    const wrapper = await mountShell()

    await click(wrapper, 'nts-edit-f1')
    // Some select builds report the option object rather than its value; the
    // API takes a string, so the boundary must not pass an object through.
    roleSelect(wrapper, 0).vm.$emit('update:modelValue', { label: 'Pilar', value: 'pilar' })
    await settle()
    await click(wrapper, 'nts-editor-save')

    const [, body] = state.put.mock.calls[1]!
    expect(body.targets[0].role).toBe('pilar')
    expect(typeof body.targets[0].role).toBe('string')
  })

  // --- cancel ---------------------------------------------------------------

  it.each([
    ['header', 'nts-editor-cancel'],
    ['footer', 'nts-editor-cancel-footer']
  ])('%s Cancel closes the editor and discards the local retarget', async (_where, testid) => {
    routeQa(findingOn('X.20', [16]))
    const wrapper = await mountShell()

    await click(wrapper, 'nts-edit-f1')
    await click(wrapper, 'nts-retarget-subject')
    await click(wrapper, 'nts-tooth-26')
    expect(summaryTeeth(wrapper)).toEqual([26])

    await click(wrapper, testid)

    // Panel gone, chart inert again.
    expect(wrapper.find('[data-testid="nts-finding-editor"]').exists()).toBe(false)
    expect(wrapper.findAll('[data-fdi][aria-pressed]')).toHaveLength(0)

    // Reopening without a reload shows the persisted target, not the cancelled one.
    await click(wrapper, 'nts-edit-f1')
    expect(summaryTeeth(wrapper)).toEqual([16])

    // And nothing was ever sent.
    expect(state.put).not.toHaveBeenCalled()
    expect(state.post).not.toHaveBeenCalled()
  })

  it('cancelling a retargeted range restores its persisted span and role rows', async () => {
    routeQa(findingOn('X.29', [46, 45, 44, 43, 42]))
    const wrapper = await mountShell()

    await click(wrapper, 'nts-edit-f1')
    await click(wrapper, 'nts-retarget-subject')
    await click(wrapper, 'nts-tooth-32')
    await click(wrapper, 'nts-tooth-37')
    expect(summaryTeeth(wrapper)).toEqual([32, 33, 34, 35, 36, 37])

    await click(wrapper, 'nts-editor-cancel')
    await click(wrapper, 'nts-edit-f1')

    expect(summaryTeeth(wrapper)).toEqual([46, 45, 44, 43, 42])
    expect(roleRowTeeth(wrapper)).toEqual([46, 45, 44, 43, 42])
    expect(state.put).not.toHaveBeenCalled()
  })

  it('"Done selecting" keeps the new selection and only leaves pick mode', async () => {
    routeQa(findingOn('X.20', [16]))
    const wrapper = await mountShell()

    await click(wrapper, 'nts-edit-f1')
    await click(wrapper, 'nts-retarget-subject')
    await click(wrapper, 'nts-tooth-26')
    await click(wrapper, 'nts-stop-retarget')

    // Unlike Cancel: the editor stays open with the new target ready to save.
    expect(wrapper.find('[data-testid="nts-finding-editor"]').exists()).toBe(true)
    expect(summaryTeeth(wrapper)).toEqual([26])
    expect(wrapper.findAll('[data-fdi][aria-pressed]')).toHaveLength(0)
    expect(state.put).not.toHaveBeenCalled()
  })

  it('A (regression) — the tooth path that already worked still works', async () => {
    const finding = findingOn('X.20', [16])
    routeQa(finding)
    state.put
      .mockResolvedValueOnce({ data: { record_version: 4, finding } })
      .mockResolvedValueOnce({ data: { record_version: 5, finding } })
    const wrapper = await mountShell()

    await click(wrapper, 'nts-edit-f1')
    await click(wrapper, 'nts-retarget-subject')
    await click(wrapper, 'nts-tooth-26')
    await click(wrapper, 'nts-editor-save')

    const [url, body] = state.put.mock.calls[1]!
    expect(url).toBe('/api/v1/odontogram/nts/records/rec-1/findings/f1/targets')
    expect(body.targets).toHaveLength(1)
    expect(body.targets[0].tooth_number).toBe(26)
  })
})

// ---------------------------------------------------------------------------
// MANUAL-QA-05C #3 — saving must not tear the clinical surface down
// ---------------------------------------------------------------------------

/**
 * Manual QA reported a create that looked stuck: the button stayed loading,
 * the UI crawled, the browser logged `nextSibling of null` and
 * `emitsOptions … component is null`, and a hard refresh showed the finding
 * had in fact been saved.
 *
 * The cause was structural. `reload()` called `load()`, `load()` raised
 * `isLoading`, and the shell replaces its whole clinical surface while that
 * is true — so the chart, the editor and its select popovers were unmounted
 * *during* the save and rebuilt afterwards, with `close()` unmounting the
 * editor a second time. These tests hold the refetch open and assert the
 * surface stays put.
 */
describe('MANUAL-QA-05C #3 — save, refresh and the surface', () => {
  const SAVE_RULE = {
    rule_id: 'X.40',
    ordinal: 40,
    official_name: 'Synthetic save rule',
    scope: 'tooth',
    target_identity: 'numbered',
    anchor: null,
    arch_cardinality: null,
    range_grouping: null,
    attributes: [],
    target_roles: [],
    specification_requirement: null,
    status: 'verified'
  }

  const SAVE_CATALOG = { ...CATALOG, rules: [SAVE_RULE] }

  function createdFinding() {
    return {
      id: 'new-1',
      record_id: 'rec-1',
      norm_version: 'pe_nts_188_2022',
      rule_id: 'X.40',
      attributes: {},
      provenance: 'observed',
      source_finding_id: null,
      sequence: 1,
      created_at: '2026-01-02T10:00:00Z',
      created_by: 'u1',
      targets: [{
        id: 't1', group_index: 0, position: 0, participation: 'subject', role: null,
        target_kind: 'fdi_tooth', tooth_number: 16, arch: null, local_ordinal: null, geometry: null
      }]
    }
  }

  /**
   * Routes the GETs. `phase.refetching` flips once the mutation starts, so a
   * test can hold the refresh open or make it fail without touching the
   * first load.
   */
  function routeSave(phase: { refetching: boolean, gate?: Promise<void>, fail?: boolean }) {
    let findings: unknown[] = []
    state.get.mockImplementation(async (url: string) => {
      if (phase.refetching) {
        if (phase.gate) await phase.gate
        if (phase.fail) throw new Error('offline')
        findings = [createdFinding()]
      }
      if (url === '/api/v1/odontogram/preferences') return { data: { profile: state.profile } }
      if (url.includes('/nts/catalogs/')) return { data: SAVE_CATALOG }
      if (url.endsWith('/current')) return { data: null }
      if (url.endsWith('/draft')) return { data: chartRecord({ version: 3, findings }) }
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

  type Wrapper = Awaited<ReturnType<typeof mountShell>>

  /** Open the editor and select a rule and a tooth, ready to submit. */
  async function composeFinding(wrapper: Wrapper) {
    await wrapper.find('[data-testid="nts-add-finding"]').trigger('click')
    await settle()
    await wrapper.find('[data-testid="nts-rule-X.40"]').trigger('click')
    await settle()
    await wrapper.find('[data-testid="nts-tooth-16"]').trigger('click')
    await settle()
  }

  it('§18 — a normal create issues one POST, closes the editor and lists it', async () => {
    const phase = { refetching: false }
    routeSave(phase)
    state.post.mockResolvedValue({ data: { record_version: 4, finding: createdFinding() } })

    const wrapper = await mountShell()
    await composeFinding(wrapper)
    expect(wrapper.find('[data-testid="nts-finding-list-empty"]').exists()).toBe(true)

    phase.refetching = true
    await wrapper.find('[data-testid="nts-editor-save"]').trigger('click')
    await settle()

    // Exactly one create, no retry, no duplicate.
    expect(state.post).toHaveBeenCalledTimes(1)
    expect(state.post.mock.calls[0]![0]).toBe('/api/v1/odontogram/nts/records/rec-1/findings')
    // Editor gone, list updated, nothing stuck.
    expect(wrapper.find('[data-testid="nts-finding-editor"]').exists()).toBe(false)
    expect(wrapper.find('[data-testid="nts-finding-new-1"]').exists()).toBe(true)
    expect(wrapper.find('[data-testid="nts-refresh-failed"]').exists()).toBe(false)
    expect(wrapper.find('[data-testid="nts-loading"]').exists()).toBe(false)
  })

  it('§15 — the clinical surface stays mounted while the refetch is in flight', async () => {
    let release!: () => void
    const gate = new Promise<void>((resolve) => {
      release = resolve
    })
    const phase = { refetching: false, gate }
    routeSave(phase)
    state.post.mockResolvedValue({ data: { record_version: 4, finding: createdFinding() } })

    const wrapper = await mountShell()
    await composeFinding(wrapper)

    phase.refetching = true
    void wrapper.find('[data-testid="nts-editor-save"]').trigger('click')
    await settle()

    // This is the regression: the surface used to be replaced by the loading
    // state here, unmounting the chart and the editor mid-save.
    expect(wrapper.find('[data-testid="nts-loading"]').exists()).toBe(false)
    expect(wrapper.find('[data-testid="nts-odontogram-chart"]').exists()).toBe(true)
    expect(wrapper.findAll('[data-fdi]')).toHaveLength(52)
    // The editor closed once, before the refresh — not unmounted and rebuilt.
    expect(wrapper.find('[data-testid="nts-finding-editor"]').exists()).toBe(false)
    expect(state.post).toHaveBeenCalledTimes(1)

    release()
    await settle()

    expect(wrapper.find('[data-testid="nts-finding-new-1"]').exists()).toBe(true)
    expect(wrapper.find('[data-testid="nts-odontogram-chart"]').exists()).toBe(true)
  })

  it('§16 — a create that saved but could not refresh is never reported as lost', async () => {
    const phase = { refetching: false, fail: true }
    routeSave(phase)
    state.post.mockResolvedValue({ data: { record_version: 4, finding: createdFinding() } })

    const wrapper = await mountShell()
    await composeFinding(wrapper)

    phase.refetching = true
    await wrapper.find('[data-testid="nts-editor-save"]').trigger('click')
    await settle()

    // One create only, and no way to blindly send it again.
    expect(state.post).toHaveBeenCalledTimes(1)
    expect(wrapper.find('[data-testid="nts-finding-editor"]').exists()).toBe(false)

    // The warning says the save landed and the view did not refresh.
    const warning = wrapper.find('[data-testid="nts-refresh-failed"]')
    expect(warning.exists()).toBe(true)
    expect(warning.text()).toContain('saved')
    expect(warning.text()).not.toContain('not saved')
    expect(wrapper.find('[data-testid="nts-refresh-retry"]').exists()).toBe(true)
  })

  it('§17 — retry refetches only, and never repeats the mutation', async () => {
    const phase = { refetching: false, fail: true }
    routeSave(phase)
    state.post.mockResolvedValue({ data: { record_version: 4, finding: createdFinding() } })

    const wrapper = await mountShell()
    await composeFinding(wrapper)

    phase.refetching = true
    await wrapper.find('[data-testid="nts-editor-save"]').trigger('click')
    await settle()
    expect(wrapper.find('[data-testid="nts-refresh-failed"]').exists()).toBe(true)

    const postsBefore = state.post.mock.calls.length
    const getsBefore = state.get.mock.calls.length

    phase.fail = false
    await wrapper.find('[data-testid="nts-refresh-retry"]').trigger('click')
    await settle()

    // Reads only: not one further create, update, remove or confirm.
    expect(state.post).toHaveBeenCalledTimes(postsBefore)
    expect(state.put).not.toHaveBeenCalled()
    expect(state.get.mock.calls.length).toBeGreaterThan(getsBefore)

    // Warning cleared and the server's finding is now on screen.
    expect(wrapper.find('[data-testid="nts-refresh-failed"]').exists()).toBe(false)
    expect(wrapper.find('[data-testid="nts-finding-new-1"]').exists()).toBe(true)
  })

  it('a change of patient still replaces the surface with the loading state', async () => {
    const phase = { refetching: false }
    routeSave(phase)
    const wrapper = await mountSuspended(NtsOdontogramShell, {
      props: { patientId: 'p1', normVersion: 'pe_nts_188_2022' }
    })
    mounted.push(wrapper)
    await settle()
    expect(wrapper.find('[data-testid="nts-odontogram-chart"]').exists()).toBe(true)

    // A different patient is a real load: its GETs never settle here, so the
    // previous patient's surface must be gone rather than lingering.
    state.get.mockImplementation(() => new Promise(() => {}))
    await wrapper.setProps({ patientId: 'patient-b' })
    await settle()

    expect(wrapper.find('[data-testid="nts-loading"]').exists()).toBe(true)
    expect(wrapper.find('[data-testid="nts-odontogram-chart"]').exists()).toBe(false)
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

// ---------------------------------------------------------------------------
// NTS-05E.2 — Especificaciones (§5.14) and Observaciones (§5.15) on screen
// ---------------------------------------------------------------------------

describe('NTS-05E.2 — the annex\'s two text blocks', () => {
  const mounted: Array<{ unmount: () => void }> = []
  afterEach(() => {
    mounted.forEach(w => w.unmount())
    mounted.length = 0
  })

  function record(overrides: Record<string, unknown> = {}) {
    return {
      id: 'rec-1',
      clinic_id: 'clinic-a',
      patient_id: 'p1',
      norm_version: 'pe_nts_188_2022',
      stage: 'diagnosis',
      stage_label: null,
      status: 'draft',
      version: 5,
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

  function spec(overrides: Record<string, unknown> = {}) {
    return {
      id: 'spec-1',
      record_id: 'rec-1',
      finding_id: null,
      text: 'Mancha blanca vestibular en 12',
      sequence: 1,
      ...overrides
    }
  }

  /** Route the GETs with a given draft / current record. */
  function route(options: { draft?: unknown, current?: unknown } = {}) {
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

  // --- layout -------------------------------------------------------------

  it('both blocks sit under the chart, Especificaciones first', async () => {
    // The annex prints chart → Especificaciones → Observaciones, and 05F will
    // print from this DOM, so the order is a contract rather than a layout
    // preference.
    route({ draft: record() })
    const html = (await mountShell()).html()

    const chart = html.indexOf('nts-odontogram-chart')
    const specs = html.indexOf('nts-specifications')
    const observations = html.indexOf('nts-observations')

    expect(chart).toBeGreaterThan(-1)
    expect(chart).toBeLessThan(specs)
    expect(specs).toBeLessThan(observations)
  })

  // --- specifications -----------------------------------------------------

  it('A — a draft with no entries says so and offers to add one', async () => {
    route({ draft: record() })
    const wrapper = await mountShell()

    expect(wrapper.find('[data-testid="nts-spec-empty"]').exists()).toBe(true)
    expect(wrapper.find('[data-testid="nts-spec-add"]').exists()).toBe(true)
  })

  it('G — entries render in the server\'s sequence, never the array\'s order', async () => {
    route({ draft: record({ specifications: [
      spec({ id: 'c', sequence: 3, text: 'tercera' }),
      spec({ id: 'a', sequence: 1, text: 'primera' }),
      spec({ id: 'b', sequence: 2, text: 'segunda' })
    ] }) })
    const wrapper = await mountShell()

    const rows = wrapper.findAll('[data-testid^="nts-spec-row-"]')
    expect(rows.map(r => r.text())).toEqual([
      expect.stringContaining('primera'),
      expect.stringContaining('segunda'),
      expect.stringContaining('tercera')
    ])
  })

  it('B/K — creating posts the text, and nothing appears before the server agrees', async () => {
    route({ draft: record({ version: 5 }) })
    const wrapper = await mountShell()

    await wrapper.find('[data-testid="nts-spec-add"]').trigger('click')
    await nextTick()
    const input = wrapper.find('[data-testid="nts-spec-new-input"]')
    await input.setValue('Pieza 12 con mancha blanca')

    // Nothing is inserted locally first: no optimistic row to roll back.
    expect(wrapper.findAll('[data-testid^="nts-spec-row-"]')).toHaveLength(0)

    state.post.mockResolvedValue({
      data: { record_version: 6, specification: spec() }
    })
    route({ draft: record({ version: 6, specifications: [spec()] }) })
    await wrapper.find('[data-testid="nts-spec-new-save"]').trigger('click')
    await settle()

    expect(state.post).toHaveBeenCalledWith(
      '/api/v1/odontogram/nts/records/rec-1/specifications',
      { expected_version: 5, text: 'Pieza 12 con mancha blanca', finding_id: null }
    )
    expect(wrapper.findAll('[data-testid^="nts-spec-row-"]')).toHaveLength(1)
    // The composer closed once the write landed.
    expect(wrapper.find('[data-testid="nts-spec-composer"]').exists()).toBe(false)
  })

  it('C — cancelling the composer writes nothing', async () => {
    route({ draft: record() })
    const wrapper = await mountShell()

    await wrapper.find('[data-testid="nts-spec-add"]').trigger('click')
    await nextTick()
    await wrapper.find('[data-testid="nts-spec-new-input"]').setValue('descartada')
    await wrapper.find('[data-testid="nts-spec-new-cancel"]').trigger('click')
    await nextTick()

    expect(state.post).not.toHaveBeenCalled()
    expect(wrapper.find('[data-testid="nts-spec-composer"]').exists()).toBe(false)
  })

  it('D/H — editing replaces the text and carries the finding link untouched', async () => {
    route({ draft: record({ version: 5, specifications: [spec({ finding_id: 'f-9' })] }) })
    const wrapper = await mountShell()

    await wrapper.find('[data-testid="nts-spec-edit-0"]').trigger('click')
    await nextTick()
    await wrapper.find('[data-testid="nts-spec-edit-input-0"]').setValue('texto corregido')

    state.put.mockResolvedValue({ data: { record_version: 6, specification: spec() } })
    route({ draft: record({ version: 6, specifications: [spec({ text: 'texto corregido' })] }) })
    await wrapper.find('[data-testid="nts-spec-edit-save-0"]').trigger('click')
    await settle()

    expect(state.put).toHaveBeenCalledWith(
      '/api/v1/odontogram/nts/records/rec-1/specifications/spec-1',
      { expected_version: 5, text: 'texto corregido', finding_id: 'f-9' }
    )
  })

  it('E — cancelling an edit restores the persisted text', async () => {
    route({ draft: record({ specifications: [spec({ text: 'original' })] }) })
    const wrapper = await mountShell()

    await wrapper.find('[data-testid="nts-spec-edit-0"]').trigger('click')
    await nextTick()
    await wrapper.find('[data-testid="nts-spec-edit-input-0"]').setValue('a medio escribir')
    await wrapper.find('[data-testid="nts-spec-edit-cancel-0"]').trigger('click')
    await nextTick()

    expect(state.put).not.toHaveBeenCalled()
    expect(wrapper.find('[data-testid="nts-spec-row-0"]').text()).toContain('original')
    expect(wrapper.find('[data-testid="nts-spec-row-0"]').text()).not.toContain('a medio escribir')
  })

  it('F — removing asks first, then posts to .../remove', async () => {
    route({ draft: record({ version: 5, specifications: [spec()] }) })
    const wrapper = await mountShell()

    await wrapper.find('[data-testid="nts-spec-remove-0"]').trigger('click')
    await nextTick()
    expect(state.post).not.toHaveBeenCalled()

    state.post.mockResolvedValue({ data: { record_version: 6 } })
    route({ draft: record({ version: 6, specifications: [] }) })
    // The dialog body is teleported out of the component, so it is reached
    // through the document rather than the wrapper.
    const confirm = document.querySelector('[data-testid="nts-spec-remove-confirm"]')
    expect(confirm).not.toBeNull()
    ;(confirm as HTMLElement).click()
    await settle()

    expect(state.post).toHaveBeenCalledWith(
      '/api/v1/odontogram/nts/records/rec-1/specifications/spec-1/remove',
      { expected_version: 5 }
    )
    expect(wrapper.findAll('[data-testid^="nts-spec-row-"]')).toHaveLength(0)
  })

  it('H — an entry whose finding is not loaded is still shown, neutrally', async () => {
    // Losing a clinician's text because a join failed is the one outcome that
    // may never happen.
    route({ draft: record({ specifications: [spec({ finding_id: 'ghost' })] }) })
    const wrapper = await mountShell()

    expect(wrapper.find('[data-testid="nts-spec-row-0"]').text())
      .toContain('Mancha blanca vestibular en 12')
    expect(wrapper.find('[data-testid="nts-spec-link-0"]').exists()).toBe(true)
  })

  it('I — a finalized record shows the entries and offers no actions', async () => {
    route({ current: record({ status: 'finalized', specifications: [spec()] }) })
    const wrapper = await mountShell()

    expect(wrapper.find('[data-testid="nts-spec-row-0"]').text())
      .toContain('Mancha blanca vestibular en 12')
    expect(wrapper.find('[data-testid="nts-spec-add"]').exists()).toBe(false)
    expect(wrapper.find('[data-testid="nts-spec-edit-0"]').exists()).toBe(false)
    expect(wrapper.find('[data-testid="nts-spec-remove-0"]').exists()).toBe(false)
    // Read-only is stated in words, not left to styling.
    expect(wrapper.find('[data-testid="nts-spec-readonly"]').exists()).toBe(true)
  })

  it('I — and a finalized record with none says "no specifications"', async () => {
    route({ current: record({ status: 'finalized' }) })
    const wrapper = await mountShell()

    expect(wrapper.find('[data-testid="nts-spec-empty"]').exists()).toBe(true)
    expect(wrapper.find('[data-testid="nts-spec-add"]').exists()).toBe(false)
  })

  // --- observations -------------------------------------------------------

  it('A — a draft shows the persisted observations in an editable box', async () => {
    route({ draft: record({ observations: 'Respirador bucal' }) })
    const wrapper = await mountShell()

    const input = wrapper.find('[data-testid="nts-observations-input"]')
    expect(input.exists()).toBe(true)
    expect((input.element as HTMLTextAreaElement).value).toBe('Respirador bucal')
  })

  it('B/G — typing stays local, and only a real change enables Save', async () => {
    route({ draft: record({ observations: 'original' }) })
    const wrapper = await mountShell()

    const save = wrapper.find('[data-testid="nts-observations-save"]')
    expect(save.attributes('disabled')).toBeDefined()

    await wrapper.find('[data-testid="nts-observations-input"]').setValue('cambiado')
    await nextTick()

    expect(wrapper.find('[data-testid="nts-observations-save"]').attributes('disabled'))
      .toBeUndefined()
    // Local only until Save.
    expect(state.patch).not.toHaveBeenCalled()
  })

  it('C — saving PATCHes exactly what was typed', async () => {
    route({ draft: record({ version: 5, observations: null }) })
    const wrapper = await mountShell()

    await wrapper.find('[data-testid="nts-observations-input"]').setValue('  Bruxismo nocturno  ')
    state.patch.mockResolvedValue({ data: record({ version: 6 }) })
    route({ draft: record({ version: 6, observations: 'Bruxismo nocturno' }) })
    await wrapper.find('[data-testid="nts-observations-save"]').trigger('click')
    await settle()

    expect(state.patch).toHaveBeenCalledWith(
      '/api/v1/odontogram/nts/records/rec-1',
      { expected_version: 5, observations: 'Bruxismo nocturno' }
    )
  })

  it('D — emptying the box and saving clears it with an explicit null', async () => {
    // The API reads an absent key as "leave it alone", so a clear has to be a
    // null. Omitting the field would silently keep the old text.
    route({ draft: record({ version: 5, observations: 'algo' }) })
    const wrapper = await mountShell()

    await wrapper.find('[data-testid="nts-observations-input"]').setValue('')
    state.patch.mockResolvedValue({ data: record({ version: 6 }) })
    route({ draft: record({ version: 6, observations: null }) })
    await wrapper.find('[data-testid="nts-observations-save"]').trigger('click')
    await settle()

    const [, body] = state.patch.mock.calls[0]!
    expect(body).toEqual({ expected_version: 5, observations: null })
    expect('observations' in (body as object)).toBe(true)
  })

  it('E — cancel restores the persisted text and sends nothing', async () => {
    route({ draft: record({ observations: 'persistido' }) })
    const wrapper = await mountShell()

    await wrapper.find('[data-testid="nts-observations-input"]').setValue('a medias')
    await wrapper.find('[data-testid="nts-observations-cancel"]').trigger('click')
    await nextTick()

    const input = wrapper.find('[data-testid="nts-observations-input"]')
    expect((input.element as HTMLTextAreaElement).value).toBe('persistido')
    expect(state.patch).not.toHaveBeenCalled()
  })

  it('F — a finalized record shows the text without a box or buttons', async () => {
    route({ current: record({ status: 'finalized', observations: 'Cerrado' }) })
    const wrapper = await mountShell()

    expect(wrapper.find('[data-testid="nts-observations-text"]').text()).toBe('Cerrado')
    expect(wrapper.find('[data-testid="nts-observations-input"]').exists()).toBe(false)
    expect(wrapper.find('[data-testid="nts-observations-save"]').exists()).toBe(false)
    expect(wrapper.find('[data-testid="nts-observations-readonly"]').exists()).toBe(true)
  })

  it('F — and an empty finalized block says "no observations"', async () => {
    route({ current: record({ status: 'finalized', observations: null }) })
    const wrapper = await mountShell()

    expect(wrapper.find('[data-testid="nts-observations-empty"]').exists()).toBe(true)
  })

  it('I/J — a rejected save keeps what the clinician typed', async () => {
    route({ draft: record({ version: 5, observations: 'viejo' }) })
    const wrapper = await mountShell()

    await wrapper.find('[data-testid="nts-observations-input"]').setValue('mi texto')
    state.patch.mockRejectedValue({
      statusCode: 409,
      data: { message: 'conflict', code: 'nts_version_conflict', errors: [] }
    })
    await wrapper.find('[data-testid="nts-observations-save"]').trigger('click')
    await settle()

    // The conflict is reported, the write is not retried, and the text stays.
    expect(wrapper.find('[data-testid="nts-conflict"]').exists()).toBe(true)
    expect(state.patch).toHaveBeenCalledTimes(1)
    const input = wrapper.find('[data-testid="nts-observations-input"]')
    expect((input.element as HTMLTextAreaElement).value).toBe('mi texto')
  })

  it('J — a 422 is shown and the buffer survives it too', async () => {
    route({ draft: record({ version: 5 }) })
    const wrapper = await mountShell()

    await wrapper.find('[data-testid="nts-observations-input"]').setValue('mi texto')
    state.patch.mockRejectedValue({
      statusCode: 422,
      data: { message: 'x', code: 'nts_clinical_validation', errors: ['observations too long'] }
    })
    await wrapper.find('[data-testid="nts-observations-save"]').trigger('click')
    await settle()

    expect(wrapper.find('[data-testid="nts-clinical-errors"]').text())
      .toContain('observations too long')
    const input = wrapper.find('[data-testid="nts-observations-input"]')
    expect((input.element as HTMLTextAreaElement).value).toBe('mi texto')
  })

  // --- refresh failure ----------------------------------------------------

  it('A — a write that landed is never reported as lost when the refetch fails', async () => {
    route({ draft: record({ version: 5 }) })
    const wrapper = await mountShell()

    await wrapper.find('[data-testid="nts-observations-input"]').setValue('guardado')
    state.patch.mockResolvedValue({ data: record({ version: 6 }) })
    state.get.mockRejectedValue({ statusCode: 500, data: { message: 'boom' } })
    await wrapper.find('[data-testid="nts-observations-save"]').trigger('click')
    await settle()

    expect(wrapper.find('[data-testid="nts-text-refresh-failed"]').exists()).toBe(true)
    expect(wrapper.text()).toContain('changes were saved')
  })

  it('B/D — retrying re-reads only, and the shell stays mounted', async () => {
    route({ draft: record({ version: 5 }) })
    const wrapper = await mountShell()

    await wrapper.find('[data-testid="nts-observations-input"]').setValue('guardado')
    state.patch.mockResolvedValue({ data: record({ version: 6 }) })
    state.get.mockRejectedValue({ statusCode: 500, data: { message: 'boom' } })
    await wrapper.find('[data-testid="nts-observations-save"]').trigger('click')
    await settle()

    const writesBefore = state.patch.mock.calls.length + state.post.mock.calls.length
    route({ draft: record({ version: 6, observations: 'guardado' }) })
    await wrapper.find('[data-testid="nts-text-refresh-retry"]').trigger('click')
    await settle()

    expect(state.patch.mock.calls.length + state.post.mock.calls.length).toBe(writesBefore)
    expect(wrapper.find('[data-testid="nts-text-refresh-failed"]').exists()).toBe(false)
    // Never unmounted by a background refresh.
    expect(wrapper.find('[data-testid="nts-odontogram-chart"]').exists()).toBe(true)
  })

  it('C — the two refresh failures have their own banner and their own retry', async () => {
    // One for the finding editor, one for the record's text. Sharing a banner
    // would leave a clinician pressing a retry that re-reads the wrong thing.
    route({ draft: record({ version: 5 }) })
    const wrapper = await mountShell()

    await wrapper.find('[data-testid="nts-observations-input"]').setValue('guardado')
    state.patch.mockResolvedValue({ data: record({ version: 6 }) })
    state.get.mockRejectedValue({ statusCode: 500, data: { message: 'boom' } })
    await wrapper.find('[data-testid="nts-observations-save"]').trigger('click')
    await settle()

    expect(wrapper.find('[data-testid="nts-text-refresh-failed"]').exists()).toBe(true)
    expect(wrapper.find('[data-testid="nts-text-refresh-retry"]').exists()).toBe(true)
    // The editor's own banner is a different element and is not shown here.
    expect(wrapper.find('[data-testid="nts-refresh-failed"]').exists()).toBe(false)
  })

  // --- overflow advisory --------------------------------------------------

  it('no overflow, no advisory', async () => {
    route({ draft: record() })
    const wrapper = await mountShell()

    expect(wrapper.find('[data-testid="nts-spec-overflow-advisory"]').exists()).toBe(false)
  })

  it('overflow shows an advisory that creates nothing and blames nothing', async () => {
    // Four findings on one tooth: the box holds two, so two siglas have no
    // room. The findings still exist and the wording must say so.
    const crowded = [1, 2, 3, 4].map(n => ({
      id: `f${n}`,
      record_id: 'rec-1',
      norm_version: 'pe_nts_188_2022',
      rule_id: '6.1.9',
      attributes: {},
      provenance: 'observed' as const,
      source_finding_id: null,
      sequence: n,
      created_at: '2026-01-02T10:00:00Z',
      created_by: 'u1',
      targets: [{
        id: `t${n}`, group_index: 0, position: 0, participation: 'subject', role: null,
        target_kind: 'fdi_tooth', tooth_number: 16, arch: null, local_ordinal: null, geometry: null
      }]
    }))
    state.get.mockImplementation(async (url: string) => {
      if (url === '/api/v1/odontogram/preferences') return { data: { profile: state.profile } }
      if (url.includes('/nts/catalogs/')) return { data: REAL_CATALOG }
      if (url.endsWith('/current')) return { data: null }
      if (url.endsWith('/draft')) return { data: record({ findings: crowded }) }
      if (url.endsWith('/nts/patients/p1/records')) {
        return { data: [], total: 0, page: 1, page_size: 20 }
      }
      throw new Error(`unrouted GET ${url}`)
    })
    const wrapper = await mountShell()

    const advisory = wrapper.find('[data-testid="nts-spec-overflow-advisory"]')
    expect(advisory.exists()).toBe(true)
    // Advisory, not a data rule: nothing was created and nothing was copied.
    expect(state.post).not.toHaveBeenCalled()
    expect(wrapper.findAll('[data-testid^="nts-spec-row-"]')).toHaveLength(0)
    // And it must not read as "findings were dropped".
    expect(advisory.text()).toContain('still recorded')
  })

  // --- write locking ------------------------------------------------------

  it('L — a second write cannot start while one is in flight', async () => {
    // Two writes begun from the same loaded record would both send the same
    // expected_version, and the second would 409 for no reason.
    route({ draft: record({ version: 5 }) })
    const wrapper = await mountShell()

    let release: (value: unknown) => void = () => {}
    state.patch.mockImplementation(() => new Promise((resolve) => {
      release = resolve
    }))

    await wrapper.find('[data-testid="nts-observations-input"]').setValue('primero')
    await wrapper.find('[data-testid="nts-observations-save"]').trigger('click')
    await nextTick()

    // While it is in flight the other block's action is disabled too.
    expect(wrapper.find('[data-testid="nts-spec-add"]').attributes('disabled')).toBeDefined()

    release({ data: record({ version: 6 }) })
    await settle()
  })
})

// ---------------------------------------------------------------------------
// NTS-05E.2 gate — conflict recovery refetches in place, for every mutation
// ---------------------------------------------------------------------------
//
// 05E.2 changed `recoverFromConflict` from a foreground load to a background
// one. That is a cross-cutting change: it governs finding conflicts as much as
// text conflicts. `ntsFindingEditor.spec.ts` already proves the editor's own
// half — one attempt, no retry, `onConflict` called — but it does so with a
// **mocked** `onConflict`, so it never exercised the recovery itself. These
// tests drive the real one through the shell.

describe('NTS-05E.2 gate — a 409 never tears the clinical surface down', () => {
  const mounted: Array<{ unmount: () => void }> = []
  afterEach(() => {
    mounted.forEach(w => w.unmount())
    mounted.length = 0
  })

  function gateRecord(overrides: Record<string, unknown> = {}) {
    return {
      id: 'rec-1',
      clinic_id: 'clinic-a',
      patient_id: 'p1',
      norm_version: 'pe_nts_188_2022',
      stage: 'diagnosis',
      stage_label: null,
      status: 'draft',
      version: 5,
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

  /** A finding a previous client carried forward: one click confirms it. */
  const carried = {
    id: 'f-carried',
    record_id: 'rec-1',
    norm_version: 'pe_nts_188_2022',
    rule_id: '6.1.9',
    attributes: {},
    provenance: 'carried_forward' as const,
    source_finding_id: 'older',
    sequence: 1,
    created_at: '2026-01-02T10:00:00Z',
    created_by: 'u1',
    targets: [{
      id: 't1', group_index: 0, position: 0, participation: 'subject', role: null,
      target_kind: 'fdi_tooth', tooth_number: 16, arch: null, local_ordinal: null, geometry: null
    }]
  }

  function gateRoute(draft: unknown) {
    state.get.mockImplementation(async (url: string) => {
      if (url === '/api/v1/odontogram/preferences') return { data: { profile: state.profile } }
      if (url.includes('/nts/catalogs/')) return { data: REAL_CATALOG }
      if (url.endsWith('/current')) return { data: null }
      if (url.endsWith('/draft')) return { data: draft }
      if (url.endsWith('/nts/patients/p1/records')) {
        return { data: [], total: 0, page: 1, page_size: 20 }
      }
      throw new Error(`unrouted GET ${url}`)
    })
  }

  async function gateShell() {
    const wrapper = await mountSuspended(NtsOdontogramShell, {
      props: { patientId: 'p1', normVersion: 'pe_nts_188_2022' }
    })
    mounted.push(wrapper)
    await settle()
    return wrapper
  }

  it('FINDING — confirming a carried-forward finding against a moved record', async () => {
    gateRoute(gateRecord({ findings: [carried] }))
    const wrapper = await gateShell()

    expect(wrapper.find('[data-testid="nts-odontogram-chart"]').exists()).toBe(true)
    const getsBefore = state.get.mock.calls.length

    state.post.mockRejectedValue({
      statusCode: 409,
      data: { message: 'conflict', code: 'nts_version_conflict', errors: [] }
    })
    await wrapper.find('[data-testid="nts-confirm-f-carried"]').trigger('click')
    await settle()

    // One attempt. Never re-sent with a bumped version.
    expect(state.post).toHaveBeenCalledTimes(1)
    // The recovery is a read, and it happened.
    expect(state.get.mock.calls.length).toBeGreaterThan(getsBefore)
    expect(state.put).not.toHaveBeenCalled()
    expect(state.patch).not.toHaveBeenCalled()
    // The conflict is reported.
    expect(wrapper.find('[data-testid="nts-conflict"]').exists()).toBe(true)
    // And the clinical surface is still there: no foreground skeleton swapped
    // it out and rebuilt it. This is what 05E.2's change protects.
    expect(wrapper.find('[data-testid="nts-loading"]').exists()).toBe(false)
    expect(wrapper.find('[data-testid="nts-odontogram-shell"]').exists()).toBe(true)
    expect(wrapper.find('[data-testid="nts-odontogram-chart"]').exists()).toBe(true)
    expect(wrapper.find('[data-testid="nts-finding-list"]').exists()).toBe(true)
    expect(wrapper.find('[data-testid="nts-specifications"]').exists()).toBe(true)
    expect(wrapper.find('[data-testid="nts-observations"]').exists()).toBe(true)
  })

  it('FINDING — the recovery never flashes a loading skeleton mid-flight', async () => {
    // The regression 05E.2 fixed is transient by nature: a foreground load
    // shows the skeleton only while the refetch is in flight. Holding the
    // refetch open is what makes its absence observable.
    gateRoute(gateRecord({ findings: [carried] }))
    const wrapper = await gateShell()

    let releaseRefetch: (value: unknown) => void = () => {}
    let held = false
    state.get.mockImplementation(async (url: string) => {
      if (url === '/api/v1/odontogram/preferences') return { data: { profile: state.profile } }
      if (url.includes('/nts/catalogs/')) return { data: REAL_CATALOG }
      if (url.endsWith('/current')) return { data: null }
      if (url.endsWith('/nts/patients/p1/records')) {
        return { data: [], total: 0, page: 1, page_size: 20 }
      }
      if (url.endsWith('/draft')) {
        if (held) return { data: gateRecord({ findings: [carried] }) }
        held = true
        return await new Promise((resolve) => {
          releaseRefetch = resolve
        })
      }
      throw new Error(`unrouted GET ${url}`)
    })

    state.post.mockRejectedValue({
      statusCode: 409,
      data: { message: 'conflict', code: 'nts_version_conflict', errors: [] }
    })
    await wrapper.find('[data-testid="nts-confirm-f-carried"]').trigger('click')
    await settle()

    // Mid-recovery: the surface is still mounted rather than replaced.
    expect(wrapper.find('[data-testid="nts-loading"]').exists()).toBe(false)
    expect(wrapper.find('[data-testid="nts-odontogram-chart"]').exists()).toBe(true)
    expect(wrapper.find('[data-testid="nts-observations"]').exists()).toBe(true)

    releaseRefetch({ data: gateRecord({ findings: [carried] }) })
    await settle()
    expect(wrapper.find('[data-testid="nts-odontogram-chart"]').exists()).toBe(true)
  })

  it('TEXT — an observations conflict keeps the surface and the typed text', async () => {
    gateRoute(gateRecord({ observations: 'viejo' }))
    const wrapper = await gateShell()

    await wrapper.find('[data-testid="nts-observations-input"]').setValue('lo que escribí')
    state.patch.mockRejectedValue({
      statusCode: 409,
      data: { message: 'conflict', code: 'nts_version_conflict', errors: [] }
    })
    await wrapper.find('[data-testid="nts-observations-save"]').trigger('click')
    await settle()

    expect(state.patch).toHaveBeenCalledTimes(1)
    expect(wrapper.find('[data-testid="nts-conflict"]').exists()).toBe(true)
    expect(wrapper.find('[data-testid="nts-loading"]').exists()).toBe(false)
    expect(wrapper.find('[data-testid="nts-odontogram-chart"]').exists()).toBe(true)

    const input = wrapper.find('[data-testid="nts-observations-input"]')
    expect((input.element as HTMLTextAreaElement).value).toBe('lo que escribí')
  })

  it('TEXT — a specification conflict keeps the composer text too', async () => {
    gateRoute(gateRecord())
    const wrapper = await gateShell()

    await wrapper.find('[data-testid="nts-spec-add"]').trigger('click')
    await nextTick()
    await wrapper.find('[data-testid="nts-spec-new-input"]').setValue('mi especificación')

    state.post.mockRejectedValue({
      statusCode: 409,
      data: { message: 'conflict', code: 'nts_version_conflict', errors: [] }
    })
    await wrapper.find('[data-testid="nts-spec-new-save"]').trigger('click')
    await settle()

    expect(state.post).toHaveBeenCalledTimes(1)
    expect(wrapper.find('[data-testid="nts-conflict"]').exists()).toBe(true)
    expect(wrapper.find('[data-testid="nts-loading"]').exists()).toBe(false)

    // The composer is still open with the text in it: a rejected write must
    // not cost the clinician what they typed.
    const input = wrapper.find('[data-testid="nts-spec-new-input"]')
    expect(input.exists()).toBe(true)
    expect((input.element as HTMLTextAreaElement).value).toBe('mi especificación')
  })

  it('PATIENT CHANGE — a real context change is still a foreground load', async () => {
    // Navigation is not a refresh. A different patient must replace the
    // surface rather than leave the previous patient's record on screen while
    // the new one loads.
    gateRoute(gateRecord())
    const wrapper = await gateShell()
    expect(wrapper.find('[data-testid="nts-odontogram-chart"]').exists()).toBe(true)

    state.get.mockImplementation(() => new Promise(() => {}))
    await wrapper.setProps({ patientId: 'patient-b' })
    await settle()

    expect(wrapper.find('[data-testid="nts-loading"]').exists()).toBe(true)
    expect(wrapper.find('[data-testid="nts-odontogram-chart"]').exists()).toBe(false)
    expect(wrapper.find('[data-testid="nts-specifications"]').exists()).toBe(false)
  })
})

// ---------------------------------------------------------------------------
// NTS-05E.3 — record history and historical norm-version resolution
// ---------------------------------------------------------------------------
//
// The rule this section exists to enforce: **a record is read under the norm
// it was written in**. The active profile decides what a *new* record would
// be created under and nothing else. Before 05E.3 the history list happened
// to be filtered by the profile's norm, so every listed record matched the
// one loaded catalog — a correctness guarantee resting on a filter rather
// than on anything stated.

describe('NTS-05E.3 — history and historical catalogs', () => {
  const mounted: Array<{ unmount: () => void }> = []
  afterEach(() => {
    mounted.forEach(w => w.unmount())
    mounted.length = 0
  })

  /** A second norm this build also serves, with its own rule for 6.1.9. */
  const CATALOG_B = {
    ...REAL_CATALOG,
    norm_version: 'pe_nts_999_2099',
    norm_label: 'NTS N.° 999 (later norm)'
  }

  function histRecord(overrides: Record<string, unknown> = {}) {
    return {
      id: 'rec-hist',
      clinic_id: 'clinic-a',
      patient_id: 'p1',
      norm_version: 'pe_nts_188_2022',
      stage: 'diagnosis',
      stage_label: null,
      status: 'finalized',
      version: 3,
      observations: null,
      recorded_at: '2026-05-02T10:00:00Z',
      recorded_by: 'u1',
      finalized_at: '2026-05-02T11:00:00Z',
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
      created_at: '2026-05-02T10:00:00Z',
      updated_at: '2026-05-02T11:00:00Z',
      findings: [],
      specifications: [],
      ...overrides
    }
  }

  function summary(overrides: Record<string, unknown> = {}) {
    return {
      id: 'rec-hist',
      patient_id: 'p1',
      norm_version: 'pe_nts_188_2022',
      stage: 'diagnosis',
      stage_label: null,
      status: 'finalized',
      version: 3,
      recorded_at: '2026-05-02T10:00:00Z',
      finalized_at: '2026-05-02T11:00:00Z',
      discarded_at: null,
      supersedes_record_id: null,
      content_hash: 'abc',
      is_superseded: false,
      ...overrides
    }
  }

  /**
   * Route every GET. `records` answers the by-id reads, `catalogs` the
   * per-version ones, so a test can make one version fail or arrive late.
   */
  function histRoute(options: {
    draft?: unknown
    current?: unknown
    summaries?: unknown[]
    records?: Record<string, unknown>
    catalogs?: Record<string, unknown | (() => Promise<unknown>)>
  } = {}) {
    const catalogs = options.catalogs ?? { pe_nts_188_2022: REAL_CATALOG }
    state.get.mockImplementation(async (url: string) => {
      if (url === '/api/v1/odontogram/preferences') return { data: { profile: state.profile } }
      if (url.includes('/nts/catalogs/')) {
        const version = url.split('/nts/catalogs/')[1]!
        const entry = catalogs[version]
        if (entry === undefined) throw apiErrorLike(404, 'nts_norm_version_unknown')
        return { data: typeof entry === 'function' ? await entry() : entry }
      }
      if (url.includes('/records/current')) return { data: options.current ?? null }
      if (url.includes('/records/draft')) return { data: options.draft ?? null }
      if (url.endsWith('/nts/patients/p1/records')) {
        const rows = options.summaries ?? []
        return { data: rows, total: rows.length, page: 1, page_size: 20 }
      }
      const byId = url.match(/\/nts\/records\/([^/?]+)$/)
      if (byId) {
        const found = options.records?.[byId[1]!]
        if (found === undefined) throw apiErrorLike(404, 'nts_record_not_found')
        return { data: typeof found === 'function' ? await (found as () => Promise<unknown>)() : found }
      }
      throw new Error(`unrouted GET ${url}`)
    })
  }

  function apiErrorLike(status: number, code: string) {
    return { statusCode: status, data: { message: code, code, errors: [] } }
  }

  async function histShell() {
    const wrapper = await mountSuspended(NtsOdontogramShell, {
      props: { patientId: 'p1', normVersion: 'pe_nts_188_2022' }
    })
    mounted.push(wrapper)
    await settle()
    return wrapper
  }

  // --- the list ------------------------------------------------------------

  it('LIST — the history is asked for without a norm filter', async () => {
    histRoute({ summaries: [summary()] })
    await histShell()

    const listCall = state.get.mock.calls.find(
      ([url]) => (url as string).endsWith('/nts/patients/p1/records')
    )!
    const query = (listCall[1] as { query: Record<string, unknown> }).query
    // A clinical history does not shrink because the clinic changed norm.
    expect(query.norm_version).toBeUndefined()
  })

  it('LIST — a record written under another norm is listed, and says so', async () => {
    histRoute({
      summaries: [summary({ id: 'other', norm_version: 'pe_nts_999_2099' })],
      catalogs: { pe_nts_188_2022: REAL_CATALOG }
    })
    const wrapper = await histShell()

    expect(wrapper.find('[data-testid="nts-history-open-0"]').exists()).toBe(true)
    expect(wrapper.find('[data-testid="nts-history-norm-0"]').text()).toBe('pe_nts_999_2099')
  })

  it('LIST — a record under the profile\'s own norm is not labelled', async () => {
    histRoute({ summaries: [summary()] })
    const wrapper = await histShell()
    expect(wrapper.find('[data-testid="nts-history-norm-0"]').exists()).toBe(false)
  })

  // --- the wrong-catalog guard, which is the point of this ticket -----------

  it('GUARD — a historical record is read under ITS norm, never the profile\'s', async () => {
    histRoute({
      summaries: [summary({ id: 'rec-b', norm_version: 'pe_nts_999_2099' })],
      records: { 'rec-b': histRecord({ id: 'rec-b', norm_version: 'pe_nts_999_2099' }) },
      catalogs: { pe_nts_188_2022: REAL_CATALOG, pe_nts_999_2099: CATALOG_B }
    })
    const wrapper = await histShell()

    await wrapper.find('[data-testid="nts-history-open-0"]').trigger('click')
    await settle()

    // The later norm's catalog was fetched, and it is the one on the chart.
    const fetched = state.get.mock.calls
      .map(([url]) => url as string)
      .filter(url => url.includes('/nts/catalogs/'))
    expect(fetched.some(url => url.endsWith('pe_nts_999_2099'))).toBe(true)
    expect(wrapper.find('[data-testid="nts-norm-label"]').exists()).toBe(true)
    expect(wrapper.find('[data-testid="nts-historical-banner"]').exists()).toBe(true)
    expect(wrapper.find('[data-testid="nts-odontogram-chart"]').exists()).toBe(true)
  })

  it('GUARD — if that norm cannot be served, NOTHING is drawn under another', async () => {
    // The failure mode this ticket exists to prevent: rendering a record's
    // findings against rules it was never recorded under.
    histRoute({
      summaries: [summary({ id: 'rec-b', norm_version: 'pe_nts_999_2099' })],
      records: { 'rec-b': histRecord({ id: 'rec-b', norm_version: 'pe_nts_999_2099' }) },
      catalogs: { pe_nts_188_2022: REAL_CATALOG }
    })
    const wrapper = await histShell()

    await wrapper.find('[data-testid="nts-history-open-0"]').trigger('click')
    await settle()

    expect(wrapper.find('[data-testid="nts-historical-catalog-error"]').exists()).toBe(true)
    // No chart at all — not a chart drawn from the profile's catalog.
    expect(wrapper.find('[data-testid="nts-odontogram-chart"]').exists()).toBe(false)
    // The record's own metadata is still readable.
    expect(wrapper.find('[data-testid="nts-historical-catalog-error"]').text())
      .toContain('pe_nts_999_2099')
  })

  it('GUARD — retrying the catalog is a GET, and writes nothing', async () => {
    let servedB = false
    histRoute({
      summaries: [summary({ id: 'rec-b', norm_version: 'pe_nts_999_2099' })],
      records: { 'rec-b': histRecord({ id: 'rec-b', norm_version: 'pe_nts_999_2099' }) },
      catalogs: {
        pe_nts_188_2022: REAL_CATALOG,
        get pe_nts_999_2099() {
          if (!servedB) {
            servedB = true
            throw apiErrorLike(503, 'unavailable')
          }
          return CATALOG_B
        }
      } as Record<string, unknown>
    })
    const wrapper = await histShell()

    await wrapper.find('[data-testid="nts-history-open-0"]').trigger('click')
    await settle()
    expect(wrapper.find('[data-testid="nts-historical-catalog-error"]').exists()).toBe(true)

    await wrapper.find('[data-testid="nts-historical-catalog-retry"]').trigger('click')
    await settle()

    expect(wrapper.find('[data-testid="nts-historical-catalog-error"]').exists()).toBe(false)
    expect(wrapper.find('[data-testid="nts-odontogram-chart"]').exists()).toBe(true)
    expect(state.post).not.toHaveBeenCalled()
    expect(state.put).not.toHaveBeenCalled()
    expect(state.patch).not.toHaveBeenCalled()
  })

  // --- races ---------------------------------------------------------------

  it('RACE — opening B while A is in flight ends on B', async () => {
    let releaseA: (value: unknown) => void = () => {}
    histRoute({
      summaries: [
        summary({ id: 'rec-a', stage_label: 'A' }),
        summary({ id: 'rec-b', stage_label: 'B' })
      ],
      records: {
        'rec-a': () => new Promise((resolve) => {
          releaseA = resolve
        }),
        'rec-b': histRecord({ id: 'rec-b', observations: 'soy B' })
      }
    })
    const wrapper = await histShell()

    await wrapper.find('[data-testid="nts-history-open-0"]').trigger('click')
    await wrapper.find('[data-testid="nts-history-open-1"]').trigger('click')
    await settle()

    // B landed first and is what is shown.
    expect(wrapper.find('[data-testid="nts-observations-text"]').text()).toBe('soy B')

    // A's late answer must not install itself over it.
    releaseA(histRecord({ id: 'rec-a', observations: 'soy A' }))
    await settle()
    expect(wrapper.find('[data-testid="nts-observations-text"]').text()).toBe('soy B')
  })

  it('RACE — a late catalog for A cannot be paired with record B', async () => {
    // The dangerous half of the same race: record and catalog are installed
    // together and checked against one token, so they can never disagree.
    let releaseCatalogA: (value: unknown) => void = () => {}
    histRoute({
      summaries: [
        summary({ id: 'rec-a', norm_version: 'pe_nts_777_2077' }),
        summary({ id: 'rec-b', norm_version: 'pe_nts_999_2099' })
      ],
      records: {
        'rec-a': histRecord({ id: 'rec-a', norm_version: 'pe_nts_777_2077', observations: 'soy A' }),
        'rec-b': histRecord({ id: 'rec-b', norm_version: 'pe_nts_999_2099', observations: 'soy B' })
      },
      catalogs: {
        pe_nts_188_2022: REAL_CATALOG,
        pe_nts_777_2077: () => new Promise((resolve) => {
          releaseCatalogA = resolve
        }),
        pe_nts_999_2099: CATALOG_B
      }
    })
    const wrapper = await histShell()

    await wrapper.find('[data-testid="nts-history-open-0"]').trigger('click')
    await wrapper.find('[data-testid="nts-history-open-1"]').trigger('click')
    await settle()

    expect(wrapper.find('[data-testid="nts-observations-text"]').text()).toBe('soy B')

    releaseCatalogA({ ...REAL_CATALOG, norm_version: 'pe_nts_777_2077' })
    await settle()

    // Still B, still drawn: A's catalog never reached the screen.
    expect(wrapper.find('[data-testid="nts-observations-text"]').text()).toBe('soy B')
    expect(wrapper.find('[data-testid="nts-odontogram-chart"]').exists()).toBe(true)
  })

  // --- read-only -----------------------------------------------------------

  it('READONLY — a historical record offers no write of any kind', async () => {
    const carried = {
      id: 'f-c', record_id: 'rec-hist', norm_version: 'pe_nts_188_2022',
      rule_id: '6.1.9', attributes: {}, provenance: 'carried_forward' as const,
      source_finding_id: 'older', sequence: 1,
      created_at: '2026-05-02T10:00:00Z', created_by: 'u1',
      targets: [{
        id: 't', group_index: 0, position: 0, participation: 'subject', role: null,
        target_kind: 'fdi_tooth', tooth_number: 16, arch: null, local_ordinal: null, geometry: null
      }]
    }
    histRoute({
      summaries: [summary()],
      records: { 'rec-hist': histRecord({
        findings: [carried],
        specifications: [{ id: 's1', record_id: 'rec-hist', finding_id: null, text: 'histórica', sequence: 1 }],
        observations: 'observación histórica'
      }) }
    })
    const wrapper = await histShell()

    await wrapper.find('[data-testid="nts-history-open-0"]').trigger('click')
    await settle()

    // No finding writes.
    expect(wrapper.find('[data-testid="nts-add-finding"]').exists()).toBe(false)
    expect(wrapper.find('[data-testid="nts-confirm-f-c"]').exists()).toBe(false)
    expect(wrapper.find('[data-testid="nts-edit-f-c"]').exists()).toBe(false)
    expect(wrapper.find('[data-testid="nts-remove-f-c"]').exists()).toBe(false)
    // No text writes.
    expect(wrapper.find('[data-testid="nts-spec-add"]').exists()).toBe(false)
    expect(wrapper.find('[data-testid="nts-observations-input"]').exists()).toBe(false)
    // No lifecycle writes.
    expect(wrapper.find('[data-testid="nts-finalize-draft"]').exists()).toBe(false)
    expect(wrapper.find('[data-testid="nts-discard-draft"]').exists()).toBe(false)
    // And it says what it is, rather than leaving an empty bar to interpret.
    expect(wrapper.find('[data-testid="nts-historical-banner"]').exists()).toBe(true)
  })

  it('READONLY — even a historical record whose status is draft', async () => {
    // A draft in the history is still not the draft this shell is editing.
    histRoute({
      summaries: [summary({ status: 'draft', finalized_at: null })],
      records: { 'rec-hist': histRecord({ status: 'draft', finalized_at: null, content_hash: null }) }
    })
    const wrapper = await histShell()

    await wrapper.find('[data-testid="nts-history-open-0"]').trigger('click')
    await settle()

    expect(wrapper.find('[data-testid="nts-spec-add"]').exists()).toBe(false)
    expect(wrapper.find('[data-testid="nts-observations-input"]').exists()).toBe(false)
    expect(wrapper.find('[data-testid="nts-add-finding"]').exists()).toBe(false)
  })

  it('TEXT — a historical record shows its own specifications and observations', async () => {
    histRoute({
      summaries: [summary()],
      records: { 'rec-hist': histRecord({
        specifications: [
          { id: 's2', record_id: 'rec-hist', finding_id: null, text: 'segunda', sequence: 2 },
          { id: 's1', record_id: 'rec-hist', finding_id: null, text: 'primera', sequence: 1 }
        ],
        observations: 'lo que se observó entonces'
      }) }
    })
    const wrapper = await histShell()

    await wrapper.find('[data-testid="nts-history-open-0"]').trigger('click')
    await settle()

    expect(wrapper.findAll('[data-testid^="nts-spec-row-"]').map(r => r.text()))
      .toEqual([expect.stringContaining('primera'), expect.stringContaining('segunda')])
    expect(wrapper.find('[data-testid="nts-observations-text"]').text())
      .toBe('lo que se observó entonces')
    // Order preserved: chart, then specifications, then observations.
    const html = wrapper.html()
    expect(html.indexOf('nts-specifications')).toBeLessThan(html.indexOf('nts-observations'))
  })

  // --- returning -----------------------------------------------------------

  it('RETURN — going back restores the current record, its catalog and editing', async () => {
    histRoute({
      draft: histRecord({ id: 'rec-draft', status: 'draft', finalized_at: null, content_hash: null, observations: 'borrador' }),
      summaries: [summary({ id: 'rec-b', norm_version: 'pe_nts_999_2099' })],
      records: { 'rec-b': histRecord({ id: 'rec-b', norm_version: 'pe_nts_999_2099', observations: 'histórico' }) },
      catalogs: { pe_nts_188_2022: REAL_CATALOG, pe_nts_999_2099: CATALOG_B }
    })
    const wrapper = await histShell()

    // The draft is editable to begin with.
    expect(wrapper.find('[data-testid="nts-observations-input"]').exists()).toBe(true)

    await wrapper.find('[data-testid="nts-history-open-0"]').trigger('click')
    await settle()
    expect(wrapper.find('[data-testid="nts-observations-text"]').text()).toBe('histórico')

    await wrapper.find('[data-testid="nts-historical-return"]').trigger('click')
    await settle()

    // Back to the draft: editable again, and no historical state left over.
    expect(wrapper.find('[data-testid="nts-historical-banner"]').exists()).toBe(false)
    const input = wrapper.find('[data-testid="nts-observations-input"]')
    expect(input.exists()).toBe(true)
    expect((input.element as HTMLTextAreaElement).value).toBe('borrador')
    // Nothing was created to get back.
    expect(state.post).not.toHaveBeenCalled()
  })

  // --- failure of the record itself ---------------------------------------

  it('ERROR — a failed history read never replaces the current record', async () => {
    histRoute({
      draft: histRecord({ id: 'rec-draft', status: 'draft', finalized_at: null, content_hash: null, observations: 'borrador' }),
      summaries: [summary({ id: 'missing' })],
      records: {}
    })
    const wrapper = await histShell()

    await wrapper.find('[data-testid="nts-history-open-0"]').trigger('click')
    await settle()

    expect(wrapper.find('[data-testid="nts-historical-error"]').exists()).toBe(true)
    // The current draft is still loaded underneath, not discarded.
    await wrapper.find('[data-testid="nts-historical-return"]').trigger('click')
    await settle()
    const input = wrapper.find('[data-testid="nts-observations-input"]')
    expect((input.element as HTMLTextAreaElement).value).toBe('borrador')
  })

  // --- status indicators ---------------------------------------------------

  it('STATUS — discarded and superseded records are listed and marked', async () => {
    histRoute({
      summaries: [
        summary({ id: 'd', status: 'discarded', discarded_at: '2026-06-01T10:00:00Z', finalized_at: null, content_hash: null }),
        summary({ id: 's', is_superseded: true })
      ],
      records: {
        d: histRecord({ id: 'd', status: 'discarded', finalized_at: null, content_hash: null, discard_reason: 'duplicado' })
      }
    })
    const wrapper = await histShell()

    // Neither is hidden: clinical history stays history.
    expect(wrapper.findAll('[data-testid^="nts-history-open-"]')).toHaveLength(2)
    expect(wrapper.find('[data-testid="nts-history-status-0"]').text().length).toBeGreaterThan(0)
    expect(wrapper.find('[data-testid="nts-history-superseded-1"]').exists()).toBe(true)

    await wrapper.find('[data-testid="nts-history-open-0"]').trigger('click')
    await settle()
    // Opened read-only, with no restore offered.
    expect(wrapper.find('[data-testid="nts-historical-banner"]').exists()).toBe(true)
    expect(wrapper.find('[data-testid="nts-spec-add"]').exists()).toBe(false)
  })

  // --- accessibility -------------------------------------------------------

  it('A11Y — plain buttons with aria-current, not a false listbox', async () => {
    // 05E.3 shipped `listbox`/`option` with a button inside each option, which
    // is invalid ARIA and promised an arrow-key model that did not exist.
    // 05E.4 chose the markup that matches the real interaction: activate one
    // of several controls, reachable by Tab, named by `aria-current`.
    histRoute({
      summaries: [summary()],
      records: { 'rec-hist': histRecord() }
    })
    const wrapper = await histShell()

    expect(wrapper.find('[data-testid="nts-history-list"]').attributes('role')).toBeUndefined()
    expect(wrapper.findAll('[role="option"]')).toHaveLength(0)

    const row = wrapper.find('[data-testid="nts-history-open-0"]')
    expect(row.element.tagName).toBe('BUTTON')
    expect(row.attributes('aria-current')).toBeUndefined()

    await row.trigger('click')
    await settle()

    expect(wrapper.find('[data-testid="nts-history-open-0"]').attributes('aria-current')).toBe('true')
    // Not colour alone: the open row says so in words.
    expect(wrapper.find('[data-testid="nts-history-open-marker-0"]').exists()).toBe(true)
  })

  // --- caching -------------------------------------------------------------

  it('CACHE — one download per norm version, keyed by version alone', async () => {
    histRoute({
      summaries: [
        summary({ id: 'one' }),
        summary({ id: 'two' })
      ],
      records: { one: histRecord({ id: 'one' }), two: histRecord({ id: 'two' }) }
    })
    const wrapper = await histShell()

    const before = state.get.mock.calls.filter(
      ([url]) => (url as string).includes('/nts/catalogs/')
    ).length

    await wrapper.find('[data-testid="nts-history-open-0"]').trigger('click')
    await settle()
    await wrapper.find('[data-testid="nts-history-open-1"]').trigger('click')
    await settle()

    const after = state.get.mock.calls.filter(
      ([url]) => (url as string).includes('/nts/catalogs/')
    ).length
    // Both records cite the norm already loaded, so nothing was re-fetched.
    expect(after).toBe(before)
  })
})

// ---------------------------------------------------------------------------
// NTS-05E.4 — the phase, end to end
// ---------------------------------------------------------------------------
//
// One record, one `version`, many editors. These integrate what the earlier
// slices built in isolation, and pin the two things that only appear when
// they run together: a write from one family while another holds the record,
// and navigation away from text nobody has saved.

describe('NTS-05E.4 — lifecycle and history, integrated', () => {
  const mounted: Array<{ unmount: () => void }> = []
  afterEach(() => {
    mounted.forEach(w => w.unmount())
    mounted.length = 0
  })

  const carried = (id = 'f-c') => ({
    id, record_id: 'rec-1', norm_version: 'pe_nts_188_2022', rule_id: '6.1.9',
    attributes: {}, provenance: 'carried_forward' as const, source_finding_id: 'older',
    sequence: 1, created_at: '2026-01-02T10:00:00Z', created_by: 'u1',
    targets: [{
      id: `t-${id}`, group_index: 0, position: 0, participation: 'subject', role: null,
      target_kind: 'fdi_tooth', tooth_number: 16, arch: null, local_ordinal: null, geometry: null
    }]
  })

  function rec(overrides: Record<string, unknown> = {}) {
    return {
      id: 'rec-1', clinic_id: 'clinic-a', patient_id: 'p1',
      norm_version: 'pe_nts_188_2022', stage: 'diagnosis', stage_label: null,
      status: 'draft', version: 7, observations: null,
      recorded_at: '2026-01-02T10:00:00Z', recorded_by: 'u1',
      finalized_at: null, finalized_by: null, discarded_at: null, discarded_by: null,
      discard_reason: null, recorded_by_name: 'Dra. Ruiz', recorded_by_role: 'dentist',
      recorded_by_professional_id: 'COP-1', supersedes_record_id: null,
      supersession_reason: null, content_hash: null, hash_algorithm: null,
      canonicalization_version: null, created_at: '2026-01-02T10:00:00Z',
      updated_at: '2026-01-02T10:00:00Z', findings: [], specifications: [],
      ...overrides
    }
  }

  function route(options: { draft?: unknown, current?: unknown, summaries?: unknown[], records?: Record<string, unknown> } = {}) {
    state.get.mockImplementation(async (url: string) => {
      if (url === '/api/v1/odontogram/preferences') return { data: { profile: state.profile } }
      if (url.includes('/nts/catalogs/')) return { data: REAL_CATALOG }
      if (url.includes('/records/current')) return { data: options.current ?? null }
      if (url.includes('/records/draft')) return { data: options.draft ?? null }
      if (url.endsWith('/nts/patients/p1/records')) {
        const rows = options.summaries ?? []
        return { data: rows, total: rows.length, page: 1, page_size: 20 }
      }
      const byId = url.match(/\/nts\/records\/([^/?]+)$/)
      if (byId && options.records?.[byId[1]!]) return { data: options.records[byId[1]!] }
      throw new Error(`unrouted GET ${url}`)
    })
  }

  async function shell(patientId = 'p1') {
    const wrapper = await mountSuspended(NtsOdontogramShell, {
      props: { patientId, normVersion: 'pe_nts_188_2022' }
    })
    mounted.push(wrapper)
    await settle()
    return wrapper
  }

  // --- B: the record-wide serialization guard ------------------------------

  it('B — CRITICAL: two mutation families cannot send the same version', async () => {
    // Observations and carry-forward confirmation are different components
    // with different busy flags, and both bump the same `version`. Before
    // 05E.4 both read the loaded record and both sent expected_version: 7.
    route({ draft: rec({ findings: [carried()] }) })
    const wrapper = await shell()

    let releasePatch: (value: unknown) => void = () => {}
    state.patch.mockImplementation(() => new Promise((resolve) => {
      releasePatch = resolve
    }))

    await wrapper.find('[data-testid="nts-observations-input"]').setValue('texto')
    await wrapper.find('[data-testid="nts-observations-save"]').trigger('click')
    await nextTick()

    // The other family is visibly unavailable, and refuses even if clicked.
    expect(wrapper.find('[data-testid="nts-confirm-f-c"]').attributes('disabled')).toBeDefined()
    await wrapper.find('[data-testid="nts-confirm-f-c"]').trigger('click')
    await settle()
    expect(state.post).not.toHaveBeenCalled()

    // The lock lifts once the first write and its refetch are done.
    route({ draft: rec({ version: 8, observations: 'texto', findings: [carried()] }) })
    releasePatch({ data: rec({ version: 8 }) })
    await settle()
    expect(wrapper.find('[data-testid="nts-confirm-f-c"]').attributes('disabled')).toBeUndefined()
  })

  it('B — and the guard covers the refetch, not just the request', async () => {
    // Between the server answering and the refresh landing, the loaded record
    // still carries the old version. A write started there would be stale.
    route({ draft: rec({ findings: [carried()] }) })
    const wrapper = await shell()

    let releaseRefetch: (value: unknown) => void = () => {}
    state.patch.mockResolvedValue({ data: rec({ version: 8 }) })
    state.get.mockImplementation(async (url: string) => {
      if (url === '/api/v1/odontogram/preferences') return { data: { profile: state.profile } }
      if (url.includes('/nts/catalogs/')) return { data: REAL_CATALOG }
      if (url.includes('/records/current')) return { data: null }
      if (url.endsWith('/nts/patients/p1/records')) return { data: [], total: 0, page: 1, page_size: 20 }
      if (url.includes('/records/draft')) {
        return await new Promise((resolve) => {
          releaseRefetch = resolve
        })
      }
      throw new Error(`unrouted GET ${url}`)
    })

    await wrapper.find('[data-testid="nts-observations-input"]').setValue('texto')
    await wrapper.find('[data-testid="nts-observations-save"]').trigger('click')
    await settle()

    // Mid-refetch: still locked.
    expect(wrapper.find('[data-testid="nts-confirm-f-c"]').attributes('disabled')).toBeDefined()
    releaseRefetch({ data: rec({ version: 8, findings: [carried()] }) })
    await settle()
    expect(wrapper.find('[data-testid="nts-confirm-f-c"]').attributes('disabled')).toBeUndefined()
  })

  // --- E: finalize is refused while a carry-forward is unreviewed ----------

  it('E — finalize is unavailable while a carried-forward finding is pending', async () => {
    route({ draft: rec({ findings: [carried()] }) })
    const wrapper = await shell()

    expect(wrapper.find('[data-testid="nts-carried-forward"]').exists()).toBe(true)
    expect(wrapper.find('[data-testid="nts-finalize-draft"]').attributes('disabled')).toBeDefined()

    // Nothing was auto-confirmed to make it possible.
    expect(state.post).not.toHaveBeenCalled()
    const finding = wrapper.find('[data-testid="nts-finding-f-c"]')
    expect(finding.exists()).toBe(true)
  })

  it('E — confirming it individually is what unlocks finalize', async () => {
    route({ draft: rec({ findings: [carried()] }) })
    const wrapper = await shell()

    state.post.mockResolvedValue({
      data: { record_version: 8, finding: { ...carried(), provenance: 'observed' } }
    })
    route({ draft: rec({ version: 8, findings: [{ ...carried(), provenance: 'observed' }] }) })
    await wrapper.find('[data-testid="nts-confirm-f-c"]').trigger('click')
    await settle()

    expect(state.post).toHaveBeenCalledWith(
      '/api/v1/odontogram/nts/records/rec-1/findings/f-c/confirm',
      { expected_version: 7 }
    )
    expect(wrapper.find('[data-testid="nts-finalize-draft"]').attributes('disabled')).toBeUndefined()
  })

  // --- D: finalize ---------------------------------------------------------

  it('D — finalizing locks the document without tearing the surface down', async () => {
    route({ draft: rec({ observations: 'listo', specifications: [{ id: 's', record_id: 'rec-1', finding_id: null, text: 'spec', sequence: 1 }] }) })
    const wrapper = await shell()

    state.post.mockResolvedValue({ data: rec({ status: 'finalized', finalized_at: 'x', content_hash: 'h' }) })
    route({ current: rec({ status: 'finalized', finalized_at: 'x', content_hash: 'h', observations: 'listo', specifications: [{ id: 's', record_id: 'rec-1', finding_id: null, text: 'spec', sequence: 1 }] }) })
    await wrapper.find('[data-testid="nts-finalize-draft"]').trigger('click')
    await settle()

    // Everything is read-only, and the shell never went through a skeleton.
    expect(wrapper.find('[data-testid="nts-loading"]').exists()).toBe(false)
    expect(wrapper.find('[data-testid="nts-odontogram-chart"]').exists()).toBe(true)
    expect(wrapper.find('[data-testid="nts-observations-input"]').exists()).toBe(false)
    expect(wrapper.find('[data-testid="nts-observations-text"]').text()).toBe('listo')
    expect(wrapper.find('[data-testid="nts-spec-add"]').exists()).toBe(false)
    expect(wrapper.find('[data-testid="nts-spec-row-0"]').text()).toContain('spec')
    expect(wrapper.find('[data-testid="nts-add-finding"]').exists()).toBe(false)
  })

  // --- F: discard ----------------------------------------------------------

  it('F — discarding keeps the record and offers no undo', async () => {
    route({ draft: rec() })
    const wrapper = await shell()

    await wrapper.find('[data-testid="nts-discard-draft"]').trigger('click')
    await nextTick()
    // The dialog is teleported, and the testid may sit on the control or on
    // its wrapper depending on how the UI kit forwards attributes.
    const host = document.querySelector('[data-testid="nts-discard-reason"]')
    const reason = host instanceof HTMLInputElement
      ? host
      : host?.querySelector('input, textarea')
    expect(reason).not.toBeNull()

    state.post.mockResolvedValue({ data: rec({ status: 'discarded' }) })
    route({ summaries: [] })
    // The dialog is teleported; drive the submit through the document.
    const el = reason as HTMLInputElement
    el.value = 'duplicado'
    el.dispatchEvent(new Event('input', { bubbles: true }))
    await nextTick()
    ;(document.querySelector('[data-testid="nts-discard-submit"]') as HTMLElement)?.click()
    await settle()

    expect(state.post).toHaveBeenCalledWith(
      '/api/v1/odontogram/nts/records/rec-1/discard',
      { expected_version: 7, reason: 'duplicado' }
    )
    // No restore affordance anywhere.
    expect(wrapper.html()).not.toContain('nts-restore')
  })

  // --- M: dirty navigation -------------------------------------------------

  it('M — CRITICAL: opening history with unsaved text asks first', async () => {
    route({
      draft: rec({ observations: 'guardado' }),
      summaries: [{
        id: 'rec-old', patient_id: 'p1', norm_version: 'pe_nts_188_2022',
        stage: 'diagnosis', stage_label: null, status: 'finalized', version: 2,
        recorded_at: '2026-04-01T10:00:00Z', finalized_at: '2026-04-01T11:00:00Z',
        discarded_at: null, supersedes_record_id: null, content_hash: 'a', is_superseded: false
      }],
      records: { 'rec-old': rec({ id: 'rec-old', status: 'finalized', observations: 'viejo' }) }
    })
    const wrapper = await shell()

    await wrapper.find('[data-testid="nts-observations-input"]').setValue('a medio escribir')
    await wrapper.find('[data-testid="nts-history-open-0"]').trigger('click')
    await settle()

    // Stopped: nothing was fetched and the text is still there.
    expect(wrapper.find('[data-testid="nts-unsaved-dialog"]').exists()
      || document.querySelector('[data-testid="nts-unsaved-stay"]') !== null).toBe(true)
    expect(wrapper.find('[data-testid="nts-historical-banner"]').exists()).toBe(false)
    expect((wrapper.find('[data-testid="nts-observations-input"]').element as HTMLTextAreaElement).value)
      .toBe('a medio escribir')

    // Staying keeps it.
    ;(document.querySelector('[data-testid="nts-unsaved-stay"]') as HTMLElement)?.click()
    await settle()
    expect((wrapper.find('[data-testid="nts-observations-input"]').element as HTMLTextAreaElement).value)
      .toBe('a medio escribir')

    // Discarding continues.
    await wrapper.find('[data-testid="nts-history-open-0"]').trigger('click')
    await settle()
    ;(document.querySelector('[data-testid="nts-unsaved-discard"]') as HTMLElement)?.click()
    await settle()
    expect(wrapper.find('[data-testid="nts-historical-banner"]').exists()).toBe(true)
  })

  it('M — an untouched draft navigates straight through', async () => {
    route({
      draft: rec({ observations: 'guardado' }),
      summaries: [{
        id: 'rec-old', patient_id: 'p1', norm_version: 'pe_nts_188_2022',
        stage: 'diagnosis', stage_label: null, status: 'finalized', version: 2,
        recorded_at: '2026-04-01T10:00:00Z', finalized_at: '2026-04-01T11:00:00Z',
        discarded_at: null, supersedes_record_id: null, content_hash: 'a', is_superseded: false
      }],
      records: { 'rec-old': rec({ id: 'rec-old', status: 'finalized', observations: 'viejo' }) }
    })
    const wrapper = await shell()

    await wrapper.find('[data-testid="nts-history-open-0"]').trigger('click')
    await settle()

    expect(document.querySelector('[data-testid="nts-unsaved-stay"]')).toBeNull()
    expect(wrapper.find('[data-testid="nts-historical-banner"]').exists()).toBe(true)
  })

  it('M — an open finding editor counts as unsaved work too', async () => {
    route({
      draft: rec(),
      summaries: [{
        id: 'rec-old', patient_id: 'p1', norm_version: 'pe_nts_188_2022',
        stage: 'diagnosis', stage_label: null, status: 'finalized', version: 2,
        recorded_at: '2026-04-01T10:00:00Z', finalized_at: '2026-04-01T11:00:00Z',
        discarded_at: null, supersedes_record_id: null, content_hash: 'a', is_superseded: false
      }],
      records: { 'rec-old': rec({ id: 'rec-old', status: 'finalized' }) }
    })
    const wrapper = await shell()

    await wrapper.find('[data-testid="nts-add-finding"]').trigger('click')
    await settle()
    expect(wrapper.find('[data-testid="nts-editor-panel"]').exists()).toBe(true)

    await wrapper.find('[data-testid="nts-history-open-0"]').trigger('click')
    await settle()

    expect(document.querySelector('[data-testid="nts-unsaved-stay"]')).not.toBeNull()
    expect(wrapper.find('[data-testid="nts-historical-banner"]').exists()).toBe(false)
    ;(document.querySelector('[data-testid="nts-unsaved-stay"]') as HTMLElement)?.click()
    await settle()
  })

  // --- carried-forward on a historical record ------------------------------

  it('carried-forward on a historical record is information, not a task', async () => {
    route({
      current: rec({ status: 'finalized' }),
      summaries: [{
        id: 'rec-old', patient_id: 'p1', norm_version: 'pe_nts_188_2022',
        stage: 'diagnosis', stage_label: null, status: 'finalized', version: 2,
        recorded_at: '2026-04-01T10:00:00Z', finalized_at: '2026-04-01T11:00:00Z',
        discarded_at: null, supersedes_record_id: null, content_hash: 'a', is_superseded: false
      }],
      records: { 'rec-old': rec({ id: 'rec-old', status: 'finalized', findings: [carried()] }) }
    })
    const wrapper = await shell()

    await wrapper.find('[data-testid="nts-history-open-0"]').trigger('click')
    await settle()

    // The finding is listed, and there is nothing to do about it here.
    expect(wrapper.find('[data-testid="nts-finding-f-c"]').exists()).toBe(true)
    expect(wrapper.find('[data-testid="nts-confirm-f-c"]').exists()).toBe(false)
    expect(wrapper.find('[data-testid="nts-edit-f-c"]').exists()).toBe(false)
    expect(wrapper.find('[data-testid="nts-remove-f-c"]').exists()).toBe(false)
    // And the shell does not advertise it as a pending job on the current record.
    expect(wrapper.find('[data-testid="nts-carried-forward"]').exists()).toBe(false)
  })

  // --- history row semantics ----------------------------------------------

  it('the selector distinguishes "the current odontogram" from "the one on screen"', async () => {
    route({
      draft: rec({ id: 'rec-1' }),
      summaries: [
        { id: 'rec-1', patient_id: 'p1', norm_version: 'pe_nts_188_2022', stage: 'diagnosis', stage_label: null, status: 'draft', version: 7, recorded_at: '2026-06-01T10:00:00Z', finalized_at: null, discarded_at: null, supersedes_record_id: null, content_hash: null, is_superseded: false },
        { id: 'rec-old', patient_id: 'p1', norm_version: 'pe_nts_188_2022', stage: 'diagnosis', stage_label: null, status: 'finalized', version: 2, recorded_at: '2026-04-01T10:00:00Z', finalized_at: '2026-04-01T11:00:00Z', discarded_at: null, supersedes_record_id: null, content_hash: 'a', is_superseded: false }
      ],
      records: { 'rec-old': rec({ id: 'rec-old', status: 'finalized' }) }
    })
    const wrapper = await shell()

    // Row 0 is the record in force; nothing is on screen from the history yet.
    expect(wrapper.find('[data-testid="nts-history-current-0"]').exists()).toBe(true)
    expect(wrapper.find('[data-testid="nts-history-open-marker-0"]').exists()).toBe(false)

    await wrapper.find('[data-testid="nts-history-open-1"]').trigger('click')
    await settle()

    // Row 1 is now on screen; row 0 is still the current one. Two facts.
    expect(wrapper.find('[data-testid="nts-history-open-marker-1"]').exists()).toBe(true)
    expect(wrapper.find('[data-testid="nts-history-current-0"]').exists()).toBe(true)
    expect(wrapper.find('[data-testid="nts-history-current-1"]').exists()).toBe(false)
  })

  // --- actor detail --------------------------------------------------------

  it('an opened record shows the actor fields it actually has', async () => {
    route({
      current: rec({ status: 'finalized' }),
      summaries: [{ id: 'rec-old', patient_id: 'p1', norm_version: 'pe_nts_188_2022', stage: 'diagnosis', stage_label: null, status: 'finalized', version: 2, recorded_at: '2026-04-01T10:00:00Z', finalized_at: '2026-04-01T11:00:00Z', discarded_at: null, supersedes_record_id: null, content_hash: 'a', is_superseded: false }],
      records: { 'rec-old': rec({ id: 'rec-old', status: 'finalized', recorded_by_name: 'Dra. Ruiz', recorded_by_professional_id: 'COP-1' }) }
    })
    const wrapper = await shell()

    await wrapper.find('[data-testid="nts-history-open-0"]').trigger('click')
    await settle()

    const detail = wrapper.find('[data-testid="nts-historical-detail"]')
    expect(detail.exists()).toBe(true)
    expect(wrapper.find('[data-testid="nts-historical-actor"]').text()).toContain('Dra. Ruiz')
    expect(wrapper.find('[data-testid="nts-historical-norm"]').text()).toBe('pe_nts_188_2022')
  })

  it('and renders no blank row for an actor the record does not name', async () => {
    route({
      current: rec({ status: 'finalized' }),
      summaries: [{ id: 'rec-old', patient_id: 'p1', norm_version: 'pe_nts_188_2022', stage: 'diagnosis', stage_label: null, status: 'finalized', version: 2, recorded_at: '2026-04-01T10:00:00Z', finalized_at: '2026-04-01T11:00:00Z', discarded_at: null, supersedes_record_id: null, content_hash: 'a', is_superseded: false }],
      records: { 'rec-old': rec({ id: 'rec-old', status: 'finalized', recorded_by_name: null, recorded_by_professional_id: null }) }
    })
    const wrapper = await shell()

    await wrapper.find('[data-testid="nts-history-open-0"]').trigger('click')
    await settle()

    expect(wrapper.find('[data-testid="nts-historical-detail"]').exists()).toBe(true)
    expect(wrapper.find('[data-testid="nts-historical-actor"]').exists()).toBe(false)
  })

  // --- 05E.4a: what the shell tells the outside world ----------------------

  it('the shell publishes unsaved text so outside controls can see it', async () => {
    route({ draft: rec() })
    const wrapper = await shell()
    const unsaved = await runInSetup(() => useNtsUnsavedChanges())

    expect(unsaved.dirty.value).toBe(false)
    expect(unsaved.isBlocked.value).toBe(false)

    await wrapper.find('[data-testid="nts-observations-input"]').setValue('sin guardar')
    await settle()

    // The chart-format selector is a sibling and cannot see this buffer; one
    // boolean is what it gets instead.
    expect(unsaved.dirty.value).toBe(true)
    expect(unsaved.isBlocked.value).toBe(true)
  })

  it('and publishes an in-flight write as a different state from dirty text', async () => {
    route({ draft: rec() })
    const wrapper = await shell()
    const unsaved = await runInSetup(() => useNtsUnsavedChanges())

    let release: (value: unknown) => void = () => {}
    state.patch.mockImplementation(() => new Promise((resolve) => {
      release = resolve
    }))
    await wrapper.find('[data-testid="nts-observations-input"]').setValue('texto')
    await wrapper.find('[data-testid="nts-observations-save"]').trigger('click')
    await nextTick()

    // Sent, so no longer discardable — and said as its own flag.
    expect(unsaved.writing.value).toBe(true)

    route({ draft: rec({ version: 8, observations: 'texto' }) })
    release({ data: rec({ version: 8, observations: 'texto' }) })
    await settle()

    expect(unsaved.writing.value).toBe(false)
    expect(unsaved.dirty.value).toBe(false)
  })

  it('an open finding editor counts as unsaved for the outside too', async () => {
    route({ draft: rec() })
    const wrapper = await shell()
    const unsaved = await runInSetup(() => useNtsUnsavedChanges())

    await wrapper.find('[data-testid="nts-add-finding"]').trigger('click')
    await settle()

    expect(unsaved.dirty.value).toBe(true)
  })

  it('and the signal is cleared when the shell goes away', async () => {
    route({ draft: rec() })
    const wrapper = await shell()
    const unsaved = await runInSetup(() => useNtsUnsavedChanges())

    await wrapper.find('[data-testid="nts-observations-input"]').setValue('sin guardar')
    await settle()
    expect(unsaved.dirty.value).toBe(true)

    // Shared state outlives the component; a stale `true` would block
    // navigation on a screen with nothing left to lose.
    wrapper.unmount()
    await settle()
    expect(unsaved.isBlocked.value).toBe(false)
  })

  // --- 05E.4a gate: leaving the route ---------------------------------------
  //
  // Three answers, because there are three situations. Clean leaves. Typed
  // text asks. A mutation already sent refuses — agreeing to leave would not
  // undo the write, so there is nothing to agree to.

  it('GATE A — a route leave is refused outright while a write is in flight', async () => {
    route({ draft: rec() })
    const wrapper = await shell()
    const confirm = vi.spyOn(window, 'confirm').mockReturnValue(true)

    state.patch.mockImplementation(() => new Promise(() => {}))
    await wrapper.find('[data-testid="nts-observations-input"]').setValue('texto')
    await wrapper.find('[data-testid="nts-observations-save"]').trigger('click')
    await nextTick()

    expect(routeGuard.handler).not.toBeNull()
    expect(routeGuard.handler!()).toBe(false)
    // Not even asked: consenting would not undo a request already sent.
    expect(confirm).not.toHaveBeenCalled()
    confirm.mockRestore()
  })

  it('GATE B/D — typed text asks first, and leaves when the answer is yes', async () => {
    route({ draft: rec() })
    const wrapper = await shell()
    const confirm = vi.spyOn(window, 'confirm').mockReturnValue(true)

    await wrapper.find('[data-testid="nts-observations-input"]').setValue('sin guardar')
    await settle()

    expect(routeGuard.handler!()).toBe(true)
    expect(confirm).toHaveBeenCalledTimes(1)
    confirm.mockRestore()
  })

  it('GATE C — and stays when the answer is no', async () => {
    route({ draft: rec() })
    const wrapper = await shell()
    const confirm = vi.spyOn(window, 'confirm').mockReturnValue(false)

    await wrapper.find('[data-testid="nts-observations-input"]').setValue('sin guardar')
    await settle()

    expect(routeGuard.handler!()).toBe(false)
    expect(confirm).toHaveBeenCalledTimes(1)
    confirm.mockRestore()
  })

  it('GATE E — nothing unsaved leaves immediately, with no prompt', async () => {
    route({ draft: rec({ observations: 'guardado' }) })
    await shell()
    const confirm = vi.spyOn(window, 'confirm').mockReturnValue(true)

    expect(routeGuard.handler!()).toBe(true)
    expect(confirm).not.toHaveBeenCalled()
    confirm.mockRestore()
  })

  it('GATE F — a save that landed lets the route go, even if the refetch failed', async () => {
    // The data reached the server. Blocking navigation over a display problem
    // would tell the clinician they might lose work they have already saved.
    route({ draft: rec() })
    const wrapper = await shell()
    const confirm = vi.spyOn(window, 'confirm').mockReturnValue(true)
    const unsaved = await runInSetup(() => useNtsUnsavedChanges())

    state.patch.mockResolvedValue({ data: rec({ version: 8, observations: 'guardado' }) })
    state.get.mockRejectedValue({ statusCode: 500, data: { message: 'boom' } })
    await wrapper.find('[data-testid="nts-observations-input"]').setValue('guardado')
    await wrapper.find('[data-testid="nts-observations-save"]').trigger('click')
    await settle()

    // The refresh failure is reported, and it is not unsaved work.
    expect(wrapper.find('[data-testid="nts-text-refresh-failed"]').exists()).toBe(true)
    expect(unsaved.writing.value).toBe(false)
    expect(unsaved.dirty.value).toBe(false)

    expect(routeGuard.handler!()).toBe(true)
    expect(confirm).not.toHaveBeenCalled()
    confirm.mockRestore()
  })

  // --- O: patient switch ---------------------------------------------------

  it('O — a patient change clears any historical view with it', async () => {
    route({
      draft: rec(),
      summaries: [{ id: 'rec-old', patient_id: 'p1', norm_version: 'pe_nts_188_2022', stage: 'diagnosis', stage_label: null, status: 'finalized', version: 2, recorded_at: '2026-04-01T10:00:00Z', finalized_at: '2026-04-01T11:00:00Z', discarded_at: null, supersedes_record_id: null, content_hash: 'a', is_superseded: false }],
      records: { 'rec-old': rec({ id: 'rec-old', status: 'finalized' }) }
    })
    const wrapper = await shell()

    await wrapper.find('[data-testid="nts-history-open-0"]').trigger('click')
    await settle()
    expect(wrapper.find('[data-testid="nts-historical-banner"]').exists()).toBe(true)

    state.get.mockImplementation(() => new Promise(() => {}))
    await wrapper.setProps({ patientId: 'patient-b' })
    await settle()

    // A real context change: the surface is replaced, and the previous
    // patient's historical record does not survive it.
    expect(wrapper.find('[data-testid="nts-loading"]').exists()).toBe(true)
    expect(wrapper.find('[data-testid="nts-historical-banner"]').exists()).toBe(false)
  })
})
