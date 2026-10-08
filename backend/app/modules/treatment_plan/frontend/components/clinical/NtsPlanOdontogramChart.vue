<script setup lang="ts">
/**
 * Treatment-plan projection on the NTS layout.
 *
 * This intentionally reuses the odontogram module's structural rows and
 * chart-wide coordinate system, but it does not import the NTS finding
 * renderer.  Treatments are plan data, not MINSA findings.
 */
import type { PlannedTreatmentItem } from '~~/app/types'
import { NTS_ROWS } from '../../../../odontogram/frontend/utils/ntsDentition'
import {
  NTS_CHART_HEIGHT,
  NTS_CHART_SCALE,
  NTS_CHART_VIEWBOX,
  NTS_CHART_WIDTH,
  toothPlacement
} from '../../../../odontogram/frontend/utils/ntsChartGeometry'
import NtsDentitionRow from '../../../../odontogram/frontend/components/odontogram/NtsDentitionRow.vue'

const props = withDefaults(defineProps<{
  items: PlannedTreatmentItem[]
  highlightedTeeth?: number[]
}>(), { highlightedTeeth: () => [] })

const emit = defineEmits<{ toothSelect: [fdi: number] }>()

type Surface = 'M' | 'D' | 'O' | 'V' | 'L'

interface ToothMarker {
  itemId: string
  treatmentId: string
  fdi: number
  type: string
  status: PlannedTreatmentItem['status']
  surfaces: Surface[]
  role: 'pillar' | 'pontic' | null
}

const markers = computed<ToothMarker[]>(() => props.items.flatMap(item =>
  (item.treatment?.teeth ?? []).map(tooth => ({
    itemId: item.id,
    treatmentId: item.treatment?.id ?? item.treatment_id,
    fdi: tooth.tooth_number,
    type: item.treatment?.clinical_type ?? 'migrated',
    status: item.status,
    surfaces: (tooth.surfaces ?? []) as Surface[],
    role: tooth.role ?? null
  }))
))

const markersByTooth = computed(() => markers.value.reduce<Record<number, ToothMarker[]>>((byTooth, marker) => {
  ;(byTooth[marker.fdi] ??= []).push(marker)
  return byTooth
}, {}))

const bridges = computed(() => props.items
  .filter(item => item.treatment?.clinical_type === 'bridge')
  .map(item => (item.treatment?.teeth ?? []).map(tooth => tooth.tooth_number)
    .map(toothPlacement)
    .filter((placement): placement is NonNullable<typeof placement> => placement !== null))
  .filter(placements => placements.length > 1))

function surfacePoint(marker: ToothMarker, surface: Surface) {
  const crown = toothPlacement(marker.fdi)?.crown
  if (!crown) return null
  const x = crown.x
  const y = crown.y
  const w = crown.width
  const h = crown.height
  const points: Record<Surface, { x: number, y: number }> = {
    M: { x: x + w * 0.22, y: y + h * 0.5 },
    D: { x: x + w * 0.78, y: y + h * 0.5 },
    O: { x: x + w * 0.5, y: y + h * 0.5 },
    V: { x: x + w * 0.5, y: y + h * 0.22 },
    L: { x: x + w * 0.5, y: y + h * 0.78 }
  }
  return points[surface]
}

function markerTone(marker: ToothMarker) {
  // Neutral tones distinguish plan state without spending MINSA finding
  // colours (red/blue), whose meaning is reserved for the diagnosis record.
  if (marker.status === 'completed') return 'var(--color-success-500)'
  if (marker.status === 'cancelled') return 'var(--color-text-dimmed)'
  return 'var(--color-primary-500)'
}

function markerTitle(marker: ToothMarker) {
  const role = marker.role ? ` (${marker.role})` : ''
  return `${marker.type}${role}`
}
</script>

<template>
  <section
    class="space-y-3"
    data-testid="nts-plan-odontogram-chart"
    aria-label="Odontograma del plan de tratamiento"
  >
    <p
      class="text-caption text-subtle"
      data-testid="nts-plan-odontogram-description"
    >
      Tratamientos del plan sobre la geometría del odontograma clínico. Los indicadores no son hallazgos MINSA.
    </p>

    <div
      class="overflow-x-auto"
      data-testid="nts-plan-chart-scroll"
    >
      <div
        class="relative mx-auto py-2 space-y-1"
        :style="{ minWidth: `${NTS_CHART_WIDTH}px` }"
        data-testid="nts-plan-chart-canvas"
      >
        <NtsDentitionRow
          v-for="row in NTS_ROWS"
          :key="row.id"
          :row="row"
          :scale="NTS_CHART_SCALE"
          selectable
          purpose="pick"
          :selected-teeth="highlightedTeeth"
          :class="row.id === 'deciduousUpper' ? 'pt-3' : row.id === 'permanentLower' ? 'pt-3' : ''"
          @select="fdi => emit('toothSelect', fdi)"
        />

        <svg
          class="pointer-events-none absolute top-0 left-1/2 -translate-x-1/2"
          :viewBox="NTS_CHART_VIEWBOX"
          :width="NTS_CHART_WIDTH"
          :height="NTS_CHART_HEIGHT"
          :style="{ marginTop: '0' }"
          aria-hidden="true"
          focusable="false"
          data-testid="nts-plan-chart-overlay"
        >
          <!-- A bridge is a relationship between persisted tooth members;
               the line is deliberately neutral and has no NTS meaning. -->
          <template
            v-for="(bridge, index) in bridges"
            :key="index"
          >
            <line
              v-for="(placement, placementIndex) in bridge.slice(1)"
              :key="`${placement.fdi}-${placementIndex}`"
              :x1="bridge[placementIndex]?.center.x"
              :y1="bridge[placementIndex]?.center.y"
              :x2="placement.center.x"
              :y2="placement.center.y"
              stroke="var(--color-primary-500)"
              stroke-width="2"
              stroke-dasharray="3 2"
            />
          </template>

          <template
            v-for="(toothMarkers, fdi) in markersByTooth"
            :key="fdi"
          >
            <template v-if="toothPlacement(Number(fdi))">
              <rect
                :x="toothPlacement(Number(fdi))!.crown.x"
                :y="toothPlacement(Number(fdi))!.crown.y"
                :width="toothPlacement(Number(fdi))!.crown.width"
                :height="toothPlacement(Number(fdi))!.crown.height"
                rx="2"
                fill="none"
                :stroke="markerTone(toothMarkers[0]!)"
                stroke-width="1.5"
              />
              <circle
                v-for="(marker, markerIndex) in toothMarkers"
                :key="marker.itemId"
                :cx="toothPlacement(Number(fdi))!.annotation.x + toothPlacement(Number(fdi))!.annotation.width - 5 - markerIndex * 6"
                :cy="toothPlacement(Number(fdi))!.annotation.y + 6"
                r="2.5"
                :fill="markerTone(marker)"
              >
                <title>{{ markerTitle(marker) }}</title>
              </circle>
              <template
                v-for="marker in toothMarkers"
                :key="`${marker.itemId}-surfaces`"
              >
                <circle
                  v-for="surface in marker.surfaces"
                  :key="surface"
                  :cx="surfacePoint(marker, surface)?.x"
                  :cy="surfacePoint(marker, surface)?.y"
                  r="1.8"
                  :fill="markerTone(marker)"
                />
              </template>
            </template>
          </template>
        </svg>
      </div>
    </div>

    <p
      v-if="items.some(item => !item.treatment?.teeth?.length)"
      class="text-caption text-subtle"
    >
      Los tratamientos por arco, boca completa o sin una representación dental se mantienen en la lista del plan.
    </p>
  </section>
</template>
