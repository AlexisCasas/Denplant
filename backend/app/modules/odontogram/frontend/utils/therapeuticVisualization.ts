/** Pure adapter for the versioned therapeutic snapshot; it owns no clinical mapping. */
import type { TreatmentVisualizationSnapshot, VisualizationRuleLayer } from '~~/app/types'
import { isTherapeuticSurface } from './ntsTherapeuticGeometry'

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

/** Cenital patterns the catalog emits today; anything else is drawn as a plain outline. */
export const THERAPEUTIC_PATTERNS = ['diagonal_stripes', 'horizontal_stripes', 'vertical_stripes', 'dots', 'grid', 'solid', 'outline'] as const
export type TherapeuticPattern = (typeof THERAPEUTIC_PATTERNS)[number]

/** A rule with no pattern keeps the original diagonal stripes; an unknown one never claims a pattern. */
export function resolveTherapeuticPattern(pattern?: string): TherapeuticPattern {
  if (pattern === undefined) return 'diagonal_stripes'
  return (THERAPEUTIC_PATTERNS as readonly string[]).includes(pattern) ? pattern as TherapeuticPattern : 'outline'
}

/**
 * The instructions that actually put something on the chart.
 *
 * A surface rule needs at least one valid surface; every other layer always draws
 * (an icon without its own symbol falls back to a generic indicator). The layer and
 * the legend both read this, so the legend never advertises what is not visible.
 */
export function renderableTherapeuticInstructions(snapshot: unknown, surfaces: readonly string[] = []): TherapeuticInstruction[] {
  return therapeuticInstructions(snapshot).filter(rule =>
    rule.layer !== 'occlusal_surface' || surfaces.some(isTherapeuticSurface))
}
