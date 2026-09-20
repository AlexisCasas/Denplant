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
import NtsOdontogramShell from '../../../backend/app/modules/odontogram/frontend/components/odontogram/NtsOdontogramShell.vue'
import OdontogramProfileSelector from '../../../backend/app/modules/odontogram/frontend/components/odontogram/OdontogramProfileSelector.vue'
import { useNtsUnsavedChanges } from '../../../backend/app/modules/odontogram/frontend/composables/useNtsUnsavedChanges'
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
  it('A — profile "original" mounts the existing chart, not the NTS shell', async () => {
    resolvesTo('original')

    const wrapper = await mountView()
    await settle()

    expect(state.get).toHaveBeenCalledWith('/api/v1/odontogram/preferences')
    expect(wrapper.findComponent(OdontogramChart).exists()).toBe(true)
    expect(wrapper.findComponent(NtsOdontogramShell).exists()).toBe(false)
    expect(wrapper.find('[data-testid="odontogram-profile-loading"]').exists()).toBe(false)
  })

  it('B — profile "pe_nts_188_2022" mounts the MINSA shell', async () => {
    resolvesTo('pe_nts_188_2022')

    const wrapper = await mountView()
    await settle()

    expect(wrapper.findComponent(NtsOdontogramShell).exists()).toBe(true)
    expect(wrapper.findComponent(OdontogramChart).exists()).toBe(false)
  })

  it('E — a remount reads the backend again and restores MINSA', async () => {
    resolvesTo('pe_nts_188_2022')

    const first = await mountView()
    await settle()
    expect(first.findComponent(NtsOdontogramShell).exists()).toBe(true)

    // Simulate a page reload: in-memory state cleared, backend still MINSA.
    const api = await runInSetup(() => useOdontogramProfile())
    api.reset()
    state.get.mockClear()

    const second = await mountView()
    await settle()

    expect(state.get).toHaveBeenCalledTimes(1)
    expect(second.findComponent(NtsOdontogramShell).exists()).toBe(true)
  })

  it('renders neither chart while the preference is still loading', async () => {
    // A GET that never settles keeps the wrapper in its loading state.
    state.get.mockImplementation(() => new Promise(() => {}))

    const wrapper = await mountView()
    await settle()

    expect(wrapper.find('[data-testid="odontogram-profile-loading"]').exists()).toBe(true)
    expect(wrapper.findComponent(OdontogramChart).exists()).toBe(false)
    expect(wrapper.findComponent(NtsOdontogramShell).exists()).toBe(false)
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

// ---------------------------------------------------------------------------
// NTS-05E.4a — changing the chart format is a context change too
// ---------------------------------------------------------------------------
//
// The selector is a sibling of the mount point, not its parent: clicking it
// flips shared preference state and the odontogram shell is unmounted. So it
// can destroy unsaved clinical text without ever seeing it, which is why the
// guard lives here — at the control that causes the change — rather than
// trying to undo a prop after the fact.

describe('OdontogramProfileSelector — unsaved clinical text', () => {
  const mounted: Array<{ unmount: () => void }> = []
  afterEach(() => {
    mounted.forEach(w => w.unmount())
    mounted.length = 0
  })

  /**
   * Set the shared flags the odontogram shell publishes.
   *
   * Written through the composable rather than poked into a store, so the
   * test exercises the same contract the shell uses.
   */
  async function publish(flags: { dirty: boolean, writing: boolean }) {
    const unsaved = await runInSetup(() => useNtsUnsavedChanges())
    unsaved.publish(flags)
    await nextTick()
    return unsaved
  }

  async function mountSelector() {
    state.get.mockResolvedValue({ data: { profile: 'original' } })
    const wrapper = await mountSuspended(OdontogramProfileSelector)
    mounted.push(wrapper)
    await settle()
    return wrapper
  }

  beforeEach(async () => {
    // Shared state outlives a component; start every case from nothing owed.
    const unsaved = await runInSetup(() => useNtsUnsavedChanges())
    unsaved.reset()
  })

  it('A — with nothing unsaved, the switch happens straight away', async () => {
    await publish({ dirty: false, writing: false })
    const wrapper = await mountSelector()

    state.put.mockResolvedValue({ data: { profile: 'pe_nts_188_2022' } })
    await wrapper.find('[data-testid="odontogram-profile-option-pe_nts_188_2022"]').trigger('click')
    await settle()

    expect(state.put).toHaveBeenCalledTimes(1)
    expect(document.querySelector('[data-testid="odontogram-profile-unsaved-stay"]')).toBeNull()
  })

  it('B — with unsaved text, it asks before switching', async () => {
    await publish({ dirty: true, writing: false })
    const wrapper = await mountSelector()

    await wrapper.find('[data-testid="odontogram-profile-option-pe_nts_188_2022"]').trigger('click')
    await settle()

    // Nothing was written, and the format has not changed.
    expect(state.put).not.toHaveBeenCalled()
    expect(document.querySelector('[data-testid="odontogram-profile-unsaved-stay"]')).not.toBeNull()
  })

  it('F — keeping the edit leaves the format alone', async () => {
    await publish({ dirty: true, writing: false })
    const wrapper = await mountSelector()

    await wrapper.find('[data-testid="odontogram-profile-option-pe_nts_188_2022"]').trigger('click')
    await settle()
    ;(document.querySelector('[data-testid="odontogram-profile-unsaved-stay"]') as HTMLElement).click()
    await settle()

    expect(state.put).not.toHaveBeenCalled()
    expect(
      wrapper.find('[data-testid="odontogram-profile-option-original"]').attributes('aria-pressed')
    ).toBe('true')
  })

  it('G/H — discarding switches, and saves nothing on the way out', async () => {
    await publish({ dirty: true, writing: false })
    const wrapper = await mountSelector()

    await wrapper.find('[data-testid="odontogram-profile-option-pe_nts_188_2022"]').trigger('click')
    await settle()

    state.put.mockResolvedValue({ data: { profile: 'pe_nts_188_2022' } })
    ;(document.querySelector('[data-testid="odontogram-profile-unsaved-discard"]') as HTMLElement).click()
    await settle()

    // Exactly one PUT — the preference itself. The discarded text was never
    // sent anywhere: discarding is not a quiet save.
    expect(state.put).toHaveBeenCalledTimes(1)
    expect(state.put).toHaveBeenCalledWith(
      '/api/v1/odontogram/preferences',
      { profile: 'pe_nts_188_2022' }
    )
  })

  it('WRITING — a mutation already sent is not offered as discardable', async () => {
    // It may already be on the server, and its result needs somewhere to
    // land. The honest answer is to wait, not to offer to throw it away.
    await publish({ dirty: false, writing: true })
    const wrapper = await mountSelector()

    const option = wrapper.find('[data-testid="odontogram-profile-option-pe_nts_188_2022"]')
    expect(option.attributes('disabled')).toBeDefined()

    await option.trigger('click')
    await settle()

    expect(state.put).not.toHaveBeenCalled()
    // And no dialog: there is nothing to decide.
    expect(document.querySelector('[data-testid="odontogram-profile-unsaved-stay"]')).toBeNull()
  })

  it('WRITING — the switch becomes available once the write settles', async () => {
    const unsaved = await publish({ dirty: false, writing: true })
    const wrapper = await mountSelector()
    expect(
      wrapper.find('[data-testid="odontogram-profile-option-pe_nts_188_2022"]').attributes('disabled')
    ).toBeDefined()

    // The write landed and the refetch finished: nothing is owed any more.
    unsaved.publish({ dirty: false, writing: false })
    await settle()

    expect(
      wrapper.find('[data-testid="odontogram-profile-option-pe_nts_188_2022"]').attributes('disabled')
    ).toBeUndefined()
  })

  it('a failed refetch after a successful save is not treated as unsaved text', async () => {
    // The data reached the server. Refusing to leave over a display problem
    // would be telling the clinician they might lose work they already saved.
    await publish({ dirty: false, writing: false })
    const wrapper = await mountSelector()

    state.put.mockResolvedValue({ data: { profile: 'pe_nts_188_2022' } })
    await wrapper.find('[data-testid="odontogram-profile-option-pe_nts_188_2022"]').trigger('click')
    await settle()

    expect(state.put).toHaveBeenCalledTimes(1)
  })
})
