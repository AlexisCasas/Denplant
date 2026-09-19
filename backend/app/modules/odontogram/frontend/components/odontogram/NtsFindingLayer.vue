<script setup lang="ts">
/**
 * NtsFindingLayer — draws the instructions, and decides nothing.
 *
 * Everything clinical was settled before this component ran: which findings
 * exist, what they write, where it goes and whether it means good or bad. All
 * that is left here is turning instructions into SVG, which is why there is no
 * catalog, no rule, no finding and no `rule_id` anywhere in this file.
 *
 * Two deliberate choices:
 *
 * * **Presentation attributes, not classes.** `fill` and `stroke` are set on
 *   the elements. A clinical mark that depended on a stylesheet chunk having
 *   loaded is a mark that can come back black — 05B already had that happen to
 *   the tooth outlines — and a red lesion printed black is a wrong clinical
 *   statement, not a styling glitch.
 * * **`currentColor` is not used.** The two clinical colours are their own
 *   tokens so nothing inherited from the page can repaint a finding.
 */

import type {
  NtsAreaFigure,
  NtsArrowInstruction,
  NtsArrowShape,
  NtsBoxOverflow,
  NtsConnectorInstruction,
  NtsLineInstruction,
  NtsOutlineInstruction,
  NtsPaint,
  NtsPoint,
  NtsRenderInstruction,
  NtsShapeFillInstruction,
  NtsSymbolInstruction,
  NtsTextInstruction
} from '../../utils/ntsRenderModel'

const props = withDefaults(
  defineProps<{
    instructions?: readonly NtsRenderInstruction[]
    overflows?: readonly NtsBoxOverflow[]
  }>(),
  { instructions: () => [], overflows: () => [] }
)

/** The norm allows exactly two colours; the tokens carry the values. */
function ink(paint: NtsPaint): string {
  return paint === 'bad' ? 'var(--color-nts-finding-bad)' : 'var(--color-nts-finding-good)'
}

const symbols = computed(
  () => props.instructions.filter((i): i is NtsSymbolInstruction => i.kind === 'symbol')
)

const fills = computed(
  () => props.instructions.filter((i): i is NtsShapeFillInstruction => i.kind === 'shape_fill')
)

const outlines = computed(
  () => props.instructions.filter((i): i is NtsOutlineInstruction => i.kind === 'outline')
)

/**
 * One figure as one path: every ring a closed subpath, in the order given.
 *
 * All of them, deliberately. A figure can enclose an area the finding does not
 * cover, and that arrives as a second ring wound against the first. Emitting
 * only the outer one would fill the gap in and claim ground nobody recorded,
 * and splitting the rings across separate paths would break the relationship
 * the winding encodes — so they stay together, in order, unreordered.
 */
function figurePath(figure: NtsAreaFigure, rings: 'polygons' | 'boundary'): string {
  return figure[rings]
    .map((ring) => {
      const [first, ...rest] = ring
      if (!first) return ''
      return `M${round(first.x)},${round(first.y)} `
        + rest.map(point => `L${round(point.x)},${round(point.y)}`).join(' ')
        + ' Z'
    })
    .filter(Boolean)
    .join(' ')
}

/**
 * Strokes, already resolved upstream.
 *
 * Lines and connectors are the same drawing job — a set of polylines in chart
 * coordinates — so they share one template branch. What they *mean* differs,
 * and that is recorded in `data-kind` for the tests and for anyone reading the
 * DOM; it changes nothing about the geometry, which arrives finished.
 */
const strokeGroups = computed(() =>
  props.instructions.filter(
    (i): i is NtsLineInstruction | NtsConnectorInstruction =>
      i.kind === 'line' || i.kind === 'connector'
  )
)

const arrows = computed(
  () => props.instructions.filter((i): i is NtsArrowInstruction => i.kind === 'arrow')
)

/** `12,3 45,6` — what `<polyline>` wants. */
function pointsOf(points: readonly NtsPoint[]): string {
  return points.map(point => `${round(point.x)},${round(point.y)}`).join(' ')
}

/** Rounded so the same instruction always emits the same bytes, and prints so. */
function round(value: number): number {
  return Math.round(value * 100) / 100
}

/**
 * An arrow's shaft: a polyline, or a quadratic through its middle point when
 * the instruction says the spine is curved.
 */
