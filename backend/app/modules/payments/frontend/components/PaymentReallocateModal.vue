<script setup lang="ts">
/**
 * "Asignar a presupuesto" — reallocate a whole payment (typically an
 * anticipo left on account) to one of the patient's budgets via
 * `POST /payments/{id}/reallocate`. Billing mirrors the allocation onto
 * the budget's invoices transactionally (issue #178), so this is also
 * the "apply to invoice" action reception was missing.
 */
import type { AllocationTarget, PaymentRecord } from '~~/app/types'

const props = defineProps<{
  open: boolean
  paymentId: string
  patientId: string
  amount: number
}>()

const emit = defineEmits<{
  (e: 'update:open', value: boolean): void
  (e: 'reallocated', payment: PaymentRecord): void
}>()

const { t } = useI18n()
const { reallocate } = usePayments()
const { format: formatCurrency } = useCurrency()
const toast = useToast()

const target = ref('')
const budgetItemId = ref('')
const targetType = ref<AllocationTarget>('budget')
const isSubmitting = ref(false)
const errorMsg = ref<string | null>(null)

watch(() => props.open, (isOpen) => {
  if (isOpen) {
    target.value = ''
    budgetItemId.value = ''
    targetType.value = 'budget'
    errorMsg.value = null
  }
})

async function submit() {
  if (!target.value) return
  isSubmitting.value = true
  errorMsg.value = null
  try {
    const updated = await reallocate(props.paymentId, {
      allocations: [{ target_type: targetType.value, target_id: target.value, budget_item_id: targetType.value === 'budget_item' ? budgetItemId.value : undefined, amount: props.amount }]
    })
    if (updated) {
      toast.add({ title: t('payments.reallocate.success'), color: 'success' })
      emit('reallocated', updated)
      emit('update:open', false)
    } else {
      errorMsg.value = t('payments.reallocate.error')
    }
  } finally {
    isSubmitting.value = false
  }
}
</script>

<template>
  <UModal
    :open="open"
    :title="t('payments.reallocate.title')"
    @update:open="emit('update:open', $event)"
  >
    <template #body>
      <div class="space-y-4">
        <p class="text-sm text-muted">
          {{ t('payments.reallocate.hint', { amount: formatCurrency(amount) }) }}
        </p>
        <UFormField :label="t('payments.target.label')">
          <USelect v-model="targetType" :items="[{ label: 'Presupuesto completo', value: 'budget' }, { label: 'Tratamiento', value: 'budget_item' }]" class="mb-2" />
          <AllocationTargetSelect
            v-model="target"
            :patient-id="patientId"
            budgets-only
          />
          <BudgetItemTargetSelect v-if="targetType === 'budget_item'" v-model="budgetItemId" :budget-id="target" class="mt-2" />
        </UFormField>
        <p
          v-if="errorMsg"
          class="text-sm text-danger-accent"
        >
          {{ errorMsg }}
        </p>
      </div>
    </template>
    <template #footer>
      <div class="flex justify-end gap-2 w-full">
        <UButton
          variant="ghost"
          @click="emit('update:open', false)"
        >
          {{ t('payments.new.cancel') }}
        </UButton>
        <UButton
          :disabled="!target || (targetType === 'budget_item' && !budgetItemId) || isSubmitting"
          :loading="isSubmitting"
          @click="submit"
        >
          {{ t('payments.reallocate.submit') }}
        </UButton>
      </div>
    </template>
  </UModal>
</template>
