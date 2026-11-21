<script setup lang="ts">
import type { BudgetWizardStep } from '../../composables/useBudgetDraft'
import { PERMISSIONS } from '~~/app/config/permissions'
import { errorMessage } from '~~/app/utils/error'

const route = useRoute()
const router = useRouter()
const { t } = useI18n()
const toast = useToast()
const { can } = usePermissions()
const { createBudget } = useBudgets()

// Track if coming from patient page
const comesFromPatient = computed(() => route.query.from === 'patient' && route.query.patient_id)
const backLabel = computed(() => comesFromPatient.value ? t('actions.back') : t('budget.title'))

function goBack() {
  if (comesFromPatient.value) {
    router.push(`/patients/${route.query.patient_id}`)
  } else {
    router.push('/budgets')
  }
}

// Check permission
if (!can(PERMISSIONS.budget.write)) {
  router.push('/budgets')
}

// Wizard state lives here so going back and forth between steps never loses data.
const draft = useBudgetDraft()
provideBudgetDraft(draft)
const isCreating = ref(false)

function goToStep(step: BudgetWizardStep) {
  draft.step.value = step
  if (import.meta.client) window.scrollTo({ top: 0, behavior: 'smooth' })
}

async function handleCreate() {
  if (isCreating.value) return
  // Re-validate everything before the one and only creation call.
  const data = draft.buildPayload()
  if (!data) {
    goToStep(Object.keys(draft.dataErrors.value).length ? 1 : 2)
    return
  }

  isCreating.value = true
  try {
    const budget = await createBudget(data)

    toast.add({
      title: t('common.success'),
      description: t('budget.messages.created'),
      color: 'success'
    })

    // Navigate to the new budget (preserve patient context)
    const queryParams = comesFromPatient.value
      ? `?from=patient&patientId=${route.query.patient_id}`
      : ''
    router.push(`/budgets/${budget.id}${queryParams}`)
  } catch (e) {
    toast.add({
      title: t('common.error'),
      description: errorMessage(e, t('budget.errors.create')),
      color: 'error'
    })
  } finally {
    isCreating.value = false
  }
}
</script>

<template>
  <div class="max-w-6xl mx-auto space-y-6">
    <!-- Header -->
    <div class="flex items-center gap-4">
      <UButton
        variant="ghost"
        color="neutral"
        icon="i-lucide-arrow-left"
        @click="goBack"
      >
        {{ backLabel }}
      </UButton>
      <h1 class="text-display text-default">
        {{ t('budget.new') }}
      </h1>
    </div>

    <BudgetWizardStepper
      :step="draft.step.value"
      @goto="goToStep"
    />

    <BudgetWizardStepData
      v-if="draft.step.value === 1"
      @next="goToStep(2)"
      @cancel="goBack"
    />
    <template v-else-if="draft.step.value === 2">
      <BudgetWizardPatientBar />
      <BudgetWizardStepItems
        @back="goToStep(1)"
        @next="goToStep(3)"
        @cancel="goBack"
      />
    </template>
    <BudgetWizardStepReview
      v-else
      :creating="isCreating"
      @back="goToStep(2)"
      @create="handleCreate"
      @cancel="goBack"
    />
  </div>
</template>
