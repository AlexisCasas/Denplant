/**
 * NTS-02 — odontogram profile preference: composable + profile-aware mount point.
 *
 * Module-layer files are imported by relative path: the
 * `frontend/module_layers` symlink does not resolve on this Windows host, so
 * Nuxt never extends the odontogram layer in the test environment (hence the
 * "Cannot extend config from /module_layers/..." warnings on every run).
 * Host-level auto-imports (`useApi`, `useClinicState`, `useI18n`, Nuxt UI)
 * still resolve, so layer components mount fine and the real composable runs
 * end-to-end here — only the HTTP boundary is doubled, via `mockNuxtImport`.
 */

import { mockNuxtImport, mountSuspended } from '@nuxt/test-utils/runtime'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { defineComponent, h, nextTick } from 'vue'

import OdontogramProfileView from '../../../backend/app/modules/odontogram/frontend/components/odontogram/OdontogramProfileView.vue'
import OdontogramChart from '../../../backend/app/modules/odontogram/frontend/components/odontogram/OdontogramChart.vue'
import NtsOdontogramPlaceholder from '../../../backend/app/modules/odontogram/frontend/components/odontogram/NtsOdontogramPlaceholder.vue'
import { useOdontogramProfile } from '../../../backend/app/modules/odontogram/frontend/composables/useOdontogramProfile'

const state = vi.hoisted(() => ({
  clinicId: 'clinic-a' as string | null,
  get: vi.fn(),
  put: vi.fn()
}))

mockNuxtImport('useApi', () => () => ({
  get: state.get,
  put: state.put
}))

