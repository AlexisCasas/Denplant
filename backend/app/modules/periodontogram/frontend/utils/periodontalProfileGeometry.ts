/**
 * periodontalProfileGeometry — the pure half of the SEPA profile strip.
 *
 * `PerioProfileStrip.vue` draws what this module computes and nothing else:
 * no Vue, no Nuxt, no I/O, so the rules that used to hide inside a component
 * (where a null silently kept a line going and one polyline ran across the
 * whole arch) can be tested directly.
 *
 * ## The rules
 *
 * * **Two independent series.** Margen and Sondaje are each measured from
 *   their own zero — the baseline, the CEJ — and are never added to one
 *   another or to the previous site. Their sum is a number (`clinicalSum`),
 *   not a line.
 * * **A tooth is its own drawing.** Each tooth yields its own segments. A
 *   segment never crosses from one tooth to the next, so 14 never connects to
 *   15 and 11 never connects to 21, whatever the arch order.
 * * **`null` is "not measured", `0` is a measurement.** A null draws no point
 *   and ends the segment it interrupts, so `3 · null · 2` is two lone points,
 *   never a line through the empty site. A zero is a real point on the
 *   baseline.
 * * **Direction is geometry, not sign.** A positive value runs from the
 *   baseline toward the root and a negative one the other way, but which way
 *   is *up the screen* depends on the strip: `depth-up` for the strips above
 *   their tooth row, `depth-down` for the ones below. Nothing here reads
 *   "positive" as "downwards".
 * * **No clamp below zero.** The backend admits a margin from -5 to 10 mm and
 *   a probing depth from 0 to 15, and the strip draws what was stored.
 */

import type { PerioSite, PerioTooth, SiteCode } from '../types'

export type StripDirection = 'depth-up' | 'depth-down'
export type ProfileMetric = 'margin' | 'probing'

/** Geometry of one strip, in SVG user units. */
export interface ProfileGeometry {
  /** Pixels per millimetre. */
  mmPx: number
  /** The deepest value the strip's gridlines reach. */
  maxMm: number
  /** Width of one tooth column. */
  colWidth: number
}

export const PROFILE_GEOMETRY: ProfileGeometry = {
  mmPx: 4,
  maxMm: 15,
  colWidth: 60
}

/** Height of the 0 … `maxMm` domain. The baseline is its edge. */
export function stripHeight(geometry: ProfileGeometry = PROFILE_GEOMETRY): number {
  return geometry.maxMm * geometry.mmPx
}

/** Where, across a tooth column, its three sites sit (20 / 50 / 80 %). */
export const SITE_OFFSETS = [0.2, 0.5, 0.8] as const

/** The most a stored margin can lie on the far side of the baseline (mm). */
export const MAX_NEGATIVE_MM = 5

// ---------------------------------------------------------------------------
// numbers
// ---------------------------------------------------------------------------

/**
 * Suma = sondaje + margen, sign respected: the clinical attachment level.
 *
 * `null` when either is missing — never a zero standing in for "unknown".
 * A real 0 (`-5 + 5`) is a value and is returned as 0.
 */
export function clinicalSum(
  margin: number | null | undefined,
  probing: number | null | undefined
): number | null {
  if (margin === null || margin === undefined) return null
  if (probing === null || probing === undefined) return null
  return probing + margin
}

/** The value of one site for one metric, or `null` when not measured. */
export function siteMetric(
  site: Pick<PerioSite, 'gingival_margin_mm' | 'probing_depth_mm'> | null | undefined,
  metric: ProfileMetric
): number | null {
  const value = metric === 'margin' ? site?.gingival_margin_mm : site?.probing_depth_mm
  return value === undefined ? null : value
}

// ---------------------------------------------------------------------------
// coordinates
// ---------------------------------------------------------------------------

/**
 * The y of a value measured from the baseline.
 *
 * `depth-up` has its baseline at the bottom edge and a positive value runs up
 * the screen; `depth-down` has it at the top edge and a positive value runs
 * down. A negative value runs the other way, past the baseline, and is not
 * clamped. Only the far end is bounded, so a stray value cannot leave the
 * strip.
 */
export function valueToY(
  mm: number,
  direction: StripDirection,
  geometry: ProfileGeometry = PROFILE_GEOMETRY
): number {
  const bounded = Math.min(geometry.maxMm, mm)
  return direction === 'depth-up'
    ? stripHeight(geometry) - bounded * geometry.mmPx
    : bounded * geometry.mmPx
}

/** The x of site `siteIdx` (0…2) of the tooth in column `toothIdx`. */
export function siteX(
  toothIdx: number,
  siteIdx: number,
  geometry: ProfileGeometry = PROFILE_GEOMETRY
): number {
  return toothIdx * geometry.colWidth + geometry.colWidth * (SITE_OFFSETS[siteIdx] ?? 0.5)
}

// ---------------------------------------------------------------------------
// segments
// ---------------------------------------------------------------------------

export interface MetricPoint {
  x: number
  y: number
  mm: number
  toothNumber: number
  siteCode: SiteCode
}

/**
 * A run of consecutive measured sites of **one** tooth.
 *
 * One point is a lone measurement (drawn as a dot); two or more are joined.
 */
export interface MetricSegment {
  toothNumber: number
  points: MetricPoint[]
}

/**
 * The segments of one tooth for one metric.
 *
 * Sites are read in the order of `sites` (left to right across the column). A
 * site with no value closes the current run, and the next measured site starts
 * a new one.
 */
export function buildMetricSegmentsForTooth(
  tooth: Pick<PerioTooth, 'tooth_number' | 'sites'>,
  toothIdx: number,
  sites: readonly SiteCode[],
  metric: ProfileMetric,
  direction: StripDirection,
  geometry: ProfileGeometry = PROFILE_GEOMETRY
): MetricSegment[] {
  const segments: MetricSegment[] = []
  let run: MetricPoint[] = []

  const close = () => {
    if (run.length > 0) segments.push({ toothNumber: tooth.tooth_number, points: run })
    run = []
  }

  sites.forEach((code, siteIdx) => {
    const site = tooth.sites.find(s => s.site_code === code)
    const mm = siteMetric(site, metric)
    if (mm === null) {
      close()
      return
    }
    run.push({
      x: siteX(toothIdx, siteIdx, geometry),
      y: valueToY(mm, direction, geometry),
      mm,
      toothNumber: tooth.tooth_number,
      siteCode: code
    })
  })
  close()

  return segments
}

/**
 * Every segment of a row of teeth, tooth by tooth.
 *
 * Grouping happens **before** any point is emitted, so there is no list that
 * could be walked across a tooth boundary: the join the strip used to draw
 * between 14 and 15, or between 11 and 21, cannot be produced.
 */
export function buildMetricSegments(
  teeth: ReadonlyArray<Pick<PerioTooth, 'tooth_number' | 'sites'>>,
  sites: readonly SiteCode[],
  metric: ProfileMetric,
  direction: StripDirection,
  geometry: ProfileGeometry = PROFILE_GEOMETRY
): MetricSegment[] {
  return teeth.flatMap((tooth, toothIdx) =>
    buildMetricSegmentsForTooth(tooth, toothIdx, sites, metric, direction, geometry)
  )
}

/** SVG path of a segment, or `null` for a lone point (which has no line). */
export function segmentPath(segment: MetricSegment): string | null {
  if (segment.points.length < 2) return null
  return segment.points
    .map((p, i) => `${i === 0 ? 'M' : 'L'} ${p.x},${p.y}`)
    .join(' ')
}
