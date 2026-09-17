<script setup lang="ts">
/**
 * NtsToothCell — one tooth of the MINSA odontogram (NTS-05B).
 *
 * Reproduces the cell of the norm's Anexo (p. 22): an annotation box on the
 * outer side, the FDI number, and the tooth itself — crown square divided by
 * its four corner diagonals, plus roots pointing away from the midline.
 *
 * It draws **structure only**. No finding is rendered, no surface is named,
 * no colour carries meaning: red and blue are reserved by the norm for what
 * a finding *means*, and spending them on decoration here would make them
 * unreadable later.
 *
 * Explicit relative import: the `module_layers` symlink does not resolve in
 * the frontend test suite, so the layer's auto-imports are unavailable there.
 */

import type { NtsTooth } from '../../utils/ntsDentition'
import { NTS_CELL_HEIGHT, cellWidthFor, toothGeometry } from '../../utils/ntsDentition'

const props = withDefaults(
  defineProps<{
    tooth: NtsTooth
    /**
     * Pixels per layout unit. Every row shares one, so a deciduous molar comes
     * out the size of a permanent one — as the annex draws it — and a narrow
     * incisor lands on the same baseline as a wide molar.
     */
    scale: number
    /**
     * True only while a rule actually needs teeth picked. The chart is inert
     * otherwise, so a reader never meets 52 tab stops that lead nowhere.
     */
    selectable?: boolean
    selected?: boolean
    /** Picked as a spatial reference rather than as the clinical subject. */
    anchor?: boolean
  }>(),
  { selectable: false, selected: false, anchor: false }
)

const emit = defineEmits<{ select: [fdi: number] }>()

const { t } = useI18n()

const geometry = computed(() => toothGeometry(props.tooth))
const isUpper = computed(() => props.tooth.arch === 'upper')

/**
 * The column width follows the tooth class, exactly as the annex draws it:
 * the annotation box, the FDI number and the tooth share one width, so a box
 * always sits over the tooth it belongs to.
 */
const widthPx = computed(() => cellWidthFor(props.tooth) * props.scale)
/** Identical for every class, so crowns in a row share one baseline. */
const heightPx = computed(() => NTS_CELL_HEIGHT * props.scale)

/**
 * "Diente 11" / "Diente deciduo 51".
 *
 * A screen reader gets the tooth from its label, never from where it happens
 * to sit in the row.
 */
const label = computed(() =>
  props.tooth.dentition === 'deciduous'
    ? t('odontogram.nts.chart.deciduousTooth', { fdi: props.tooth.fdi })
    : t('odontogram.nts.chart.tooth', { fdi: props.tooth.fdi })
)

/**
 * What a screen reader is told, which is never just "selected": the label
 * says what clicking does and what state the tooth is already in, because
 * highlight alone carries none of that.
 */
const actionLabel = computed(() => {
  if (props.selected) {
    return t('odontogram.nts.editor.a11y.selected', { tooth: label.value })
  }
  if (props.anchor) {
    return t('odontogram.nts.editor.a11y.anchorSelected', { tooth: label.value })
  }
  return t('odontogram.nts.editor.a11y.select', { tooth: label.value })
})

/**
 * Selection styling uses interaction tokens, never red or blue: the norm
 * gives those two colours clinical meaning and the finding renderer needs
 * them intact.
 */
const stateClass = computed(() => {
  if (props.selected) return 'bg-primary-accent/10 ring-2 ring-primary-accent'
  if (props.anchor) return 'bg-surface-sunken ring-1 ring-strong ring-dashed'
  return props.selectable ? 'hover:bg-surface-muted' : ''
})
</script>

<template>
  <component
    :is="selectable ? 'button' : 'div'"
    :type="selectable ? 'button' : undefined"
    class="flex flex-col shrink-0 rounded-token-xs transition-colors"
    :class="stateClass"
    :style="{ width: `${widthPx}px` }"
    :data-testid="`nts-tooth-${tooth.fdi}`"
    :data-fdi="tooth.fdi"
    :data-dentition="tooth.dentition"
    :data-arch="tooth.arch"
    :data-side="tooth.side"
    :data-quadrant="tooth.quadrant"
    :data-selected="selected ? 'true' : undefined"
    :data-anchor="anchor ? 'true' : undefined"
    :aria-pressed="selectable ? selected || anchor : undefined"
    :aria-label="selectable ? actionLabel : undefined"
    @click="selectable && emit('select', tooth.fdi)"
  >
    <!-- Annotation box. The annex puts it on the outer side of every row —
         above the upper arches, below the lower ones — and that is where the
         siglas go, so it is reserved now and filled by the finding renderer. -->
    <div
      v-if="isUpper"
      class="h-10 border border-default -ml-px"
      data-region="annotation"
      aria-hidden="true"
    />

    <p
      v-if="isUpper"
      class="text-center text-[11px] leading-5 font-medium text-default tabular-nums"
      data-region="fdi"
    >
      {{ tooth.fdi }}
    </p>

    <!--
      Stroke and fill are presentation attributes on the <svg>, inherited by
      every path, rather than a stylesheet rule: an outline that depends on a
      CSS chunk having loaded is an outline that can come back as a solid
      black block if it has not. `currentColor` plus a token-backed `color` is
      what keeps it theme-aware without naming a colour. The token is a mid
      neutral: the border tokens are 18% alpha and leave the outline too faint
      to read as a clinical form.
    -->
    <svg
      class="w-full"
      :viewBox="geometry.viewBox"
      :role="selectable ? 'presentation' : 'img'"
      :aria-label="selectable ? undefined : label"
      preserveAspectRatio="xMidYMid meet"
      fill="none"
      stroke="currentColor"
      stroke-width="3"
      stroke-linejoin="round"
      :style="{ height: `${heightPx}px`, color: 'var(--color-text-muted)' }"
    >
      <path
        v-for="root in geometry.roots"
        :key="root"
        :d="root"
        data-region="root"
      />
      <path
        v-for="region in geometry.regions"
        :key="region.id"
        :d="region.d"
        :data-region="region.id"
      />
    </svg>

    <p
      v-if="!isUpper"
      class="text-center text-[11px] leading-5 font-medium text-default tabular-nums"
      data-region="fdi"
    >
      {{ tooth.fdi }}
    </p>

    <div
      v-if="!isUpper"
      class="h-10 border border-default -ml-px"
      data-region="annotation"
      aria-hidden="true"
    />
  </component>
</template>
