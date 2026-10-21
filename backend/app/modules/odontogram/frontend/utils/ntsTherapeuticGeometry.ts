/**
 * Anchors for the Plan's therapeutic overlay, expressed on the NTS chart.
 *
 * Nothing here owns an anatomical rule. Which trapezoid is mesial, which side is
 * vestibular and where the apex sits are all read from the diagnostic geometry
 * (`resolveSurfaceRegions`, `toothPlacement`, `apexPoint`), so the Plan cannot
 * drift from the diagnosis. Presentation only: no clinical record is read or
 * written.
 */
import type { LateralIconConfig } from '../components/odontogram/LateralViewIcons'
import { apexPoint, localToGlobal, toothPlacement, type NtsBox, type NtsPoint } from './ntsChartGeometry'
import { resolveSurfaceRegions } from './ntsSurfaceGeometry'

export const THERAPEUTIC_SURFACES = ['M', 'D', 'O', 'V', 'L'] as const
export type TherapeuticSurface = (typeof THERAPEUTIC_SURFACES)[number]

export function isTherapeuticSurface(value: unknown): value is TherapeuticSurface {
  return typeof value === 'string' && (THERAPEUTIC_SURFACES as readonly string[]).includes(value)
}

/** The rings one surface covers on the chart; empty for an unknown tooth or surface. */
export function therapeuticSurfaceRings(fdi: number, surface: string): NtsPoint[][] {
  if (!isTherapeuticSurface(surface)) return []
  return resolveSurfaceRegions(fdi, [surface]).map(region =>
    region.points.map(point => localToGlobal(fdi, point)).filter((point): point is NtsPoint => point !== null))
}

/** SVG path data for one surface; `null` when the tooth or surface is not drawable. */
export function therapeuticSurfacePath(fdi: number, surface: string): string | null {
  const rings = therapeuticSurfaceRings(fdi, surface).filter(ring => ring.length > 2)
  if (!rings.length) return null
  return rings.map(ring => `M${ring.map(point => `${round(point.x)},${round(point.y)}`).join(' L')} Z`).join(' ')
}

/** Centre of the area a surface covers, for markers that point at it. */
export function therapeuticSurfaceAnchor(fdi: number, surface: string): NtsPoint | null {
  const points = therapeuticSurfaceRings(fdi, surface).flat()
  if (!points.length) return null
  const xs = points.map(point => point.x)
  const ys = points.map(point => point.y)
  return { x: (Math.min(...xs) + Math.max(...xs)) / 2, y: (Math.min(...ys) + Math.max(...ys)) / 2 }
}

/**
 * The part of the root box a pulp fill occupies.
 *
 * The fill grows from the crown towards the apex. The crown is below the roots
 * in the upper arch and above them in the lower one, so the coronal edge of the
 * box is its bottom or its top respectively.
 */
export function therapeuticPulpBox(fdi: number, fraction: number): NtsBox | null {
  const placement = toothPlacement(fdi)
  if (!placement) return null
  const { root } = placement
  const height = root.height * fraction
  return {
    x: root.x + root.width * 0.35,
    y: placement.arch === 'upper' ? root.y + root.height - height : root.y,
    width: root.width * 0.3,
    height
  }
}

export interface TherapeuticIconPlacement {
  x: number
  y: number
  scale: number
  /** The icon is drawn pointing away from the crown, so the upper arch flips it. */
  flipY: boolean
}

/**
 * Where an icon of a given anchor belongs on one tooth.
 *
 * `offsetY` is read as a distance towards the crown from the anchor: positive
 * pulls the icon back from the apex (a resection line), negative pushes it past
 * it (a periapical lesion). `besideCrown` and `aboveCrown` have no free space on
 * a chart whose columns touch, so they sit on the crown centre.
 */
export function therapeuticIconPlacement(fdi: number, icon: LateralIconConfig): TherapeuticIconPlacement | null {
  const placement = toothPlacement(fdi)
  if (!placement) return null
  const scale = Math.min(placement.crown.width, placement.crown.height) / 42
  // Apices point up in the upper arch and down in the lower one (y grows down).
  const apical = placement.arch === 'upper' ? -1 : 1
  const offset = (icon.offsetY ?? 0) * scale
  let anchor: NtsPoint = placement.center
  let flipY = false

  switch (icon.anchorPosition) {
    case 'rootCenter':
      anchor = { x: placement.root.x + placement.root.width / 2, y: placement.root.y + placement.root.height / 2 }
      break
    case 'apex':
    case 'beyondApex': {
      const apex = apexPoint(fdi)
      if (!apex) {
        anchor = { x: placement.root.x + placement.root.width / 2, y: placement.arch === 'upper' ? placement.root.y : placement.root.y + placement.root.height }
      } else {
        anchor = apex
      }
      anchor = { x: anchor.x, y: anchor.y - apical * offset }
      flipY = icon.anchorPosition === 'beyondApex' && apical === -1
      break
    }
    default:
      break
  }
  return { x: anchor.x, y: anchor.y, scale, flipY }
}

export function therapeuticIconTransform(fdi: number, icon: LateralIconConfig | null): string {
  if (!icon) return ''
  const placement = therapeuticIconPlacement(fdi, icon)
  if (!placement) return ''
  return `translate(${round(placement.x)}, ${round(placement.y)}) scale(${round(placement.scale)}, ${round(placement.flipY ? -placement.scale : placement.scale)})`
}

/** Anchor for a generic indicator when an icon has no symbol of its own. */
export function therapeuticCrownCenter(fdi: number): NtsPoint | null {
  return toothPlacement(fdi)?.center ?? null
}

function round(value: number): number {
  return Math.round(value * 100) / 100
}
