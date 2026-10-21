/** DP-08.A — Plan odontogram: patterns, anchors, cancelled items, legend and accessibility. */
import { mountSuspended } from '@nuxt/test-utils/runtime'
import { describe, expect, it, vi } from 'vitest'
import { nextTick, ref } from 'vue'

import GlobalTreatmentsStrip from '../../../backend/app/modules/odontogram/frontend/components/odontogram/GlobalTreatmentsStrip.vue'
import { LATERAL_ICONS } from '../../../backend/app/modules/odontogram/frontend/components/odontogram/LateralViewIcons'
import { therapeuticIconTransform, therapeuticSurfacePath } from '../../../backend/app/modules/odontogram/frontend/utils/ntsTherapeuticGeometry'
import NtsPlanOdontogramChart from '../../../backend/app/modules/treatment_plan/frontend/components/clinical/NtsPlanOdontogramChart.vue'

const globalTreatments = ref<Record<string, unknown>[]>([])
vi.mock('../../../backend/app/modules/odontogram/frontend/composables/useTreatments', () => ({
  useTreatments: () => ({
    treatments: globalTreatments,
    fetchTreatments: async () => {},
    createTreatment: async () => null,
    updateTreatment: async () => null,
    deleteTreatment: async () => false,
    performTreatment: async () => null
  })
}))

type Rule = Record<string, unknown>
const snapshot = (...rules: Rule[]) => ({ schema_version: 1, odontogram_treatment_type: 'x', visualization_rules: rules, visualization_config: {}, clinical_category: 'restauradora' })
const item = (id: string, treatment: Record<string, unknown>, status = 'pending') => ({
  id: `item-${id}`,
  treatment_id: `treatment-${id}`,
  clinic_id: 'clinic-1',
  treatment_plan_id: 'plan-1',
  sequence_order: 1,
  status,
  completed_without_appointment: false,
  created_at: '2026-10-01T00:00:00Z',
  updated_at: '2026-10-01T00:00:00Z',
  treatment: { id: `treatment-${id}`, clinical_type: 'crown', scope: 'tooth', status: 'planned', teeth: [], ...treatment }
})
const tooth = (fdi: number, surfaces: string[] = [], role: string | null = null) => ({ tooth_number: fdi, surfaces, role })
const withRules = (id: string, fdi: number, surfaces: string[], ...rules: Rule[]) =>
  item(id, { visualization_snapshot: snapshot(...rules), teeth: [tooth(fdi, surfaces)] })

async function mountChart(items: ReturnType<typeof item>[], props: Record<string, unknown> = {}) {
  const wrapper = await mountSuspended(NtsPlanOdontogramChart, { props: { items, ...props } })
  await nextTick()
  return wrapper
}
const legend = (wrapper: Awaited<ReturnType<typeof mountChart>>) => wrapper.find('[data-testid="nts-plan-visual-legend"]')

describe('DP-08.A F1 — surface layer', () => {
  it.each([16, 26, 36, 46, 55, 65, 75, 85])('draws M/D/V/L polygons of tooth %i from the shared geometry', async (fdi) => {
    const wrapper = await mountChart([withRules('1', fdi, ['M', 'D', 'V', 'L'], { layer: 'occlusal_surface', color: '#3B82F6', kind: 'solid_fill' })])
    const paths = wrapper.findAll('[data-testid="nts-therapy-surface"]')
    expect(paths.map(path => path.attributes('data-surface'))).toEqual(['M', 'D', 'V', 'L'])
    for (const path of paths) expect(path.attributes('d')).toBe(therapeuticSurfacePath(fdi, path.attributes('data-surface')!))
  })

  it('honours the surface kind: filled by default, outline only when asked', async () => {
    const filled = await mountChart([withRules('1', 16, ['M'], { layer: 'occlusal_surface', color: '#3B82F6', kind: 'solid_fill' })])
    expect(filled.find('[data-testid="nts-therapy-surface"]').attributes('fill')).toBe('#3B82F6')
    const outline = await mountChart([withRules('1', 16, ['M'], { layer: 'occlusal_surface', color: '#F472B6', kind: 'outline' })])
    expect(outline.find('[data-testid="nts-therapy-surface"]').attributes('fill')).toBe('none')
  })

  it('moves the small surface dot with the orientation instead of a fixed spot', async () => {
    const right = await mountChart([item('1', { teeth: [tooth(16, ['M'])] })])
    const left = await mountChart([item('1', { teeth: [tooth(26, ['M'])] })])
    const dot = (wrapper: typeof right, fdi: number) => {
      const circle = wrapper.findAll('circle').find(candidate => candidate.attributes('r') === '1.8')!
      return { fdi, x: Number(circle.attributes('cx')) }
    }
    // Mesial is the midline side: right of the cell for 16, left for 26.
    const r = dot(right, 16)
    const l = dot(left, 26)
    expect(r.x).toBeGreaterThan(0)
    expect(l.x).toBeGreaterThan(r.x)
  })
})

