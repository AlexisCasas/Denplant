import { describe, expect, it } from 'vitest'
import { activeTreatmentCount, orderedPlanMarkers, THERAPEUTIC_LAYER_ORDER } from '../../../backend/app/modules/odontogram/frontend/utils/treatmentPlanComposition'

describe('H2.3 — composición visual del Plan', () => {
  it('uses the documented therapeutic layer priority', () => {
    expect(THERAPEUTIC_LAYER_ORDER).toEqual(['occlusal_surface', 'pulp_fill', 'cenital_pattern', 'lateral_icon'])
  })

  it('is deterministic when API arrival order is inverted', () => {
    const first = { itemId: 'b', treatmentId: 't-2', status: 'pending' as const }
    const second = { itemId: 'a', treatmentId: 't-1', status: 'completed' as const }
    expect(orderedPlanMarkers([first, second]).map(marker => marker.treatmentId)).toEqual(['t-1', 't-2'])
    expect(orderedPlanMarkers([second, first]).map(marker => marker.treatmentId)).toEqual(['t-1', 't-2'])
  })

  it('counts active planned and completed items while retaining cancelled history', () => {
    expect(activeTreatmentCount([
      { itemId: 'endo', treatmentId: 'endo', status: 'completed' },
      { itemId: 'crown', treatmentId: 'crown', status: 'pending' },
      { itemId: 'old', treatmentId: 'old', status: 'cancelled' }
    ])).toBe(2)
  })
})