mockNuxtImport('useClinicState', () => () => ({
  // The composable only reads `currentClinic.value?.id`; a getter keeps the
  // double free of Vue reactivity plumbing the tests don't exercise.
  currentClinic: {
    get value() {
      return state.clinicId ? { id: state.clinicId } : null
    }
  }
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

/** Let `onMounted`'s async work settle (mountSuspended does not await it). */
async function settle() {
  await nextTick()
  await new Promise(resolve => setTimeout(resolve, 0))
  await nextTick()
}

function resolvesTo(profile: string) {
  state.get.mockImplementation(async () => ({ data: { profile } }))
}

/**
 * Wrappers are torn down between tests: the profile lives in a shared
 * `useState`, so a wrapper left mounted would keep re-rendering when a later
 * test mutates it — resolving `OdontogramChart` for real outside its layer
 * and raising `useOdontogram is not defined` as an unhandled rejection.
 */
const mounted: Array<{ unmount: () => void }> = []

beforeEach(async () => {
  state.clinicId = 'clinic-a'
  state.get.mockReset()
  state.put.mockReset()
  resolvesTo('original')
  // `useState` is shared app-wide; clear it so each test starts unloaded.
  const api = await runInSetup(() => useOdontogramProfile())
  api.reset()
})

afterEach(async () => {
  while (mounted.length) mounted.pop()?.unmount()
  await nextTick()
})

// ---------------------------------------------------------------------------
// A / B / E — the mount point renders the chart matching the stored profile
// ---------------------------------------------------------------------------

/**
 * Shallow-mounted: this suite asserts *which branch the mount point picks*,
 * not what each chart draws. Stubbing the children also keeps
 * `OdontogramChart`'s own layer auto-imports out of the test environment.
 */
async function mountView() {
  const wrapper = await mountSuspended(OdontogramProfileView, {
    props: { patientId: 'p1', mode: 'diagnosis' },
    shallow: true
  })
  mounted.push(wrapper)
  return wrapper
}

describe('OdontogramProfileView (profile-aware mount point)', () => {
  it('A — profile "original" mounts the existing chart, not the placeholder', async () => {
    resolvesTo('original')

    const wrapper = await mountView()
    await settle()

    expect(state.get).toHaveBeenCalledWith('/api/v1/odontogram/preferences')
    expect(wrapper.findComponent(OdontogramChart).exists()).toBe(true)
    expect(wrapper.findComponent(NtsOdontogramPlaceholder).exists()).toBe(false)
    expect(wrapper.find('[data-testid="odontogram-profile-loading"]').exists()).toBe(false)
  })

  it('B — profile "pe_nts_188_2022" mounts the MINSA placeholder', async () => {
    resolvesTo('pe_nts_188_2022')

    const wrapper = await mountView()
    await settle()

    expect(wrapper.findComponent(NtsOdontogramPlaceholder).exists()).toBe(true)
    expect(wrapper.findComponent(OdontogramChart).exists()).toBe(false)
  })

  it('E — a remount reads the backend again and restores MINSA', async () => {
    resolvesTo('pe_nts_188_2022')

    const first = await mountView()
    await settle()
    expect(first.findComponent(NtsOdontogramPlaceholder).exists()).toBe(true)

    // Simulate a page reload: in-memory state cleared, backend still MINSA.
    const api = await runInSetup(() => useOdontogramProfile())
    api.reset()
    state.get.mockClear()

    const second = await mountView()
    await settle()

    expect(state.get).toHaveBeenCalledTimes(1)
    expect(second.findComponent(NtsOdontogramPlaceholder).exists()).toBe(true)
  })

  it('renders neither chart while the preference is still loading', async () => {
    // A GET that never settles keeps the wrapper in its loading state.
    state.get.mockImplementation(() => new Promise(() => {}))

    const wrapper = await mountView()
    await settle()

    expect(wrapper.find('[data-testid="odontogram-profile-loading"]').exists()).toBe(true)
    expect(wrapper.findComponent(OdontogramChart).exists()).toBe(false)
    expect(wrapper.findComponent(NtsOdontogramPlaceholder).exists()).toBe(false)
  })
})

// ---------------------------------------------------------------------------
// C / D / F — the composable's persistence contract
// ---------------------------------------------------------------------------

describe('useOdontogramProfile', () => {
  it('reads the stored profile from the backend', async () => {
    resolvesTo('pe_nts_188_2022')

    const api = await runInSetup(() => useOdontogramProfile())
    const resolved = await api.fetchProfile()

    expect(state.get).toHaveBeenCalledWith('/api/v1/odontogram/preferences')
    expect(resolved).toBe('pe_nts_188_2022')
    expect(api.profile.value).toBe('pe_nts_188_2022')
    expect(api.isLoaded.value).toBe(true)
  })

  it('C — a successful PUT persists and switches the local profile', async () => {
    resolvesTo('original')
    state.put.mockImplementation(async (_url: string, body: { profile: string }) => ({
      data: { profile: body.profile }
    }))

    const api = await runInSetup(() => useOdontogramProfile())
    await api.fetchProfile()
    expect(api.profile.value).toBe('original')

    const ok = await api.setProfile('pe_nts_188_2022')

    expect(ok).toBe(true)
    expect(state.put).toHaveBeenCalledWith(
      '/api/v1/odontogram/preferences',
      { profile: 'pe_nts_188_2022' }
    )
    expect(api.profile.value).toBe('pe_nts_188_2022')
  })

  it('D — a failing PUT keeps the previous profile (selector cannot drift)', async () => {
    resolvesTo('original')
    state.put.mockImplementation(async () => {
      throw new Error('boom')
    })

    const api = await runInSetup(() => useOdontogramProfile())
    await api.fetchProfile()

    const ok = await api.setProfile('pe_nts_188_2022')

    expect(ok).toBe(false)
    expect(api.profile.value).toBe('original')
    expect(api.error.value).toBe('updateFailed')
  })

  it('falls back to "original" when the GET fails', async () => {
    state.get.mockImplementation(async () => {
      throw new Error('offline')
    })

    const api = await runInSetup(() => useOdontogramProfile())
    const resolved = await api.fetchProfile()

    expect(resolved).toBe('original')
    expect(api.error.value).toBe('loadFailed')
    expect(api.isLoaded.value).toBe(true)
  })

  it('F — ensureLoaded refetches when the clinic context changes', async () => {
    resolvesTo('original')

    const api = await runInSetup(() => useOdontogramProfile())

    await api.ensureLoaded()
    expect(state.get).toHaveBeenCalledTimes(1)
    expect(api.profile.value).toBe('original')

    // Same clinic: cached, no second round-trip.
    await api.ensureLoaded()
    expect(state.get).toHaveBeenCalledTimes(1)

    // Different clinic: the cached choice must not be reused.
    state.clinicId = 'clinic-b'
    resolvesTo('pe_nts_188_2022')
    await api.ensureLoaded()

    expect(state.get).toHaveBeenCalledTimes(2)
    expect(api.profile.value).toBe('pe_nts_188_2022')
  })
})
