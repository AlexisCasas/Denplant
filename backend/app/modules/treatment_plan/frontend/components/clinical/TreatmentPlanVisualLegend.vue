<script setup lang="ts">
import type { TherapeuticLayer } from '../../../../odontogram/frontend/utils/therapeuticVisualization'

defineProps<{
  layers: TherapeuticLayer[]
  hasBridge: boolean
  hasGlobal: boolean
  hasMultiple: boolean
  hasCompleted: boolean
  hasPending: boolean
}>()

const labels: Record<TherapeuticLayer, string> = {
  occlusal_surface: 'Superficies tratadas',
  pulp_fill: 'Tratamiento pulpar',
  cenital_pattern: 'Cobertura de pieza',
  lateral_icon: 'Icono lateral'
}
</script>

<template>
  <aside
    v-if="layers.length || hasBridge || hasGlobal || hasMultiple"
    class="flex flex-wrap items-center gap-x-3 gap-y-1 text-caption text-subtle"
    aria-label="Leyenda del plan de tratamiento"
    data-testid="nts-plan-visual-legend"
  >
    <span
      v-for="layer in layers"
      :key="layer"
      data-testid="nts-plan-legend-layer"
    >{{ labels[layer] }}</span>
    <span
      v-if="hasBridge"
      data-testid="nts-plan-legend-bridge"
    >Línea discontinua: puente</span>
    <span
      v-if="hasMultiple"
      data-testid="nts-plan-legend-multiple"
    >+n: tratamientos vigentes</span>
    <span v-if="hasPending">Semitransparente: planificado</span>
    <span v-if="hasCompleted">Opaco: realizado</span>
    <span v-if="hasGlobal">Tratamientos globales: franja inferior</span>
  </aside>
</template>
