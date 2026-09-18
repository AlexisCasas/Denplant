<script setup lang="ts">
/**
 * NtsOdontogramChart — the dental layout of the MINSA odontogram (NTS-05B).
 *
 * Reproduces the structure of the norm's **Anexo: Gráfico del odontograma**
 * (NTS N.° 188-MINSA/DGIESP-2022, p. 22): the boxed ODONTOGRAMA heading, then
 * four rows stacked permanent upper → deciduous upper → deciduous lower →
 * permanent lower, all 52 teeth, every one with its FDI number and its
 * annotation box on the outer side.
 *
 * What it does **not** do: draw findings. A record may already carry some,
 * and this component says so in words rather than inventing symbols for them
 * — a wrong symbol on an odontogram is a wrong clinical statement, and an
 * absent one at least reads as absent. The finding renderer is a later
 * ticket; the notice disappears with it.
 *
 * No HTTP, no mutation, no lifecycle state: the shell owns all of that and
 * passes down the one record to display.
 */

import type { NtsCatalog, NtsRecord } from '../../types/nts'
import { NTS_ROWS } from '../../utils/ntsDentition'
import {
  NTS_CHART_HEIGHT,
  NTS_CHART_SCALE,
  NTS_CHART_VIEWBOX,
  NTS_CHART_WIDTH
} from '../../utils/ntsChartGeometry'
import { resolveChart } from '../../utils/ntsRenderModel'
import NtsDentitionRow from './NtsDentitionRow.vue'
import NtsFindingLayer from './NtsFindingLayer.vue'

const props = withDefaults(
  defineProps<{
    /** The record the chart stands for, or null for the bare structure. */
    record?: NtsRecord | null
    /**
     * Presentation only in 05B — nothing here mutates yet. It exists so the
     * finding editor can be gated on it without re-plumbing the chart.
     */
    readonly?: boolean
    /**
     * True only while the editor has a rule that needs teeth. The chart
     * itself decides nothing clinical: it reports clicks and paints the
     * selection it is given.
     */
    selectable?: boolean
    selectedTeeth?: readonly number[]
    anchorTeeth?: readonly number[]
    /**
     * The catalog the record's findings cite.
     *
     * Without it the chart draws the blank form: a finding cannot be rendered
     * from the record alone, because what it looks like is the norm's business
     * and the norm lives in the catalog.
     */
    catalog?: NtsCatalog | null
  }>(),
  {
    record: null,
    readonly: false,
    selectable: false,
    selectedTeeth: () => [],
    anchorTeeth: () => [],
    catalog: null
  }
)

const emit = defineEmits<{ toothSelect: [fdi: number, rowOrder: number[]] }>()

const { t } = useI18n()

/**
 * Scale and dimensions now come from `ntsChartGeometry`, which is the one
 * place that knows how the chart is laid out.
 *
 * They used to be computed here, which was fine while nothing else needed
 * them. Anything that draws across teeth needs the same numbers, and two
 * copies of a coordinate system is two coordinate systems.
 *
 * The values are unchanged: one scale for the whole chart (the annex draws a
 * deciduous molar the size of a permanent one), and a deterministic minimum
 * width taken from the widest row, so rows never reflow and the chart prints
 * as it renders.
 */
const CHART_SCALE = NTS_CHART_SCALE
const CHART_MIN_WIDTH = NTS_CHART_WIDTH

const rows = NTS_ROWS

const findingCount = computed(() => props.record?.findings.length ?? 0)

/**
 * The drawing, resolved from the record and the catalog.
 *
 * All of the clinical reasoning happens in `resolveChart`, which is pure: this
 * component passes data in and hands instructions to the layer.
 */
const render = computed(() =>
  props.catalog && props.record
    ? resolveChart(props.record.findings, props.catalog.rules)
    : null
)

/**
 * Findings this build can only draw in part, or not at all.
 *
 * Reported in words next to the chart rather than approximated on it: half a
 * mark reads as a different finding, and an absent one at least reads as
 * absent. The notice shrinks as the remaining mark kinds land.
 */
const incomplete = computed(() => {
  if (!render.value) return 0
  return render.value.partial.length + render.value.unsupported.length
})

/** Siglas that have no room in their box. Counted, never dropped. */
const hiddenSiglas = computed(() =>
  render.value?.overflows.reduce((total, overflow) => total + overflow.hidden, 0) ?? 0
)
</script>

