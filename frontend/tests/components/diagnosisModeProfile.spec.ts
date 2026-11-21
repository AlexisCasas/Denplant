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
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { computed, defineComponent, h, nextTick, ref } from 'vue'

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

// ---------------------------------------------------------------------------
// QW4 — the notes rail left Diagnóstico; the chart has the whole width
// ---------------------------------------------------------------------------

describe('QW4 — Diagnóstico without the notes sidebar', () => {
  // The default shallow stubs drop slot content, and the add-note button lives
  // in the chart card's header. These stand-ins keep the slots and give the
  // chart a component whose events can be driven.
  const CardWithSlots = defineComponent({
    name: 'UCard',
    setup(_, { slots }) {
      return () => h('div', { 'data-card': '' }, [slots.header?.(), slots.default?.()])
    }
  })
  const ButtonStub = defineComponent({
    name: 'UButton',
    emits: ['click'],
    setup(_, { slots, attrs, emit }) {
      return () => h('button', { ...attrs, onClick: () => emit('click') }, slots.default?.())
    }
  })
  const ChartStub = defineComponent({
    name: 'OdontogramProfileView',
    emits: ['tooth-hover'],
    setup() {
      return () => h('div', { 'data-testid': 'chart' })
    }
  })

  async function mountWithChart(props: Record<string, unknown> = {}) {
    const wrapper = await mountSuspended(DiagnosisMode, {
      props: { patientId: 'p1', ...props },
      global: {
        // Layer components are resolved by name; host ones are bound at build
        // time and have to be stubbed instead.
        components: { OdontogramProfileView: ChartStub },
        stubs: { UCard: CardWithSlots, UButton: ButtonStub }
      }
    })
    await settle()
    return wrapper
  }

  it('no longer renders the odontogram.diagnosis.sidebar slot, desktop rail or mobile slideover', async () => {
    const wrapper = await mountMode()
    const html = wrapper.html()

    expect(html).not.toContain('odontogram.diagnosis.sidebar')
    expect(html).not.toMatch(/module-slot-stub/)
    expect(html).not.toMatch(/u-slideover-stub/)
    // …nor the floating button that opened it.
    expect(html).not.toContain('i-lucide-notebook-pen" size="lg"')
    expect(html).not.toMatch(/<aside/)
  })

  it('gives the chart the full width: no side-by-side flex wrapper', async () => {
    const wrapper = await mountMode()
    expect(wrapper.html()).not.toContain('min-[960px]:flex')
    expect(wrapper.html()).not.toContain('min-[960px]:w-80')
  })

  it('keeps the chart, the conditions card and the plan CTA exactly as before', async () => {
    const { cards, hasCta } = panels((await mountMode()).html())
    expect(cards).toBe(2)
    expect(hasCta).toBe(true)
  })

  it('still registers the slot contract: the plugin keeps the sidebar registration', () => {
    const plugin = readFileSync(
      resolve(process.cwd(), '../backend/app/modules/clinical_notes/frontend/plugins/slots.client.ts'),
      'utf8'
    )
    expect(plugin).toContain('odontogram.diagnosis.sidebar')
    expect(plugin).toContain('DiagnosisNotesSidebar.vue')
  })

  it('offers "Añadir nota", which hands over no tooth when none was touched', async () => {
    const wrapper = await mountWithChart()
    const button = wrapper.find('[data-testid="diagnosis-add-note"]')

    expect(button.exists()).toBe(true)
    await button.trigger('click')
    expect(wrapper.emitted('add-note')).toEqual([[null]])
  })

  it('hands over the tooth the clinician was last on', async () => {
    const wrapper = await mountWithChart()
    const view = wrapper.findComponent({ name: 'OdontogramProfileView' })
    expect(view.exists()).toBe(true)
    view.vm.$emit('tooth-hover', 36)
    await nextTick()

    await wrapper.find('[data-testid="diagnosis-add-note"]').trigger('click')
    expect(wrapper.emitted('add-note')).toEqual([[36]])
  })

  it('a pointer leaving the chart does not forget the last tooth', async () => {
    const wrapper = await mountWithChart()
    const view = wrapper.findComponent({ name: 'OdontogramProfileView' })
    view.vm.$emit('tooth-hover', 21)
    view.vm.$emit('tooth-hover', null)
    await nextTick()

    await wrapper.find('[data-testid="diagnosis-add-note"]').trigger('click')
    expect(wrapper.emitted('add-note')).toEqual([[21]])
  })

  it('is not offered when the host says notes are out of reach', async () => {
    const wrapper = await mountWithChart({ canAddNote: false })
    expect(wrapper.find('[data-testid="diagnosis-add-note"]').exists()).toBe(false)
  })
})