function shaftPath(arrow: NtsArrowShape): string {
  const [first, ...rest] = arrow.points
  if (!first) return ''
  if (arrow.curved && arrow.points.length === 3) {
    const [, control, end] = arrow.points as [NtsPoint, NtsPoint, NtsPoint]
    return `M${round(first.x)},${round(first.y)} Q${round(control.x)},${round(control.y)} ${round(end.x)},${round(end.y)}`
  }
  return `M${round(first.x)},${round(first.y)} ` +
    rest.map(point => `L${round(point.x)},${round(point.y)}`).join(' ')
}

/** The head, as two strokes meeting at the tip and opening back along the shaft. */
function headPath(arrow: NtsArrowShape): string {
  const points = arrow.points
  const tip = points[points.length - 1]
  const previous = points[points.length - 2]
  if (!tip || !previous) return ''

  const dx = tip.x - previous.x
  const dy = tip.y - previous.y
  const length = Math.hypot(dx, dy) || 1
  const ux = dx / length
  const uy = dy / length
  const size = 4
  // Rotate the reversed unit vector by ±30 degrees.
  const cos = Math.cos(Math.PI / 6)
  const sin = Math.sin(Math.PI / 6)
  const left = { x: -ux * cos - -uy * sin, y: -ux * sin + -uy * cos }
  const right = { x: -ux * cos + -uy * sin, y: ux * sin + -uy * cos }

  return `M${round(tip.x + left.x * size)},${round(tip.y + left.y * size)} ` +
    `L${round(tip.x)},${round(tip.y)} ` +
    `L${round(tip.x + right.x * size)},${round(tip.y + right.y * size)}`
}

/** Only the siglas that were given a line. The rest are counted by an overflow. */
const texts = computed(
  () => props.instructions.filter(
    (i): i is NtsTextInstruction => i.kind === 'text' && i.line !== null
  )
)

const FONT_SIZE = 9
const LINE_HEIGHT = 11

/** Baseline of line `n` inside a box, measured from the box's top. */
function lineY(box: { y: number, height: number }, line: number): number {
  const top = box.y + (box.height - LINE_HEIGHT * 2) / 2
  return top + LINE_HEIGHT * line + FONT_SIZE
}

function textX(box: { x: number, width: number }): number {
  return box.x + box.width / 2
}

// --- symbol paths ----------------------------------------------------------
//
// Each shape is drawn from its own bounds, so a shape placed on a wide molar
// and the same shape on a narrow incisor stay in proportion to what they mark.

function rectOf(s: NtsSymbolInstruction) {
  return { x: s.bounds.x, y: s.bounds.y, width: s.bounds.width, height: s.bounds.height }
}

function radiusOf(s: NtsSymbolInstruction): number {
  return Math.min(s.bounds.width, s.bounds.height) / 2
}

/** The two diagonals of the crown box (a tooth that is not there). */
function crossPath(s: NtsSymbolInstruction): string {
  const { x, y, width, height } = s.bounds
  return `M${x},${y} L${x + width},${y + height} M${x + width},${y} L${x},${y + height}`
}

/** A square with a cross inside it. */
function squareCrossPath(s: NtsSymbolInstruction): string {
  const { x, y, width, height } = s.bounds
  return `M${x},${y} h${width} v${height} h${-width} Z M${x},${y} l${width},${height} M${x + width},${y} l${-width},${height}`
}

/** A triangle standing on its base. */
function trianglePath(s: NtsSymbolInstruction): string {
  const { x, y, width, height } = s.bounds
  return `M${x + width / 2},${y} L${x + width},${y + height} L${x},${y + height} Z`
}

/** ")(" — the norm's inverted parenthesis, drawn either side of the gap. */
function invertedParenthesisPath(s: NtsSymbolInstruction): string {
  const r = radiusOf(s)
  const { x, y } = s.at
  const gap = r * 0.45
  return [
    `M${x - gap},${y - r} Q${x - gap - r * 0.7},${y} ${x - gap},${y + r}`,
    `M${x + gap},${y - r} Q${x + gap + r * 0.7},${y} ${x + gap},${y + r}`
  ].join(' ')
}

/** The centres of two circles that intersect, one over each tooth number. */
function intersectingCircles(s: NtsSymbolInstruction): Array<{ cx: number, cy: number, r: number }> {
  const r = s.bounds.height / 2
  const offset = Math.max(r * 0.6, (s.bounds.width - r * 2) / 2)
  return [
    { cx: s.at.x - offset, cy: s.at.y, r },
    { cx: s.at.x + offset, cy: s.at.y, r }
  ]
}
</script>

