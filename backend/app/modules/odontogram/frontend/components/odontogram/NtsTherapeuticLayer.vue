<script setup lang="ts">
/** Therapeutic-only overlay for the Plan NTS canvas; never renders MINSA findings. */
import type { Surface } from '~~/app/types'
import { getLateralIcon } from './LateralViewIcons'
import { toothPlacement } from '../../utils/ntsChartGeometry'
import { therapeuticInstructions } from '../../utils/therapeuticVisualization'

const props = defineProps<{ fdi: number, snapshot: unknown, surfaces?: Surface[] | null, itemStatus: 'pending' | 'completed' | 'cancelled', treatmentStatus?: string, role?: 'pillar' | 'pontic' | null }>()
const placement = computed(() => toothPlacement(props.fdi))
const instructions = computed(() => props.itemStatus === 'cancelled' ? [] : therapeuticInstructions(props.snapshot))
const opacity = computed(() => props.itemStatus === 'completed' || props.treatmentStatus === 'performed' ? 1 : 0.58)
const id = computed(() => `therapy-pattern-${props.fdi}`)
function surfacePoint(surface: Surface) {
  const crown = placement.value?.crown
  if (!crown) return null
  const { x, y, width, height } = crown
  return {
    M: { x: x + width * 0.22, y: y + height * 0.5 },
    D: { x: x + width * 0.78, y: y + height * 0.5 },
    O: { x: x + width * 0.5, y: y + height * 0.5 },
    V: { x: x + width * 0.5, y: y + height * 0.22 },
    L: { x: x + width * 0.5, y: y + height * 0.78 }
  }[surface]
}
function pulpHeight(extent?: string) {
  if (extent === 'partial_1_2') return 0.5
  if (extent === 'partial_2_3') return 0.67
  return 1
}
function iconTransform(icon: ReturnType<typeof getLateralIcon>) {
  if (!icon || !placement.value) return ''
  const anchor = icon.anchorPosition === 'rootCenter'
    ? { x: placement.value.root.x + placement.value.root.width / 2, y: placement.value.root.y + placement.value.root.height / 2 }
    : placement.value.center
  return `translate(${anchor.x}, ${anchor.y}) scale(${Math.min(placement.value.crown.width, placement.value.crown.height) / 42})`
}
</script>

<template>
  <g
    v-if="placement && instructions.length"
    :opacity="opacity"
    :data-testid="`nts-therapy-${fdi}`"
  >
    <defs>
      <pattern
        :id="id"
        width="4"
        height="4"
        patternUnits="userSpaceOnUse"
      >
        <path
          d="M-1,1 l2,-2 M0,4 l4,-4 M3,5 l2,-2"
          stroke="currentColor"
          stroke-width="1"
        />
      </pattern>
    </defs>
    <template
      v-for="(rule, index) in instructions"
      :key="`${rule.layer}-${index}`"
    >
      <rect
        v-if="rule.layer === 'pulp_fill'"
        :x="placement.root.x + placement.root.width * 0.35"
        :y="placement.root.y + placement.root.height * (1 - pulpHeight(rule.extent))"
        :width="placement.root.width * 0.3"
        :height="placement.root.height * pulpHeight(rule.extent)"
        :fill="rule.color || 'currentColor'"
        data-testid="nts-therapy-pulp"
      />
      <template v-else-if="rule.layer === 'occlusal_surface'">
        <circle
          v-for="surface in (surfaces || [])"
          :key="surface"
          :cx="surfacePoint(surface)?.x"
          :cy="surfacePoint(surface)?.y"
          r="2.3"
          :fill="rule.color || 'currentColor'"
          data-testid="nts-therapy-surface"
        />
      </template>
      <rect
        v-else-if="rule.layer === 'cenital_pattern'"
        :x="placement.crown.x"
        :y="placement.crown.y"
        :width="placement.crown.width"
        :height="placement.crown.height"
        rx="2"
        :fill="`url(#${id})`"
        :stroke="rule.color || 'currentColor'"
        :style="{ color: rule.color || 'currentColor' }"
        data-testid="nts-therapy-pattern"
      />
      <path
        v-else-if="rule.layer === 'lateral_icon' && getLateralIcon(rule.icon || '')"
        :d="getLateralIcon(rule.icon || '')!.path"
        :transform="iconTransform(getLateralIcon(rule.icon || ''))"
        :stroke="rule.color || 'currentColor'"
        :fill="rule.color || 'none'"
        stroke-width="1.5"
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
        data-testid="nts-therapy-icon"
      />
    </template>
    <rect
      v-if="role"
      :x="placement.annotation.x + 2"
      :y="placement.annotation.y + 2"
      width="4"
      height="4"
      :fill="role === 'pillar' ? 'currentColor' : 'none'"
      stroke="currentColor"
      :data-role="role"
    />
  </g>
</template>
