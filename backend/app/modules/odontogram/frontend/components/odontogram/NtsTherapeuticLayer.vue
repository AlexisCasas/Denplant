<script setup lang="ts">
/** Therapeutic-only overlay for the Plan NTS canvas; never renders MINSA findings. */
import type { Surface } from '~~/app/types'
import { getLateralIcon } from './LateralViewIcons'
import { toothPlacement } from '../../utils/ntsChartGeometry'
import { therapeuticCrownCenter, therapeuticIconTransform, therapeuticPulpBox, therapeuticSurfacePath } from '../../utils/ntsTherapeuticGeometry'
import { renderableTherapeuticInstructions, resolveTherapeuticPattern, type TherapeuticLayer } from '../../utils/therapeuticVisualization'

const props = defineProps<{ fdi: number, snapshot: unknown, surfaces?: Surface[] | null, itemStatus: 'pending' | 'completed' | 'cancelled', treatmentStatus?: string, layer?: TherapeuticLayer }>()
const placement = computed(() => toothPlacement(props.fdi))
const instructions = computed(() => {
  if (props.itemStatus === 'cancelled' || props.treatmentStatus === 'cancelled') return []
  const all = renderableTherapeuticInstructions(props.snapshot, props.surfaces ?? [])
  return props.layer ? all.filter(instruction => instruction.layer === props.layer) : all
})
const opacity = computed(() => props.itemStatus === 'completed' || props.treatmentStatus === 'performed' ? 1 : 0.58)
const instanceId = useId()
const center = computed(() => therapeuticCrownCenter(props.fdi))
function patternId(index: number) {
  return `therapy-pattern-${instanceId}-${index}`
}
function patternPath(pattern: string) {
  if (pattern === 'horizontal_stripes') return 'M0,2 H4'
  if (pattern === 'vertical_stripes') return 'M2,0 V4'
  if (pattern === 'grid') return 'M0,2 H4 M2,0 V4'
  return 'M-1,1 l2,-2 M0,4 l4,-4 M3,5 l2,-2'
}
function patternFill(pattern: string, index: number) {
  if (pattern === 'outline') return 'none'
  return pattern === 'solid' ? undefined : `url(#${patternId(index)})`
}
function pulpFraction(extent?: string) {
  if (extent === 'partial_1_2') return 0.5
  if (extent === 'partial_2_3') return 0.67
  return 1
}
</script>

<template>
  <g
    v-if="placement && instructions.length"
    :opacity="opacity"
    :data-testid="`nts-therapy-${fdi}`"
  >
    <template
      v-for="(rule, index) in instructions"
      :key="`${rule.layer}-${index}`"
    >
      <rect
        v-if="rule.layer === 'pulp_fill' && therapeuticPulpBox(fdi, pulpFraction(rule.extent))"
        :x="therapeuticPulpBox(fdi, pulpFraction(rule.extent))!.x"
        :y="therapeuticPulpBox(fdi, pulpFraction(rule.extent))!.y"
        :width="therapeuticPulpBox(fdi, pulpFraction(rule.extent))!.width"
        :height="therapeuticPulpBox(fdi, pulpFraction(rule.extent))!.height"
        :fill="rule.color || 'currentColor'"
        data-testid="nts-therapy-pulp"
      />
      <template v-else-if="rule.layer === 'occlusal_surface'">
        <template
          v-for="surface in (surfaces || [])"
          :key="surface"
        >
          <path
            v-if="therapeuticSurfacePath(fdi, surface)"
            :d="therapeuticSurfacePath(fdi, surface)!"
            :fill="rule.kind === 'outline' ? 'none' : rule.color || 'currentColor'"
            :fill-opacity="rule.kind === 'outline' ? undefined : 0.8"
            :stroke="rule.color || 'currentColor'"
            stroke-width="0.8"
            :data-surface="surface"
            data-testid="nts-therapy-surface"
          />
        </template>
      </template>
      <template v-else-if="rule.layer === 'cenital_pattern'">
        <defs v-if="['diagonal_stripes', 'horizontal_stripes', 'vertical_stripes', 'grid', 'dots'].includes(resolveTherapeuticPattern(rule.pattern))">
          <pattern
            :id="patternId(index)"
            width="4"
            height="4"
            patternUnits="userSpaceOnUse"
          >
            <circle
              v-if="resolveTherapeuticPattern(rule.pattern) === 'dots'"
              cx="2"
              cy="2"
              r="0.8"
              :fill="rule.color || 'currentColor'"
            />
            <path
              v-else
              :d="patternPath(resolveTherapeuticPattern(rule.pattern))"
              :stroke="rule.color || 'currentColor'"
              stroke-width="1"
            />
          </pattern>
        </defs>
        <rect
          :x="placement.crown.x"
          :y="placement.crown.y"
          :width="placement.crown.width"
          :height="placement.crown.height"
          rx="2"
          :fill="patternFill(resolveTherapeuticPattern(rule.pattern), index) ?? (rule.color || 'currentColor')"
          :fill-opacity="resolveTherapeuticPattern(rule.pattern) === 'solid' ? 0.6 : undefined"
          :stroke="rule.color || 'currentColor'"
          :data-pattern="resolveTherapeuticPattern(rule.pattern)"
          data-testid="nts-therapy-pattern"
        />
      </template>
      <path
        v-else-if="rule.layer === 'lateral_icon' && getLateralIcon(rule.icon || '')"
        :d="getLateralIcon(rule.icon || '')!.path"
        :transform="therapeuticIconTransform(fdi, getLateralIcon(rule.icon || ''))"
        :stroke="rule.color || 'currentColor'"
        :fill="rule.color || 'currentColor'"
        :fill-opacity="getLateralIcon(rule.icon || '')!.fillOpacity ?? 0"
        :stroke-width="getLateralIcon(rule.icon || '')!.strokeWidth ?? 1.5"
        :data-icon="rule.icon"
        data-testid="nts-therapy-icon"
      />
      <rect
        v-else-if="rule.layer === 'lateral_icon' && rule.icon === 'implant'"
        :x="placement.root.x + placement.root.width * 0.38"
        :y="placement.root.y"
        :width="placement.root.width * 0.24"
        :height="placement.root.height"
        rx="1"
        :fill="rule.color || 'currentColor'"
        fill-opacity="0.3"
        :stroke="rule.color || 'currentColor'"
        data-icon="implant"
        data-testid="nts-therapy-icon"
      />
      <path
        v-else-if="rule.layer === 'lateral_icon' && center"
        :d="`M${center.x},${center.y - 4} L${center.x + 4},${center.y} L${center.x},${center.y + 4} L${center.x - 4},${center.y} Z`"
        fill="none"
        :stroke="rule.color || 'currentColor'"
        stroke-width="1.2"
        stroke-dasharray="2 1.5"
        :data-icon="rule.icon || 'unknown'"
        data-testid="nts-therapy-generic-icon"
      />
    </template>
  </g>
</template>