<template>
  <section
    class="space-y-3"
    data-testid="nts-odontogram-chart"
    :data-readonly="readonly ? 'true' : 'false'"
    :aria-label="t('odontogram.nts.chart.title')"
  >
    <div class="flex items-center justify-between gap-3 flex-wrap">
      <!-- The annex heads the graphic with a boxed ODONTOGRAMA label. -->
      <p
        class="px-4 py-1 border border-default rounded-token-sm text-sm font-medium
               tracking-wide text-default uppercase"
        data-testid="nts-chart-title"
      >
        {{ t('odontogram.nts.chart.title') }}
      </p>

      <UBadge
        v-if="readonly"
        color="neutral"
        variant="subtle"
        size="sm"
        data-testid="nts-chart-readonly"
      >
        {{ t('odontogram.nts.chart.readonly') }}
      </UBadge>
    </div>

    <!-- No record behind the chart: it is a blank form, and saying so is the
         difference between "nothing was found" and "nothing was recorded". -->
    <p
      v-if="!record"
      class="text-caption text-subtle"
      data-testid="nts-chart-no-record"
    >
      {{ t('odontogram.nts.chart.noRecord') }}
    </p>

    <!--
      One scroll container for all four rows, never one per row: rows that
      scrolled independently would drift out of vertical alignment and put a
      deciduous tooth under the wrong permanent one.
    -->
    <div
      class="overflow-x-auto"
      data-testid="nts-chart-scroll"
    >
      <div
        class="relative mx-auto py-2 space-y-1"
        :style="{ minWidth: `${CHART_MIN_WIDTH}px` }"
        data-testid="nts-chart-canvas"
      >
        <NtsDentitionRow
          v-for="row in rows"
          :key="row.id"
          :row="row"
          :scale="CHART_SCALE"
          :selectable="selectable"
          :selected-teeth="selectedTeeth"
          :anchor-teeth="anchorTeeth"
          :class="row.id === 'deciduousUpper' ? 'pt-3' : row.id === 'permanentLower' ? 'pt-3' : ''"
          @select="(fdi, rowOrder) => emit('toothSelect', fdi, rowOrder)"
        />

        <!--
          The shared coordinate space for everything that spans teeth.

          It carries the deterministic viewBox from `ntsChartGeometry`, it is
          centred exactly as the rows are, and being inside the canvas it
          scrolls with them on a narrow screen instead of drifting off the
          teeth.

          Placed last, and with its own margin zeroed, because the canvas
          separates its children with `space-y-1`: as a first child it would
          have pushed every row down by the gap, and as a later one it would
          have taken that gap onto itself and landed 4px below the teeth.

          `pointer-events-none` is not a detail. The chart's hit areas are the
          tooth buttons underneath, and an overlay that swallowed a click would
          silently break every selection flow the finding editor depends on.
        -->
        <svg
          class="pointer-events-none absolute top-0 left-1/2 -translate-x-1/2"
          :viewBox="NTS_CHART_VIEWBOX"
          :width="NTS_CHART_WIDTH"
          :height="NTS_CHART_HEIGHT"
          :style="{ marginTop: '0' }"
          aria-hidden="true"
          focusable="false"
          data-testid="nts-chart-overlay"
        >
          <NtsFindingLayer
            v-if="render"
            :instructions="render.instructions"
            :overflows="render.overflows"
          />
        </svg>
      </div>
    </div>

    <!--
      What is on the record but not yet on the drawing.

      Two separate counts, because they are different problems. `incomplete` is
      this build not yet knowing how to draw a mark kind; `hiddenSiglas` is a
      box physically too small for every sigla on that tooth. Neither is ever
      resolved by inventing a symbol, and neither is ever left unsaid.
    -->
    <UAlert
      v-if="incomplete > 0"
      color="neutral"
      variant="subtle"
      icon="i-lucide-shapes"
      :title="t('odontogram.nts.chart.findingsPending', { count: incomplete })"
      :description="t('odontogram.nts.chart.findingsPendingHint')"
      data-testid="nts-chart-findings-pending"
    />

    <UAlert
      v-if="hiddenSiglas > 0"
      color="neutral"
      variant="subtle"
      icon="i-lucide-layers"
      :title="t('odontogram.nts.chart.siglasHidden', { count: hiddenSiglas })"
      :description="t('odontogram.nts.chart.siglasHiddenHint')"
      data-testid="nts-chart-siglas-hidden"
    />

    <!-- A record whose findings cannot be drawn at all still says so. -->
    <UAlert
      v-if="!catalog && findingCount > 0"
      color="neutral"
      variant="subtle"
      icon="i-lucide-shapes"
      :title="t('odontogram.nts.chart.findingsPending', { count: findingCount })"
      :description="t('odontogram.nts.chart.findingsPendingHint')"
      data-testid="nts-chart-findings-pending"
    />
  </section>
</template>