describe('DP-08.A F2 — cenital patterns', () => {
  it.each([
    ['diagonal_stripes', 'url'],
    ['horizontal_stripes', 'url'],
    ['dots', 'url'],
    ['grid', 'url'],
    ['solid', '#F59E0B'],
    ['outline', 'none']
  ])('draws %s as its own fill', async (pattern, fill) => {
    const wrapper = await mountChart([withRules('1', 16, [], { layer: 'cenital_pattern', pattern, color: '#F59E0B' })])
    const rect = wrapper.find('[data-testid="nts-therapy-pattern"]')
    expect(rect.attributes('data-pattern')).toBe(pattern)
    if (fill === 'url') expect(rect.attributes('fill')).toMatch(/^url\(#/)
    else expect(rect.attributes('fill')).toBe(fill)
  })

  it('uses a distinct pattern per pattern type and per marker', async () => {
    const wrapper = await mountChart([
      withRules('1', 16, [], { layer: 'cenital_pattern', pattern: 'dots', color: '#60A5FA' }),
      withRules('2', 16, [], { layer: 'cenital_pattern', pattern: 'grid', color: '#38BDF8' })
    ])
    const ids = wrapper.findAll('pattern').map(pattern => pattern.attributes('id'))
    expect(ids).toHaveLength(2)
    expect(new Set(ids).size).toBe(2)
    expect(wrapper.find('pattern circle').exists()).toBe(true)
  })

  it('keeps stripes for a rule without pattern and an outline for an unknown one', async () => {
    const none = await mountChart([withRules('1', 16, [], { layer: 'cenital_pattern', color: '#F59E0B' })])
    expect(none.find('[data-testid="nts-therapy-pattern"]').attributes('data-pattern')).toBe('diagonal_stripes')
    const unknown = await mountChart([withRules('1', 16, [], { layer: 'cenital_pattern', pattern: 'hologram', color: '#F59E0B' })])
    expect(unknown.find('[data-testid="nts-therapy-pattern"]').attributes('fill')).toBe('none')
  })
})

describe('DP-08.A F2 — icons and pulp', () => {
  it.each([16, 46])('anchors the apicoectomy icon of tooth %i with the shared transform', async (fdi) => {
    const wrapper = await mountChart([withRules('1', fdi, [], { layer: 'lateral_icon', icon: 'apicoectomy', color: '#EF4444' })])
    const icon = wrapper.find('[data-testid="nts-therapy-icon"]')
    expect(icon.attributes('transform')).toBe(therapeuticIconTransform(fdi, LATERAL_ICONS.apicoectomy!))
    expect(icon.attributes('data-icon')).toBe('apicoectomy')
  })

  it('draws an undefined icon such as splint as a generic indicator, not as nothing', async () => {
    const wrapper = await mountChart([withRules('1', 16, [], { layer: 'lateral_icon', icon: 'splint', color: '#3B82F6' })])
    expect(wrapper.find('[data-testid="nts-therapy-generic-icon"]').attributes('data-icon')).toBe('splint')
    expect(wrapper.find('[data-testid="nts-therapy-icon"]').exists()).toBe(false)
    expect(wrapper.find('[data-testid="nts-plan-legend-generic-icon"]').exists()).toBe(true)
  })

  it('keeps the implant fallback and does not flag it as generic', async () => {
    const wrapper = await mountChart([withRules('1', 16, [], { layer: 'lateral_icon', icon: 'implant', color: '#22C55E' })])
    expect(wrapper.find('[data-icon="implant"]').exists()).toBe(true)
    expect(wrapper.find('[data-testid="nts-plan-legend-generic-icon"]').exists()).toBe(false)
  })

  it('fills the pulp from the crown side of the root in each arch', async () => {
    const upper = await mountChart([withRules('1', 16, [], { layer: 'pulp_fill', color: '#7C3AED', extent: 'partial_1_2' })])
    const lower = await mountChart([withRules('1', 46, [], { layer: 'pulp_fill', color: '#7C3AED', extent: 'partial_1_2' })])
    const bottom = (wrapper: typeof upper) => {
      const rect = wrapper.find('[data-testid="nts-therapy-pulp"]')
      return { top: Number(rect.attributes('y')), bottom: Number(rect.attributes('y')) + Number(rect.attributes('height')) }
    }
    expect(bottom(upper).bottom).toBeGreaterThan(bottom(upper).top)
    expect(bottom(lower).bottom).toBeGreaterThan(bottom(lower).top)
  })
})

describe('DP-08.A F3 — cancelled items are not drawn as active', () => {
  const bridge = (id: string, status: string) => item(id, {
    clinical_type: 'bridge',
    scope: 'multi_tooth',
    teeth: [tooth(14, [], 'pillar'), tooth(15, [], 'pontic'), tooth(16, [], 'pillar')]
  }, status)

  it('draws bridge connectors only for active bridges', async () => {
    expect((await mountChart([bridge('1', 'pending')])).findAll('line')).toHaveLength(2)
    expect((await mountChart([bridge('1', 'cancelled')])).findAll('line')).toHaveLength(0)
    expect((await mountChart([bridge('1', 'cancelled'), bridge('2', 'completed')])).findAll('line')).toHaveLength(2)
  })

  it('removes layers, outline, dots, roles, counter and legend of a cancelled item', async () => {
    const cancelled = item('1', {
      visualization_snapshot: snapshot({ layer: 'cenital_pattern', pattern: 'dots', color: '#60A5FA' }, { layer: 'occlusal_surface', color: '#3B82F6' }),
      teeth: [tooth(16, ['M', 'O'], 'pillar')]
    }, 'cancelled')
    const wrapper = await mountChart([cancelled])
    expect(wrapper.find('[data-testid="nts-therapy-16"]').exists()).toBe(false)
    expect(wrapper.find('[data-role]').exists()).toBe(false)
    expect(wrapper.find('[data-testid="nts-plan-chart-overlay"]').findAll('circle, rect')).toHaveLength(0)
    expect(legend(wrapper).exists()).toBe(false)
    expect(wrapper.find('[data-testid="nts-plan-treatment-count"]').exists()).toBe(false)
  })

  it('does not count or advertise a cancelled item next to an active one', async () => {
    const wrapper = await mountChart([
      withRules('1', 16, ['M'], { layer: 'pulp_fill', color: '#7C3AED' }),
      item('2', { visualization_snapshot: snapshot({ layer: 'cenital_pattern', pattern: 'grid', color: '#60A5FA' }), teeth: [tooth(16, ['D'], 'pillar')] }, 'cancelled')
    ])
    expect(wrapper.find('[data-testid="nts-plan-treatment-count"]').exists()).toBe(false)
    expect(wrapper.find('[data-testid="nts-therapy-pattern"]').exists()).toBe(false)
    expect(legend(wrapper).text()).not.toContain('Cobertura de pieza')
    expect(legend(wrapper).find('[data-testid="nts-plan-legend-multiple"]').exists()).toBe(false)
    expect(legend(wrapper).find('[data-testid="nts-plan-legend-roles"]').exists()).toBe(false)
  })

  it('ignores a treatment already cancelled even when the item is still pending', async () => {
    const wrapper = await mountChart([item('1', { status: 'cancelled', teeth: [tooth(16, ['M'])] })])
    expect(wrapper.find('[data-testid="nts-plan-chart-overlay"]').findAll('circle')).toHaveLength(0)
  })

  const globalItem = (id: string, status: string) => item(id, { clinical_type: 'cleaning', scope: 'global_mouth', teeth: [] }, status)
  const globalTreatment = (id: string) => ({ id: `treatment-${id}`, clinical_type: 'cleaning', scope: 'global_mouth', status: 'planned', teeth: [] })

  it('hides cancelled global treatments from the strip, the legend and the note', async () => {
    globalTreatments.value = [globalTreatment('1'), globalTreatment('2')]
    const wrapper = await mountChart([globalItem('1', 'cancelled'), globalItem('2', 'pending')], { patientId: 'patient-1', readonly: true })
    expect(wrapper.findComponent(GlobalTreatmentsStrip).props('treatments').map((treatment: { id: string }) => treatment.id)).toEqual(['treatment-2'])
    expect(legend(wrapper).text()).toContain('Tratamientos globales')

    const onlyCancelled = await mountChart([globalItem('1', 'cancelled')], { patientId: 'patient-1', readonly: true })
    expect(onlyCancelled.findComponent(GlobalTreatmentsStrip).props('treatments')).toEqual([])
    expect(legend(onlyCancelled).exists()).toBe(false)
    expect(onlyCancelled.text()).not.toContain('se mantienen en la lista del plan')
    globalTreatments.value = []
  })
})

describe('DP-08.A F4 — legend matches the visible indicators', () => {
  it('explains the generic markers when there is no snapshot', async () => {
    const wrapper = await mountChart([item('1', { teeth: [tooth(16, ['O'])] })])
    const text = legend(wrapper).text()
    expect(text).toContain('Contorno y punto')
    expect(text).toContain('superficie tratada')
    expect(text).toContain('Solo contorno y punto')
    expect(text).toContain('planificado')
    expect(text).not.toContain('realizado')
  })

  it('labels the counter as drawn, without a "+n" notation', async () => {
    const wrapper = await mountChart([
      item('1', { teeth: [tooth(16)] }),
      item('2', { teeth: [tooth(16)] })
    ])
    const text = legend(wrapper).find('[data-testid="nts-plan-legend-multiple"]').text()
    expect(text).toContain('Número en círculo')
    expect(text).not.toContain('+n')
    expect(wrapper.find('[data-testid="nts-plan-treatment-count"] text').text()).toBe('2')
  })

  it('lists only the layers that are actually visible', async () => {
    const wrapper = await mountChart([
      withRules('1', 16, [], { layer: 'occlusal_surface', color: '#3B82F6' }),
      withRules('2', 26, ['O'], { layer: 'cenital_pattern', pattern: 'dots', color: '#60A5FA' })
    ])
    const layers = wrapper.findAll('[data-testid="nts-plan-legend-layer"]').map(node => node.text())
    expect(layers).toEqual(['Cobertura de pieza'])
  })

  it('explains the bridge roles and the completed state', async () => {
    const wrapper = await mountChart([item('1', {
      clinical_type: 'bridge',
      scope: 'multi_tooth',
      status: 'performed',
      teeth: [tooth(14, [], 'pillar'), tooth(16, [], 'pillar')]
    }, 'completed')])
    const text = legend(wrapper).text()
    expect(text).toContain('Cuadro lleno: pilar')
    expect(text).toContain('Línea discontinua: puente')
    expect(text).toContain('realizado')
    expect(text).not.toContain('planificado')
    expect(wrapper.findAll('[data-role="pillar"]')).toHaveLength(2)
  })

  it('draws the role once per bridge member, however many layers the snapshot has', async () => {
    const wrapper = await mountChart([item('1', {
      clinical_type: 'bridge',
      scope: 'multi_tooth',
      visualization_snapshot: snapshot({ layer: 'cenital_pattern', pattern: 'solid', color: '#F59E0B' }, { layer: 'lateral_icon', icon: 'bracket', color: '#3B82F6' }),
      teeth: [tooth(14, [], 'pillar'), tooth(15, [], 'pontic')]
    })])
    expect(wrapper.findAll('[data-role]')).toHaveLength(2)
  })

  it.each([null, undefined, { schema_version: 2, visualization_rules: [{ layer: 'pulp_fill' }] }, { schema_version: 1 }])('falls back to the generic indicator for snapshot %j', async (value) => {
    const wrapper = await mountChart([item('1', { visualization_snapshot: value, teeth: [tooth(16)] })])
    expect(wrapper.find('[data-testid="nts-therapy-16"]').exists()).toBe(false)
    expect(wrapper.find('[data-testid="nts-plan-legend-fallback"]').exists()).toBe(true)
    expect(wrapper.find('[data-testid="nts-plan-chart-overlay"]').findAll('circle').length).toBeGreaterThan(0)
  })
})

describe('DP-08.A F7 — treatment count is exposed outside the decorative SVG', () => {
  it('describes each tooth with several active treatments in a list reachable by assistive technology', async () => {
    const wrapper = await mountChart([
      item('1', { teeth: [tooth(16)] }),
      item('2', { teeth: [tooth(16)] }),
      item('3', { teeth: [tooth(16)] }),
      item('4', { teeth: [tooth(26)] }),
      item('5', { teeth: [tooth(26)] }),
      item('6', { teeth: [tooth(36)] })
    ])
    const list = wrapper.find('[data-testid="nts-plan-treatment-descriptions"]')
    expect(list.exists()).toBe(true)
    expect(list.findAll('li').map(node => node.text())).toEqual([
      '3 tratamientos vigentes en la pieza 16',
      '2 tratamientos vigentes en la pieza 26'
    ])
    const overlay = wrapper.find('[data-testid="nts-plan-chart-overlay"]')
    expect(overlay.attributes('aria-hidden')).toBe('true')
    expect(overlay.element.contains(list.element)).toBe(false)
    // Nothing assistive-tech-relevant is left inside the hidden SVG.
    expect(overlay.find('[aria-label]').exists()).toBe(false)
  })

  it('stays out of the way when no tooth has several treatments or the extra one is cancelled', async () => {
    const single = await mountChart([item('1', { teeth: [tooth(16)] })])
    expect(single.find('[data-testid="nts-plan-treatment-descriptions"]').exists()).toBe(false)
    const withCancelled = await mountChart([item('1', { teeth: [tooth(16)] }), item('2', { teeth: [tooth(16)] }, 'cancelled')])
    expect(withCancelled.find('[data-testid="nts-plan-treatment-descriptions"]').exists()).toBe(false)
  })
})
