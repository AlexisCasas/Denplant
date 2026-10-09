/** Presentation-only ordering for Plan therapeutic overlays; never changes clinical records. */
import type { TherapeuticLayer } from './therapeuticVisualization'

export const THERAPEUTIC_LAYER_ORDER: TherapeuticLayer[] = [
  'occlusal_surface',
  'pulp_fill',
  'cenital_pattern',
  'lateral_icon'
]

export interface PlanVisualMarker {
  itemId: string
  treatmentId: string
  status: 'pending' | 'completed' | 'cancelled'
  treatmentStatus?: string
}

/** Cancelled items remain in history/detail but are not active visual treatments. */
export function isActivePlanMarker(marker: PlanVisualMarker): boolean {
  return marker.status !== 'cancelled' && marker.treatmentStatus !== 'cancelled'
}

/** Stable identity makes the output independent of API arrival order. */
export function orderedPlanMarkers<T extends PlanVisualMarker>(markers: T[]): T[] {
  return [...markers].sort((left, right) =>
    left.treatmentId.localeCompare(right.treatmentId) || left.itemId.localeCompare(right.itemId))
}

export function activeTreatmentCount(markers: PlanVisualMarker[]): number {
  return markers.filter(isActivePlanMarker).length
}
