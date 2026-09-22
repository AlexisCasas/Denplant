<script setup lang="ts">
/**
 * NtsDentitionRow — one of the four rows of the MINSA odontogram (NTS-05B).
 *
 * Owns exactly one thing: putting its teeth on screen in the order the norm's
 * Anexo prints them. The order itself comes from `NTS_ROWS`, so a row here
 * can never disagree with the row a test asserts.
 *
 * Rows are centred rather than stretched, which is what nests the 10-tooth
 * deciduous arches inside the 16-tooth permanent ones the way the annex does:
 * the deciduous row is shorter because it holds fewer teeth, never because
 * its teeth are drawn smaller.
 */

import type { NtsDentitionRow } from '../../utils/ntsDentition'
import NtsToothCell from './NtsToothCell.vue'

withDefaults(
  defineProps<{
    row: NtsDentitionRow
    /** Pixels per layout unit. The same for every row, deciduous included. */
    scale: number
    /** True while a rule needs teeth picked; the row is inert otherwise. */
    selectable?: boolean
    selectedTeeth?: readonly number[]
    anchorTeeth?: readonly number[]
  }>(),
  { selectable: false, selectedTeeth: () => [], anchorTeeth: () => [] }
)

const emit = defineEmits<{ select: [fdi: number, rowOrder: number[]] }>()
</script>

<template>
  <div
    class="flex justify-center items-stretch"
    :data-testid="`nts-row-${row.id}`"
    :data-row="row.id"
    :data-dentition="row.dentition"
    :data-arch="row.arch"
  >
    <NtsToothCell
      v-for="tooth in row.teeth"
      :key="tooth.fdi"
      :tooth="tooth"
      :scale="scale"
      :selectable="selectable"
      :selected="selectedTeeth.includes(tooth.fdi)"
      :anchor="anchorTeeth.includes(tooth.fdi)"
      @select="emit('select', $event, row.teeth.map(t => t.fdi))"
    />
  </div>
</template>
