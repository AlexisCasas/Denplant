<script setup lang="ts">
/**
 * ClinicalTab - Main clinical tab with five modes
 *
 * Modes (display order: Diagnóstico | Planes | Citas | Histórico | Evolución):
 * - diagnosis: Record current conditions
 * - plans: Create and manage treatment plans
 * - appointments: View and manage patient appointments
 * - history: View past odontogram states (read-only)
 * - evolution: The clinical-notes history. Rendered through the
 *   ``patient.clinical.evolution`` slot — this layer never imports the
 *   component that fills it.
 */

import type { ClinicalMode, TreatmentPlan } from '~~/app/types'
import { PERMISSIONS } from '~~/app/config/permissions'
import { clinicalModeFromQuery } from '~~/app/utils/clinicalModes'

const props = defineProps<{
  patientId: string
  readonly?: boolean
}>()

const emit = defineEmits<{
  'plan-view-change': [view: 'list' | 'detail']
}>()

const { can } = usePermissions()
const router = useRouter()
const route = useRoute()

// Evolución is the notes history; without read access the mode does not exist.
const canReadNotes = computed(() => can(PERMISSIONS.clinicalNotes.read))
const modeAccess = computed(() => ({ evolution: canReadNotes.value }))

const evolutionCtx = computed(() => ({
  patientId: props.patientId,
  readonly: props.readonly
}))

// ============================================================================
// State
// ============================================================================

// Current mode (default to diagnosis as the most common workflow)
const currentMode = ref<ClinicalMode>('diagnosis')

// Plan to open directly (when transitioning from diagnosis)
const targetPlanId = ref<string | null>(null)

// Create plan modal
const showPlanModal = ref(false)

// ============================================================================
// URL Sync
// ============================================================================

// Sync mode with URL query param
watch(currentMode, (mode) => {
  router.replace({
    query: {
      ...route.query,
      clinicalMode: mode,
      // Clear targetPlanId when switching modes
      planId: mode === 'plans' && targetPlanId.value ? targetPlanId.value : undefined
    }
  })
})

// Initialize from URL on mount
onMounted(() => {
  const queryMode = clinicalModeFromQuery(route.query.clinicalMode, modeAccess.value)
  if (queryMode) currentMode.value = queryMode

  // Check for planId in URL
  const planId = route.query.planId as string
  if (planId) {
    targetPlanId.value = planId
    currentMode.value = 'plans'
  }

  // Check for action=createPlan (from sidebar widget)
  if (route.query.action === 'createPlan' && can(PERMISSIONS.treatmentPlans.write)) {
    handleCreatePlan()
    router.replace({ query: { ...route.query, action: undefined } })
  }
})

// ============================================================================
// Mode Transitions
// ============================================================================

function handleCreatePlan() {
  showPlanModal.value = true
}

function handleContinuePlan(planId: string) {
  targetPlanId.value = planId
  currentMode.value = 'plans'
}

/**
 * "Añadir nota" from Diagnóstico: go to Evolución. With a tooth in hand the
 * deep link also asks for a diagnosis note bound to it (``newNote=diagnosis``,
 * ``tooth=<FDI>``); without one, nothing is invented. The navigation is awaited
 * before the mode changes so the mode watcher, which spreads the live query,
 * carries the parameters along instead of dropping them.
 */
async function handleAddNote(tooth: number | null) {
  if (!canReadNotes.value) return
  await router.replace({
    query: {
      ...route.query,
      clinicalMode: 'evolution',
      newNote: tooth === null ? undefined : 'diagnosis',
      tooth: tooth === null ? undefined : String(tooth),
      planId: undefined
    }
  })
  currentMode.value = 'evolution'
}

function handlePlanCreated(plan: TreatmentPlan) {
  showPlanModal.value = false
  targetPlanId.value = plan.id
  currentMode.value = 'plans'
}

function handlePlanActivated(_plan: TreatmentPlan) {
  // Could show a toast or notification
}

function handleBudgetGenerated(planId: string) {
  router.push(`/budgets/${planId}?from=patient&patientId=${props.patientId}`)
}

// Clear target plan and reset view when leaving plans mode
watch(currentMode, (newMode) => {
  if (newMode !== 'plans') {
    targetPlanId.value = null
    emit('plan-view-change', 'list') // Reset sidebar visibility
  }
})
</script>

<template>
  <div class="clinical-tab space-y-4">
    <!-- Mode Toggle -->
    <ClinicalModeToggle
      v-model="currentMode"
      :show-evolution="canReadNotes"
    />

    <!-- Mode Content -->
    <HistoryMode
      v-if="currentMode === 'history'"
      :patient-id="patientId"
    />

    <DiagnosisModeContainer
      v-else-if="currentMode === 'diagnosis'"
      :patient-id="patientId"
      :readonly="readonly"
      :can-add-note="canReadNotes"
      @create-plan="handleCreatePlan"
      @continue-plan="handleContinuePlan"
      @add-note="handleAddNote"
    />

    <PlansMode
      v-else-if="currentMode === 'plans'"
      :patient-id="patientId"
      :initial-plan-id="targetPlanId"
      :readonly="readonly"
      @plan-activated="handlePlanActivated"
      @budget-generated="handleBudgetGenerated"
      @view-change="emit('plan-view-change', $event)"
    />

    <AppointmentsMode
      v-else-if="currentMode === 'appointments'"
      :patient-id="patientId"
    />

    <ModuleSlot
      v-else-if="currentMode === 'evolution' && canReadNotes"
      name="patient.clinical.evolution"
      :ctx="evolutionCtx"
    />

    <!-- Create Plan Modal (shared across modes) -->
    <TreatmentPlanModal
      v-model="showPlanModal"
      :patient-id="patientId"
      @saved="handlePlanCreated"
    />
  </div>
</template>
