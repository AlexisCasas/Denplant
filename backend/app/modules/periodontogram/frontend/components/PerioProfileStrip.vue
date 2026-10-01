<script setup lang="ts">
/**
 * SEPA-style sulcus profile strip.
 *
 * Plots two independent series across a row of teeth — Margen (gingival
 * margin, calm blue) and Sondaje (probing depth) — over a backdrop of
 * horizontal millimetre gridlines so the dentist can read them as heights,
 * not just numbers. Each series is measured from the baseline (the 0 mm line,
 * the CEJ) on its own; the sum of the two is a number in the Suma row, not a
 * line here.
 *
 * The strip is a flat SVG positioned next to a tooth row, in the direction of
 * the rendered root (the periodontal pocket lives in the root area).
 * Baseline = CEJ ≈ where the gum line of the tooth silhouettes lands.
 * `direction` says which way a positive value runs: `depth-up` strips sit
 * above their tooth row, `depth-down` strips below it.
 *
 * Every number is computed by `periodontalProfileGeometry` — this component
 * only draws it. A tooth is never joined to its neighbour, an unmeasured site
 * (null) ends the line it interrupts, and a 0 is a real point on the baseline.
 * A probing depth of 4 mm or more is a red dot; the line stays neutral, since
 * what is pathological is the site that was measured, not the stretch between
 * two sites.
 */
import { computed } from 'vue'
import type { PerioTooth, SiteCode } from '../types'
import { PALATAL_SITES, VESTIBULAR_SITES } from '../types'
import {
  PROFILE_GEOMETRY,
  buildMetricSegments,
  segmentPath,
  stripHeight,
  valueToY
} from '../utils/periodontalProfileGeometry'
import { isPathologicalProbing } from '../composables/usePerioHeatmap'

const props = defineProps<{
  teeth: PerioTooth[]
  face: 'vestibular' | 'palatal' | 'lingual'
  /**
   * `depth-up`   — baseline at bottom edge, depth grows upward (strip
   *                placed above its tooth row, where the root renders).
   * `depth-down` — baseline at top edge, depth grows downward (strip
   *                placed below its tooth row).
   */
  direction: 'depth-up' | 'depth-down'
}>()

const STRIP_H = stripHeight()
const MM_MAX = PROFILE_GEOMETRY.maxMm

const sites = computed<readonly SiteCode[]>(() =>
  props.face === 'vestibular' ? VESTIBULAR_SITES : PALATAL_SITES
)

const stripWidth = computed(() => props.teeth.length * PROFILE_GEOMETRY.colWidth)

const marginSegments = computed(() =>
  buildMetricSegments(props.teeth, sites.value, 'margin', props.direction)
)
const probingSegments = computed(() =>
  buildMetricSegments(props.teeth, sites.value, 'probing', props.direction)
)

/** One entry per drawable line: a segment of two or more points. */
function lines(segments: ReturnType<typeof buildMetricSegments>) {
  return segments.flatMap((segment, index) => {
    const d = segmentPath(segment)
    return d === null ? [] : [{ key: `${segment.toothNumber}-${index}`, tooth: segment.toothNumber, d }]
  })
}

const marginLines = computed(() => lines(marginSegments.value))
const probingLines = computed(() => lines(probingSegments.value))
const marginDots = computed(() => marginSegments.value.flatMap(s => s.points))
const probingDots = computed(() => probingSegments.value.flatMap(s => s.points))

const gridlines = computed(() => {
  const out: Array<{ y: number, mm: number }> = []
  // Include 0 mm (CEJ) — the first millimetre line must pass through
  // the gum line so the dentist can read depth directly off the gridline,
  // without a separate red gum curve on the tooth.
  for (let m = 0; m <= MM_MAX; m++) out.push({ y: valueToY(m, props.direction), mm: m })
  return out
})
</script>

<template>
  <!-- `overflow: visible`: a margin can be negative (down to -5 mm), which
       lies on the far side of the 0 mm baseline, outside the 0…15 mm domain
       the viewBox covers. The default would clip it. -->
  <svg
    :viewBox="`0 0 ${stripWidth} ${STRIP_H}`"
    :width="stripWidth"
    :height="STRIP_H"
    class="perio-profile-strip block"
    style="overflow: visible"
    preserveAspectRatio="none"
    aria-hidden="true"
    :data-direction="direction"
  >
    <!-- Millimetre gridlines: hairline gray, bolder at 0/5/10/15.
         The 0 mm line is the CEJ — it doubles as the gum line that
         used to be drawn on the tooth silhouette. -->
    <g>
      <line
        v-for="g in gridlines"
        :key="`grid-${g.mm}`"
        x1="0"
        :x2="stripWidth"
        :y1="g.y"
        :y2="g.y"
        :stroke="g.mm % 5 === 0 ? 'var(--perio-grid-line-bold)' : 'var(--perio-grid-line)'"
        :stroke-width="g.mm % 5 === 0 ? 0.6 : 0.35"
      />
    </g>

    <!-- Margen (calm sky): one path per run of sites of one tooth. -->
    <g data-series="margin">
      <path
        v-for="line in marginLines"
        :key="`gm-${line.key}`"
        :d="line.d"
        :data-tooth="line.tooth"
        data-testid="perio-strip-path-margin"
        fill="none"
        stroke="var(--perio-gm-stroke)"
        stroke-width="1.4"
        stroke-linejoin="round"
        stroke-linecap="round"
      />
      <circle
        v-for="p in marginDots"
        :key="`gm-dot-${p.toothNumber}-${p.siteCode}`"
        :cx="p.x"
        :cy="p.y"
        r="1.8"
        fill="var(--perio-gm-stroke)"
        :data-tooth="p.toothNumber"
        :data-site="p.siteCode"
        :data-mm="p.mm"
        data-testid="perio-strip-dot-margin"
      />
    </g>

    <!-- Sondaje: a neutral line, with a red dot only on the sites whose
         probing depth is 4 mm or more. -->
    <g data-series="probing">
      <path
        v-for="line in probingLines"
        :key="`pd-${line.key}`"
        :d="line.d"
        :data-tooth="line.tooth"
        data-testid="perio-strip-path-probing"
        fill="none"
        stroke="var(--color-text-muted)"
        stroke-width="1.4"
        stroke-linejoin="round"
        stroke-linecap="round"
      />
      <circle
        v-for="p in probingDots"
        :key="`pd-dot-${p.toothNumber}-${p.siteCode}`"
        :cx="p.x"
        :cy="p.y"
        r="2"
        :fill="isPathologicalProbing(p.mm) ? 'var(--perio-pd-stroke)' : 'var(--color-text-muted)'"
        :data-tooth="p.toothNumber"
        :data-site="p.siteCode"
        :data-mm="p.mm"
        :data-alert="isPathologicalProbing(p.mm) ? 'true' : 'false'"
        data-testid="perio-strip-dot-probing"
      />
    </g>
  </svg>
</template>

<style scoped>
.perio-profile-strip {
  width: 100%;
  height: auto;
}
</style>
