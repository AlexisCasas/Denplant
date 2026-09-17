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

  it('marks the chart area as pending instead of drawing a partial renderer', async () => {
    const wrapper = await mountShell()
    // Nothing on screen may look like a working normative chart yet.
    expect(wrapper.find('[data-testid="nts-chart-pending"]').exists()).toBe(true)
    expect(wrapper.find('svg.odontogram-chart').exists()).toBe(false)
  })

  it('mounting never mutates: no POST is issued on load', async () => {
    await mountShell()
    expect(state.post).not.toHaveBeenCalled()
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
  '../../../backend/app/modules/odontogram/frontend/components/odontogram/OdontogramProfileView.vue'
].map(relative => ({
  relative,
  source: readFileSync(fileURLToPath(new URL(relative, import.meta.url)), 'utf8')
}))

describe('§40 — no confirm-all', () => {
  it.each(NTS_SOURCES)('$relative exposes no bulk-confirm action', ({ source }) => {
    expect(source).not.toMatch(/confirmAll|confirm_all|confirm-all/)
  })

  it('offers no finding-level confirm either (that arrives with the editor)', () => {
    const shell = NTS_SOURCES.find(f => f.relative.endsWith('NtsOdontogramShell.vue'))!
    expect(shell.source).not.toMatch(/confirmFinding|reviewFinding|\/review\b/)
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