<template>
  <!--
    A group, not an <svg>: the chart's overlay already established the
    coordinate space, and nesting a second viewBox would re-scale everything.

    Inert by construction — the chart's tooth buttons underneath own every
    click, and an overlay that intercepted one would break selection silently.
  -->
  <g
    class="pointer-events-none"
    aria-hidden="true"
    data-testid="nts-finding-layer"
  >
    <!--
      Areas first, so nothing clinical is buried under a filled surface: the
      instruction model puts fills and outlines on the two lowest layers, and
      in SVG the document order is the painting order.

      `fill-rule="nonzero"` is the geometry module's own contract, not a
      default taken on trust: it winds a figure's rim one way and any enclosed
      gap the other, which is exactly what the non-zero rule reads as a hole.
      Choosing `evenodd` would happen to agree on these shapes and stop
      agreeing the moment a figure nested twice.
    -->
    <g
      v-for="(area, index) in fills"
      :key="`${area.findingId}-fill-${index}`"
      :data-finding="area.findingId"
      :data-rule="area.ruleId"
      :data-fdi="area.fdi"
      :data-style="area.style"
      :data-paint="area.paint"
      :data-components="area.components.length"
      :data-testid="`nts-fill-${area.findingId}-${area.fdi}`"
    >
      <path
        v-for="(figure, f) in area.components"
        :key="f"
        :d="figurePath(figure, 'polygons')"
        :fill="ink(area.paint)"
        fill-rule="nonzero"
        stroke="none"
        :data-loops="figure.polygons.length"
      />
    </g>

    <!--
      Contours. Stroked from the *boundary*, which has had every edge shared
      between two regions removed, so several affected surfaces read as one
      figure instead of a grid.
    -->
    <g
      v-for="(area, index) in outlines"
      :key="`${area.findingId}-outline-${index}`"
      :data-finding="area.findingId"
      :data-rule="area.ruleId"
      :data-fdi="area.fdi"
      :data-style="area.style"
      :data-paint="area.paint"
      :data-components="area.components.length"
      :data-testid="`nts-outline-${area.findingId}-${area.fdi}`"
    >
      <path
        v-for="(figure, f) in area.components"
        :key="f"
        :d="figurePath(figure, 'boundary')"
        fill="none"
        :stroke="ink(area.paint)"
        stroke-width="1.6"
        stroke-linejoin="round"
        stroke-linecap="round"
        :data-loops="figure.boundary.length"
      />
    </g>

    <!--
      Lines and connectors. Every coordinate arrived resolved; this branch
      knows nothing about arches, spans, roles or roots.
    -->
    <g
      v-for="(stroke, index) in strokeGroups"
      :key="`${stroke.findingId}-${stroke.kind}-${index}`"
      :data-finding="stroke.findingId"
      :data-rule="stroke.ruleId"
      :data-kind="stroke.kind"
      :data-style="stroke.style"
      :data-paint="stroke.paint"
      :data-strokes="stroke.strokes.length"
      :data-testid="`nts-mark-${stroke.findingId}-${stroke.style}`"
    >
      <polyline
        v-for="(polyline, p) in stroke.strokes"
        :key="p"
        :points="pointsOf(polyline)"
        fill="none"
        :stroke="ink(stroke.paint)"
        stroke-width="1.6"
        stroke-linecap="round"
        stroke-linejoin="round"
      />
    </g>

    <!-- arrows -->
    <g
      v-for="(arrow, index) in arrows"
      :key="`${arrow.findingId}-arrow-${index}`"
      :data-finding="arrow.findingId"
      :data-rule="arrow.ruleId"
      :data-style="arrow.style"
      :data-paint="arrow.paint"
      :data-arrows="arrow.arrows.length"
      :data-testid="`nts-mark-${arrow.findingId}-${arrow.style}`"
    >
      <template
        v-for="(shape, a) in arrow.arrows"
        :key="a"
      >
        <path
          :d="shaftPath(shape)"
          fill="none"
          :stroke="ink(arrow.paint)"
          stroke-width="1.5"
          stroke-linecap="round"
          stroke-linejoin="round"
        />
        <path
          :d="headPath(shape)"
          fill="none"
          :stroke="ink(arrow.paint)"
          stroke-width="1.5"
          stroke-linecap="round"
          stroke-linejoin="round"
        />
      </template>
    </g>

    <!-- symbols -->
    <g
      v-for="(symbol, index) in symbols"
      :key="`${symbol.findingId}-symbol-${index}`"
      :data-finding="symbol.findingId"
      :data-rule="symbol.ruleId"
      :data-shape="symbol.shape"
      :data-paint="symbol.paint"
      :data-testid="`nts-mark-${symbol.findingId}-${symbol.shape}`"
    >
      <rect
        v-if="symbol.shape === 'square_bordering_crown' || symbol.shape === 'square'"
        v-bind="rectOf(symbol)"
        fill="none"
        :stroke="ink(symbol.paint)"
        stroke-width="1.6"
      />

      <path
        v-else-if="symbol.shape === 'x_cross'"
        :d="crossPath(symbol)"
        fill="none"
        :stroke="ink(symbol.paint)"
        stroke-width="1.6"
        stroke-linecap="round"
      />

      <path
        v-else-if="symbol.shape === 'square_with_cross'"
        :d="squareCrossPath(symbol)"
        fill="none"
        :stroke="ink(symbol.paint)"
        stroke-width="1.4"
      />

      <path
        v-else-if="symbol.shape === 'triangle'"
        :d="trianglePath(symbol)"
        fill="none"
        :stroke="ink(symbol.paint)"
        stroke-width="1.4"
        stroke-linejoin="round"
      />

      <path
        v-else-if="symbol.shape === 'inverted_parenthesis'"
        :d="invertedParenthesisPath(symbol)"
        fill="none"
        :stroke="ink(symbol.paint)"
        stroke-width="1.6"
        stroke-linecap="round"
      />

      <template v-else-if="symbol.shape === 'two_intersecting_circles'">
        <circle
          v-for="(circle, c) in intersectingCircles(symbol)"
          :key="c"
          :cx="circle.cx"
          :cy="circle.cy"
          :r="circle.r"
          fill="none"
          :stroke="ink(symbol.paint)"
          stroke-width="1.4"
        />
      </template>

      <template v-else-if="symbol.shape === 'circle' || symbol.shape === 'circle_enclosing_sigla'">
        <circle
          :cx="symbol.at.x"
          :cy="symbol.at.y"
          :r="radiusOf(symbol)"
          fill="none"
          :stroke="ink(symbol.paint)"
          stroke-width="1.4"
        />
        <!-- The sigla rides inside the circumference, not in the box. -->
        <text
          v-if="symbol.enclosedText"
          :x="symbol.at.x"
          :y="symbol.at.y + FONT_SIZE / 2 - 1"
          text-anchor="middle"
          :font-size="FONT_SIZE - 1"
          font-weight="600"
          :fill="ink(symbol.paint)"
          :data-testid="`nts-sigla-${symbol.findingId}`"
        >{{ symbol.enclosedText }}</text>
      </template>
    </g>

    <!-- siglas in their annotation boxes -->
    <text
      v-for="(entry, index) in texts"
      :key="`${entry.findingId}-text-${index}`"
      :x="textX(entry.box)"
      :y="lineY(entry.box, entry.line ?? 0)"
      text-anchor="middle"
      :font-size="FONT_SIZE"
      font-weight="600"
      :fill="ink(entry.paint)"
      :data-finding="entry.findingId"
      :data-rule="entry.ruleId"
      :data-fdi="entry.fdi"
      :data-paint="entry.paint"
      :data-testid="`nts-sigla-${entry.findingId}`"
    >{{ entry.text }}</text>

    <!--
      Overflow indicator. NOT an NTS symbol: the norm defines no "+n" and this
      carries no clinical meaning. It exists so a box that cannot show every
      sigla says so, instead of quietly showing a subset. It is drawn in the
      chart's neutral ink precisely so it cannot be mistaken for a finding.
    -->
    <text
      v-for="overflow in overflows"
      :key="`overflow-${overflow.fdi}`"
      :x="textX(overflow.box)"
      :y="lineY(overflow.box, overflow.line)"
      text-anchor="middle"
      :font-size="FONT_SIZE - 1"
      fill="var(--color-text-muted)"
      :data-fdi="overflow.fdi"
      :data-testid="`nts-box-overflow-${overflow.fdi}`"
    >+{{ overflow.hidden }}</text>
  </g>
</template>
