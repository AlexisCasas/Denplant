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

import type { NtsRecord } from '../../types/nts'
import { NTS_ROWS, rowWidthFor } from '../../utils/ntsDentition'
import NtsDentitionRow from './NtsDentitionRow.vue'

const props = withDefaults(
  defineProps<{
    /** The record the chart stands for, or null for the bare structure. */
    record?: NtsRecord | null
    /**
     * Presentation only in 05B — nothing here mutates yet. It exists so the
     * finding editor can be gated on it without re-plumbing the chart.
     */
    readonly?: boolean
  }>(),
  { record: null, readonly: false }
)

const { t } = useI18n()

/**
 * Pixels per layout unit — one scale for the whole chart.
 *
 * The annex draws a deciduous molar the same size as a permanent one: its
 * deciduous rows are shorter because they hold ten teeth instead of sixteen,
 * not because the teeth are miniaturised. Scaling them down would be this
 * renderer inventing a distinction the norm does not draw, so the dentitions
 * are told apart by position and by their FDI numbers alone.
 *
 * Tooth *widths* are not set here: each class carries its own, so a narrow
 * incisor and a wide molar keep the annex's proportions.
 */
const CHART_SCALE = 0.484

const rows = NTS_ROWS

/**
 * A fixed inner width rather than a fluid one: the row must not reflow into a
 * different tooth order on a narrow screen, and a deterministic width is also
 * what makes the chart printable later. It comes from the widest row so the
 * deciduous arches stay centred inside the permanent ones.
 */
const CHART_MIN_WIDTH = Math.round(
  Math.max(...rows.map(row => rowWidthFor(row.teeth))) * CHART_SCALE
)

const findingCount = computed(() => props.record?.findings.length ?? 0)
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
        class="mx-auto py-2 space-y-1"
        :style="{ minWidth: `${CHART_MIN_WIDTH}px` }"
        data-testid="nts-chart-canvas"
      >
        <NtsDentitionRow
          v-for="row in rows"
          :key="row.id"
          :row="row"
          :scale="CHART_SCALE"
          :class="row.id === 'deciduousUpper' ? 'pt-3' : row.id === 'permanentLower' ? 'pt-3' : ''"
        />
      </div>
    </div>

    <!-- Findings exist but cannot be drawn yet. Never silently omitted. -->
    <UAlert
      v-if="findingCount > 0"
      color="neutral"
      variant="subtle"
      icon="i-lucide-shapes"
      :title="t('odontogram.nts.chart.findingsPending', { count: findingCount })"
      :description="t('odontogram.nts.chart.findingsPendingHint')"
      data-testid="nts-chart-findings-pending"
    />
  </section>
</template>
