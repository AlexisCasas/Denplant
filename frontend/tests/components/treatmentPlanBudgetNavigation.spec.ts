import { flushPromises, shallowMount } from '@vue/test-utils'
import { mockNuxtImport } from '@nuxt/test-utils/runtime'
import { createI18n } from 'vue-i18n'
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { nextTick, ref } from 'vue'
import type { TreatmentPlanDetail } from '../../app/types'
import TreatmentPlanMiniCard from '../../../backend/app/modules/treatment_plan/frontend/components/treatment-plans/TreatmentPlanMiniCard.vue'

let canReadBudget = true
let PlanDetailView: typeof import('../../../backend/app/modules/treatment_plan/frontend/components/clinical/PlanDetailView.vue')['default']
const wrappers: ReturnType<typeof shallowMount>[] = []

vi.stubGlobal('useToast', () => ({ add: vi.fn() }))
mockNuxtImport('usePermissions', () => () => ({ can: () => canReadBudget }))
vi.stubGlobal('useCurrency', () => ({ format: (amount: number) => String(amount) }))
vi.stubGlobal('useClinicalNotes', () => ({ createNote: vi.fn() }))
vi.stubGlobal('useTreatmentPlans', () => ({
  completeItem: vi.fn(), completeSession: vi.fn(), cancelSession: vi.fn(),
  removeItem: vi.fn(), reorderItems: vi.fn(), changeItemDoctor: vi.fn(),
  fetchPlan: vi.fn(), loading: ref(false), confirmPlan: vi.fn(), reopenPlan: vi.fn(),
  closePlan: vi.fn(), reactivatePlan: vi.fn(), logContact: vi.fn()
}))

const { ensureOdontogramProfileLoaded } = vi.hoisted(() => ({
  ensureOdontogramProfileLoaded: vi.fn()
}))

mockNuxtImport('useOdontogramProfile', () => () => ({
  profile: ref(''),
  isLoaded: ref(true),
  ensureLoaded: ensureOdontogramProfileLoaded
}))

vi.mock('../../../backend/app/modules/odontogram/frontend/composables/useOdontogramProfile', () => ({
  useOdontogramProfile: () => ({
    profile: ref(''),
    isLoaded: ref(true),
    ensureLoaded: ensureOdontogramProfileLoaded
  })
}))

const i18n = createI18n({ legacy: false, locale: 'en', messages: { en: {} }, missingWarn: false, fallbackWarn: false })
const stubs = {
  UButton: { props: ['to'], template: '<a :href="to"><slot /></a>' },
  UBadge: { template: '<span><slot /></span>' },
  UIcon: true,
  UCard: { template: '<section><slot name="header" /><slot /></section>' },
  UDropdownMenu: { template: '<div><slot /></div>' },
  OdontogramChart: true,
  NtsCurrentFindingsPanel: true,
  PlanTreatmentList: true,
  PlanNotesTimeline: true
}

function plan(overrides: Record<string, unknown> = {}) {
  return {
    id: 'plan-1', patient_id: 'patient-1', plan_number: 'PT-001', title: 'Plan',
    status: 'pending', budget_id: 'budget-1', budget: { id: 'budget-1', budget_number: 'B-001', status: 'draft' },
    items: [], item_count: 0, completed_count: 0, total: 0, clinic_id: 'clinic-1',
    created_by: 'user-1', created_at: '', updated_at: '',
    ...overrides
  } as unknown as TreatmentPlanDetail
}

async function detailWrapper(currentPlan: ReturnType<typeof plan>) {
  const previousCalls = ensureOdontogramProfileLoaded.mock.calls.length
  const wrapper = shallowMount(PlanDetailView, {
    props: { plan: currentPlan, patientId: 'patient-1', readonly: true },
    global: { plugins: [i18n], stubs }
  })
  wrappers.push(wrapper)
  await nextTick()
  expect(ensureOdontogramProfileLoaded).toHaveBeenCalledTimes(previousCalls + 1)
  return wrapper
}

function hasBudgetDestination(wrapper: ReturnType<typeof shallowMount>, budgetId: string) {
  return wrapper.findAll(`a[href="/budgets/${budgetId}"]`).length > 0
}

describe('treatment plan budget navigation', () => {
  beforeAll(async () => {
    PlanDetailView = (await import('../../../backend/app/modules/treatment_plan/frontend/components/clinical/PlanDetailView.vue')).default
  })

  beforeEach(() => {
    canReadBudget = true
    ensureOdontogramProfileLoaded.mockClear()
  })

  afterEach(async () => {
    wrappers.splice(0).forEach(wrapper => wrapper.unmount())
    await flushPromises()
  })

  it('shows the linked draft budget for a pending plan and uses its current id', async () => {
    const wrapper = await detailWrapper(plan())

    expect(wrapper.findAll('a[href="/budgets/budget-1"]')).toHaveLength(1)
    expect(wrapper.text()).toContain('B-001')
    expect(wrapper.text()).toContain('budget.status.draft')
  })

  it('keeps a sent budget in the lock banner without duplicating the action', async () => {
    const wrapper = await detailWrapper(plan({ budget: { id: 'budget-2', budget_number: 'B-002', status: 'sent' }, budget_id: 'budget-2' }))

    expect(wrapper.findAll('a[href="/budgets/budget-2"]')).toHaveLength(1)
    expect(wrapper.text()).toContain('clinical.plans.locked.title')
  })

  it('does not offer a budget destination without a link or budget.read', async () => {
    expect(hasBudgetDestination(await detailWrapper(plan({ budget_id: undefined, budget: undefined })), 'budget-1')).toBe(false)

    canReadBudget = false
    expect(hasBudgetDestination(await detailWrapper(plan()), 'budget-1')).toBe(false)
  })

  it('shows the link as soon as the refreshed confirmed plan includes its draft budget', async () => {
    const wrapper = await detailWrapper(plan({ budget_id: undefined, budget: undefined }))

    expect(hasBudgetDestination(wrapper, 'budget-after-confirmation')).toBe(false)

    await wrapper.setProps({
      plan: plan({
        budget_id: 'budget-after-confirmation',
        budget: { id: 'budget-after-confirmation', budget_number: 'B-004', status: 'draft' }
      })
    })

    expect(hasBudgetDestination(wrapper, 'budget-after-confirmation')).toBe(true)
  })

  it('makes the linked budget on a plan card navigable, including historical budgets', () => {
    const wrapper = shallowMount(TreatmentPlanMiniCard, {
      props: { plan: plan({ budget_id: 'budget-history', budget: { id: 'budget-history', budget_number: 'B-003', status: 'expired' } }) },
      global: { plugins: [i18n], stubs }
    })
    wrappers.push(wrapper)

    expect(hasBudgetDestination(wrapper, 'budget-history')).toBe(true)
    expect(wrapper.text()).toContain('B-003')

    canReadBudget = false
    const restrictedWrapper = shallowMount(TreatmentPlanMiniCard, { props: { plan: plan() }, global: { plugins: [i18n], stubs } })
    wrappers.push(restrictedWrapper)
    expect(hasBudgetDestination(restrictedWrapper, 'budget-1')).toBe(false)
  })
})
