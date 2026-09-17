/**
 * NTS-05A §39 — legacy Original semantics under the MINSA profile.
 *
 * `DiagnosisMode` renders two Original-shaped panels below the chart: the
 * "registered conditions" card, whose rows are `Treatment` records with
 * `status = 'existing'`, and `DiagnosisCTA`, which turns those rows into a
 * treatment plan. Under NTS N.° 188 a *hallazgo* is not a *procedimiento*
 * (§5.8), so presenting a Treatment there would state something clinically
 * false. Both panels are therefore hidden under the MINSA profile — and left
 * exactly as they were under Original.
 *
 * `DiagnosisMode` reaches its composables through layer auto-imports, and
 * `frontend/module_layers` does not resolve on this Windows host, so the
 * three it needs are installed as globals for this file: the compiled SFC
 * looks them up as free identifiers, which is precisely how an auto-import
 * behaves at runtime.
 */

import { mockNuxtImport, mountSuspended } from '@nuxt/test-utils/runtime'
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { computed, nextTick, ref } from 'vue'

import DiagnosisMode from '../../../backend/app/modules/odontogram/frontend/components/clinical/DiagnosisMode.vue'

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

const profile = ref('original')
const treatments = ref<Array<Record<string, unknown>>>([])
const fetchTreatments = vi.fn()
const fetchPatientPlans = vi.fn()

const AUTO_IMPORTS = ['useOdontogram', 'useTreatmentPlans', 'useOdontogramProfile'] as const

beforeAll(() => {
  const globals = globalThis as unknown as Record<string, unknown>
  globals.useOdontogram = () => ({
    treatments,
    fetchTreatments,
    loading: ref(false)
  })
  globals.useTreatmentPlans = () => ({
    plans: ref([]),
    fetchPatientPlans,
    loading: ref(false)
  })
  globals.useOdontogramProfile = () => ({ profile: computed(() => profile.value) })
})

afterAll(() => {
  const globals = globalThis as unknown as Record<string, unknown>
  for (const name of AUTO_IMPORTS) Reflect.deleteProperty(globals, name)
})

beforeEach(() => {
  profile.value = 'original'
  treatments.value = [
    { id: 't1', status: 'existing', source_module: 'odontogram', tooth_number: 11 },
    { id: 't2', status: 'existing', source_module: 'odontogram', tooth_number: 21 }
  ]
  state.get.mockReset()
  state.post.mockReset()
  state.put.mockReset()
  state.get.mockImplementation(async () => ({ data: { profile: profile.value } }))
})

async function settle() {
  await nextTick()
  await new Promise(resolve => setTimeout(resolve, 0))
  await nextTick()
}

/**
 * Shallow-mounted: this suite asserts which panels the mode renders, not what
 * each one draws. `UCard` stubs let the two cards be counted (the chart card
 * is always present; the conditions card is the profile-dependent one) and
 * `DiagnosisCTA` renders as its own unresolved tag.
 */
async function mountMode() {
  const wrapper = await mountSuspended(DiagnosisMode, {
    props: { patientId: 'p1' },
    shallow: true
  })
  await settle()
  return wrapper
}

function panels(html: string) {
  return {
    cards: (html.match(/<u-card-stub/g) ?? []).length,
    hasCta: /<diagnosiscta/i.test(html)
  }
}

describe('§39 — Original panels stay Original', () => {
  it('profile "original" keeps the registered-conditions card and the plan CTA', async () => {
    const wrapper = await mountMode()
    const { cards, hasCta } = panels(wrapper.html())

    // Chart card + conditions card.
    expect(cards).toBe(2)
    expect(hasCta).toBe(true)
  })

  it('profile "pe_nts_188_2022" presents no Treatment as an NTS finding', async () => {
    profile.value = 'pe_nts_188_2022'

    const wrapper = await mountMode()
    const { cards, hasCta } = panels(wrapper.html())

    // Only the chart card: the Treatment-backed panels are gone.
    expect(cards).toBe(1)
    expect(hasCta).toBe(false)
  })

  it('hiding the panels does not delete or rewrite the underlying treatments', async () => {
    profile.value = 'pe_nts_188_2022'
    await mountMode()

    // The Original data is still there and untouched — only unrendered.
    expect(treatments.value).toHaveLength(2)
    expect(state.post).not.toHaveBeenCalled()
    expect(state.put).not.toHaveBeenCalled()
  })

  it('switching back to Original brings the existing flow back unchanged', async () => {
    profile.value = 'pe_nts_188_2022'
    expect(panels((await mountMode()).html()).cards).toBe(1)

    profile.value = 'original'
    const back = panels((await mountMode()).html())

    expect(back.cards).toBe(2)
    expect(back.hasCta).toBe(true)
  })

  it('the chart mount point itself is never profile-gated', async () => {
    // Whichever profile is active, the odontogram card is rendered: the
    // profile decides *which* chart, never *whether* there is one.
    for (const value of ['original', 'pe_nts_188_2022']) {
      profile.value = value
      expect(panels((await mountMode()).html()).cards).toBeGreaterThanOrEqual(1)
    }
  })
})
