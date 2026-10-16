<script setup lang="ts">
import type { TherapeuticLayer } from '../../../../odontogram/frontend/utils/therapeuticVisualization'

defineProps<{
  layers: TherapeuticLayer[]
  hasMarkers: boolean
  hasFallback: boolean
  hasGenericIcon: boolean
  hasSurfaces: boolean
  hasRoles: boolean
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
    v-if="hasMarkers || layers.length || hasBridge || hasGlobal || hasMultiple"
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
      v-if="hasMarkers"
      data-testid="nts-plan-legend-markers"
    >Contorno y punto: tratamiento del plan en la pieza</span>
    <span
      v-if="hasSurfaces"
      data-testid="nts-plan-legend-surfaces"
    >Punto pequeño: superficie tratada</span>
    <span
      v-if="hasFallback"
      data-testid="nts-plan-legend-fallback"
    >Solo contorno y punto: sin representación terapéutica guardada</span>
    <span
      v-if="hasGenericIcon"
      data-testid="nts-plan-legend-generic-icon"
    >Rombo discontinuo: icono sin símbolo definido</span>
    <span
      v-if="hasRoles"
      data-testid="nts-plan-legend-roles"
    >Cuadro lleno: pilar; cuadro vacío: póntico</span>
    <span
      v-if="hasBridge"
      data-testid="nts-plan-legend-bridge"
    >Línea discontinua: puente</span>
    <span
      v-if="hasMultiple"
      data-testid="nts-plan-legend-multiple"
    >Número en círculo: tratamientos vigentes en la pieza</span>
    <span v-if="hasPending">Azul o semitransparente: planificado</span>
    <span v-if="hasCompleted">Verde u opaco: realizado</span>
    <span v-if="hasGlobal">Tratamientos globales: franja inferior</span>
  </aside>
</template>
