/**
 * NTS N.° 188 print layout — the physical page, in millimetres.
 *
 * Everything the chart knows about itself is in CSS pixels, because that is
 * what the screen is made of. A printed sheet is made of millimetres, and the
 * norm's one dimensional requirement is stated in square centimetres. This
 * module is the conversion, and the place where "does the sheet satisfy
 * §5.17?" becomes a question with an arithmetic answer.
 *
 * **Why the conversion is exact.** CSS defines `1px` as exactly 1/96 inch for
 * print, independently of the device's dots per inch. So the chart's 646 CSS
 * pixels are 170.9 mm on paper in any conforming browser — not approximately,
 * by definition. Nothing here measures anything at runtime.
 *
 * **Nothing clinical is duplicated.** Crown sizes are read back out of
 * `ntsChartGeometry.crownBox()`, the same placement model the renderer draws
 * from. If a tooth's geometry ever changes, these numbers change with it and
 * the guard below fails — which is the entire point of deriving rather than
 * restating them.
 *
 * The A4 page and its margins are a **product decision**, consistent with the
 * annex but not stated by the norm: NTS 188 says nothing about paper size,
 * orientation or margins. The 0.5 cm² minimum is the norm's (§5.17).
 */

import { NTS_CHART_HEIGHT, NTS_CHART_WIDTH, NTS_PLACEMENTS, crownBox } from './ntsChartGeometry'

// ---------------------------------------------------------------------------
// units
// ---------------------------------------------------------------------------

/** CSS's definition, not a device property. */
export const CSS_PX_PER_INCH = 96
export const MM_PER_INCH = 25.4

export function pxToMm(px: number): number {
  return (px * MM_PER_INCH) / CSS_PX_PER_INCH
}

// ---------------------------------------------------------------------------
// the page
// ---------------------------------------------------------------------------

/**
 * A4 portrait with a 10 mm gutter and a slightly deeper foot.
 *
 * A product decision. The annex is A4 portrait, the chart fits it at full
 * size, and portrait matches the Ficha this graphic is bound into (§5.2).
 * These numbers must stay in step with the `@page` rule in `main.css`; the
 * CSS tests assert that they do.
 */
export const NTS_PRINT_PAGE = {
  widthMm: 210,
  heightMm: 297,
  marginTopMm: 10,
  marginRightMm: 10,
  marginBottomMm: 12,
  marginLeftMm: 10
} as const

export const NTS_PRINT_CONTENT_WIDTH_MM =
  NTS_PRINT_PAGE.widthMm - NTS_PRINT_PAGE.marginLeftMm - NTS_PRINT_PAGE.marginRightMm

export const NTS_PRINT_CONTENT_HEIGHT_MM =
  NTS_PRINT_PAGE.heightMm - NTS_PRINT_PAGE.marginTopMm - NTS_PRINT_PAGE.marginBottomMm

// ---------------------------------------------------------------------------
// the chart on paper
// ---------------------------------------------------------------------------

/** The chart's own width and height, in millimetres of paper. */
export const NTS_PRINT_CHART_WIDTH_MM = pxToMm(NTS_CHART_WIDTH)
export const NTS_PRINT_CHART_HEIGHT_MM = pxToMm(NTS_CHART_HEIGHT)

/**
 * The width the print stylesheet declares for the chart, in whole mm.
 *
 * The stylesheet cannot import a TypeScript constant, so the number is
 * written there literally and this is what it must equal. A test compares the
 * two, which is how a change to the chart's geometry is stopped from silently
 * disagreeing with the printed page.
 */
export const NTS_PRINT_CHART_DECLARED_WIDTH_MM = Math.round(NTS_PRINT_CHART_WIDTH_MM)

// ---------------------------------------------------------------------------
// §5.17
// ---------------------------------------------------------------------------

/**
 * "La corona tiene como mínimo 0.5 cm cuadrados" (§5.17).
 *
 * The one legal number in this module. Everything else is derived.
 */
export const NTS_MIN_CROWN_AREA_CM2 = 0.5

/**
 * The printed area of one tooth's crown, in cm².
 *
 * Read from the placement model rather than from a table of crown sizes: the
 * question is how big the crown *is on the page*, and the only authority on
 * that is the geometry the chart is actually drawn from.
 */
export function printedCrownAreaCm2(fdi: number, scale = 1): number | null {
  const box = crownBox(fdi)
  if (!box) return null
  const widthMm = pxToMm(box.width) * scale
  const heightMm = pxToMm(box.height) * scale
  return (widthMm * heightMm) / 100
}

/**
 * The smallest uniform scale at which **every** crown still meets §5.17.
 *
 * Computed over all 52 teeth, so it reports the binding constraint rather
 * than assuming which tooth it is. It happens to be an incisor — the crowns
 * share a height and the front teeth are the narrowest — but that is an
 * output here, not an assumption.
 *
 * Printing below this scale produces a sheet that does not satisfy the norm.
 * 05F.2 prints at 1.0 and needs no scaling; this exists so that a later
 * change which introduces one cannot quietly cross the line.
 */
export function minimumSafePrintScale(): number {
  let required = 0
  for (const placement of NTS_PLACEMENTS) {
    const area = printedCrownAreaCm2(placement.fdi)
    if (area === null || area <= 0) continue
    required = Math.max(required, Math.sqrt(NTS_MIN_CROWN_AREA_CM2 / area))
  }
  return required
}

/** The tooth that decides {@link minimumSafePrintScale} — the smallest crown. */
export function smallestPrintedCrown(): { fdi: number, areaCm2: number } | null {
  let worst: { fdi: number, areaCm2: number } | null = null
  for (const placement of NTS_PLACEMENTS) {
    const areaCm2 = printedCrownAreaCm2(placement.fdi)
    if (areaCm2 === null) continue
    if (!worst || areaCm2 < worst.areaCm2) worst = { fdi: placement.fdi, areaCm2 }
  }
  return worst
}
