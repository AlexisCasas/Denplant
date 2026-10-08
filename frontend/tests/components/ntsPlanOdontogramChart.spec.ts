/** H1 — treatment plan projection shares the NTS structural geometry. */
import { mountSuspended } from '@nuxt/test-utils/runtime'
import { describe, expect, it } from 'vitest'
import { nextTick } from 'vue'

import NtsPlanOdontogramChart from '../../../backend/app/modules/treatment_plan/frontend/components/clinical/NtsPlanOdontogramChart.vue'
import { NTS_ROWS } from '../../../backend/app/modules/odontogram/frontend/utils/ntsDentition'
import { NTS_CHART_VIEWBOX, toothPlacement } from '../../../backend/app/modules/odontogram/frontend/utils/ntsChartGeometry'

const item = (overrides: Record<string, unknown> = {}) => ({
  id: 'item-1',
  treatment_id: 'treatment-1',
  clinic_id: 'clinic-1',
  treatment_plan_id: 'plan-1',
  sequence_order: 1,
  status: 'pending',
  completed_without_appointment: false,
  created_at: '2026-10-01T00:00:00Z',
  updated_at: '2026-10-01T00:00:00Z',
  treatment: {
    id: 'treatment-1', clinical_type: 'filling', scope: 'tooth', status: 'planned',
    teeth: [{ tooth_number: 16, surfaces: ['O'], role: null }]
  },
  ...overrides
})

async function mountChart(items = [item()]) {
  const wrapper = await mountSuspended(NtsPlanOdontogramChart, { props: { items } })
  await nextTick()
  return wrapper
}

describe('H1 — odontograma NTS del plan', () => {
  it('uses all 52 NTS teeth in the same four row order', async () => {
    const wrapper = await mountChart()
    expect(wrapper.findAll('[data-testid^="nts-tooth-"]')).toHaveLength(52)
    expect(wrapper.findAll('[data-row]').map(row => row.attributes('data-row')))
      .toEqual(NTS_ROWS.map(row => row.id))
  })

  it.each([16, 55, 85, 46])('keeps tooth %i at its shared NTS placement', async (fdi) => {
    const wrapper = await mountChart()
    const placement = toothPlacement(fdi)
    expect(placement).not.toBeNull()
    const tooth = wrapper.find(`[data-testid="nts-tooth-${fdi}"]`)
    expect(tooth.exists()).toBe(true)
    // The overlay consumes the same exported viewBox and each displayed tooth
    // is produced by NtsDentitionRow/NtsToothCell; there is no plan-local
    // placement table to drift from diagnosis.
    expect(wrapper.find('[data-testid="nts-plan-chart-overlay"]').attributes('viewBox'))
      .toBe(NTS_CHART_VIEWBOX)
  })

  it('renders surface markers and keeps multiple plan treatments visible', async () => {
    const wrapper = await mountChart([
      item(),
      item({ id: 'item-2', treatment_id: 'treatment-2', treatment: {
        id: 'treatment-2', clinical_type: 'crown', scope: 'tooth', status: 'planned',
        teeth: [{ tooth_number: 16, surfaces: [], role: null }]
      } })
    ])
    expect(wrapper.findAll('circle')).toHaveLength(3)
  })

  it('emits a tooth selection for plan/list linking', async () => {
    const wrapper = await mountChart()
    await wrapper.find('[data-testid="nts-tooth-16"]').trigger('click')
    expect(wrapper.emitted('toothSelect')?.[0]).toEqual([16])
  })

  it('draws bridge members without turning them into findings', async () => {
    const wrapper = await mountChart([item({ treatment: {
      id: 'bridge-1', clinical_type: 'bridge', scope: 'multi_tooth', status: 'planned',
      teeth: [
        { tooth_number: 14, role: 'pillar', surfaces: [] },
        { tooth_number: 15, role: 'pontic', surfaces: [] },
        { tooth_number: 16, role: 'pillar', surfaces: [] }
      ]
    } })])
    expect(wrapper.findAll('line')).toHaveLength(2)
    expect(wrapper.find('[data-testid="nts-plan-odontogram-chart"]').text()).toContain('no son hallazgos MINSA')
  })
})
