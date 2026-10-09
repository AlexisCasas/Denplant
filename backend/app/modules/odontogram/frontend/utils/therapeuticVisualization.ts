/** Pure adapter for the versioned therapeutic snapshot; it owns no clinical mapping. */
import type { TreatmentVisualizationSnapshot, VisualizationRuleLayer } from '~~/app/types'

export type TherapeuticLayer = 'pulp_fill' | 'occlusal_surface' | 'lateral_icon' | 'cenital_pattern'
export interface TherapeuticInstruction { layer: TherapeuticLayer, color?: string, kind?: string, extent?: string, icon?: string, pattern?: string }

const LAYERS = new Set<TherapeuticLayer>(['pulp_fill', 'occlusal_surface', 'lateral_icon', 'cenital_pattern'])

/** Unknown, partial and future snapshots intentionally produce no instructions. */
export function therapeuticInstructions(snapshot: unknown): TherapeuticInstruction[] {
  if (!snapshot || typeof snapshot !== 'object') return []
  const value = snapshot as Partial<TreatmentVisualizationSnapshot>
  if (value.schema_version !== 1 || !Array.isArray(value.visualization_rules)) return []
  return value.visualization_rules.flatMap((rule: VisualizationRuleLayer) => {
    if (!rule || typeof rule !== 'object' || !LAYERS.has(rule.layer as TherapeuticLayer)) return []
    return [{ layer: rule.layer as TherapeuticLayer, color: typeof rule.color === 'string' ? rule.color : undefined, kind: typeof rule.kind === 'string' ? rule.kind : undefined, extent: typeof rule.extent === 'string' ? rule.extent : undefined, icon: typeof rule.icon === 'string' ? rule.icon : undefined, pattern: typeof rule.pattern === 'string' ? rule.pattern : undefined }]
  })
}

export function hasTherapeuticSnapshot(snapshot: unknown): boolean {
  return therapeuticInstructions(snapshot).length > 0
}
