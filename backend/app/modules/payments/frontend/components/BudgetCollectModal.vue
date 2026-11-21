<script setup lang="ts">
/**
 * Budget-specific collect modal — thin wrapper around the shared
 * ``CollectAmountModal`` that handles the payments orchestrator call
 * + on-account excess narration. Optimised for receptionists.
 */

import type { BudgetItem, BudgetItemPaymentSummary, PaymentMethod, PaymentRecord, PaymentAllocationCreate } from '~~/app/types'

const props = withDefaults(defineProps<{
  open: boolean
  budgetId: string
  patientId: string
  budgetNumber?: string
  patientName?: string
  pendingAmount: number
  budgetItems?: BudgetItem[]
}>(), {
  budgetNumber: undefined,
  patientName: undefined
})

const emit = defineEmits<{
  (e: 'update:open', value: boolean): void
  (e: 'created', payment: PaymentRecord): void
}>()

const { t } = useI18n()
const { create } = usePayments()
const { format: formatCurrency } = useCurrency()
const toast = useToast()
const api = useApi()

const isSubmitting = ref(false)
const errorMsg = ref<string | null>(null)
const selectedItemId = ref<string>('')
const itemSummaries = ref<Record<string, BudgetItemPaymentSummary>>({})
const splitMode = ref(false)
const splitAmounts = ref<Record<string, number>>({})

async function loadItemSummaries() {
  if (!props.budgetItems?.length) return
  try {
    const response = await api.get<{ data: BudgetItemPaymentSummary[] }>(
      `/api/v1/payments/budgets/${props.budgetId}/item-summaries`
    )
    itemSummaries.value = Object.fromEntries(response.data.map(row => [row.budget_item_id, row]))
  } catch {
    itemSummaries.value = {}
  }
}

watch(() => props.open, open => {
  if (open) {
    selectedItemId.value = ''
    splitMode.value = false
    splitAmounts.value = {}
    loadItemSummaries()
  }
})

const selectedItem = computed(() => props.budgetItems?.find(item => item.id === selectedItemId.value))
const selectedItemBalance = computed(() => Number(itemSummaries.value[selectedItemId.value]?.balance ?? selectedItem.value?.line_total ?? 0))
function itemLabel(item: BudgetItem) {
  const name = Object.values(item.catalog_item?.names || {})[0] || 'Tratamiento'
  return `${name}${item.tooth_number ? ` ${item.tooth_number}` : ''}`
}

const title = computed(() =>
  t('payments.budgetCollect.title') + (props.budgetNumber ? ` · ${props.budgetNumber}` : '')
)

function fmt(value: number | string) {
  return formatCurrency(Number(value || 0))
}

function buildAllocations(amount: number): PaymentAllocationCreate[] {
  if (splitMode.value) {
    const itemAllocations = (props.budgetItems || [])
      .map(item => ({ item, amount: Number(splitAmounts.value[item.id] || 0) }))
      .filter(row => row.amount > 0)
      .map(row => ({
        target_type: 'budget_item' as const,
        target_id: props.budgetId,
        budget_item_id: row.item.id,
        amount: row.amount
      }))
    const allocated = itemAllocations.reduce((sum, allocation) => sum + allocation.amount, 0)
    return [
      ...itemAllocations,
      ...(amount > allocated ? [{ target_type: 'on_account' as const, amount: amount - allocated }] : [])
    ]
  }
  if (selectedItem.value) {
    const toItem = Math.min(amount, selectedItemBalance.value)
    const toOnAccount = Math.max(0, amount - toItem)
    return [
      ...(toItem > 0 ? [{ target_type: 'budget_item' as const, target_id: props.budgetId, budget_item_id: selectedItem.value.id, amount: toItem }] : []),
      ...(toOnAccount > 0 ? [{ target_type: 'on_account' as const, amount: toOnAccount }] : [])
    ]
  }
  const pending = Math.max(0, Number(props.pendingAmount || 0))
  const toBudget = Math.min(amount, pending)
  const toOnAccount = Math.max(0, amount - pending)
  const allocs: PaymentAllocationCreate[] = []
  if (toBudget > 0) {
    allocs.push({ target_type: 'budget', target_id: props.budgetId, amount: toBudget })
  }
  if (toOnAccount > 0) {
    allocs.push({ target_type: 'on_account', amount: toOnAccount })
  }
  return allocs
}

async function handleSubmit(payload: {
  amount: number
  method: PaymentMethod
  payment_date: string
  reference?: string
  notes?: string
}) {
  errorMsg.value = null
  if (splitMode.value) {
    const allocated = Object.values(splitAmounts.value).reduce((sum, value) => sum + Number(value || 0), 0)
    if (allocated <= 0 || allocated > payload.amount) {
      errorMsg.value = 'La distribución debe ser mayor que cero y no superar el monto recibido.'
      return
    }
    for (const item of props.budgetItems || []) {
      if (Number(splitAmounts.value[item.id] || 0) > Number(itemSummaries.value[item.id]?.balance ?? item.line_total)) {
        errorMsg.value = `El importe de ${itemLabel(item)} supera su saldo pendiente.`
        return
      }
    }
  }
  isSubmitting.value = true
  try {
    const created = await create({
      patient_id: props.patientId,
      amount: payload.amount,
      method: payload.method,
      payment_date: payload.payment_date,
      reference: payload.reference,
      notes: payload.notes,
      allocations: buildAllocations(payload.amount)
    })
    if (created) {
      toast.add({
        title: t('payments.budgetCollect.success'),
        description: fmt(payload.amount),
        color: 'success'
      })
      emit('created', created)
      emit('update:open', false)
    } else {
      errorMsg.value = t('payments.budgetCollect.errorGeneric')
    }
  } catch (e) {
    errorMsg.value = (e as Error)?.message || t('payments.budgetCollect.errorGeneric')
  } finally {
    isSubmitting.value = false
  }
}
</script>

<template>
  <CollectAmountModal
    :open="open"
    :title="title"
    :subtitle="patientName"
    :pending-amount="pendingAmount"
    :submitting="isSubmitting"
    :error="errorMsg"
    :submit-label="t('payments.budgetCollect.submit')"
    @update:open="emit('update:open', $event)"
    @submit="handleSubmit"
  >
    <template #before-form="{ amount }">
      <section v-if="budgetItems?.length" class="space-y-2">
        <div class="flex items-center justify-between">
          <label class="text-sm font-medium text-default">Aplicar a tratamiento</label>
          <UButton size="xs" variant="ghost" @click="splitMode = !splitMode">
            {{ splitMode ? 'Pago a un tratamiento' : 'Distribuir entre varios' }}
          </UButton>
        </div>
        <UFormField v-if="!splitMode">
          <USelect
            v-model="selectedItemId"
            :items="[
              { label: 'Presupuesto general', value: '' },
              ...budgetItems.map(item => ({
                label: `${itemLabel(item)} · Pendiente ${fmt(itemSummaries[item.id]?.balance ?? item.line_total)}`,
                value: item.id
              }))
            ]"
          />
        </UFormField>
        <div v-else class="space-y-2 rounded-md border border-default p-3">
          <div v-for="item in budgetItems" :key="item.id" class="grid grid-cols-[1fr_7rem] items-center gap-2">
            <div class="min-w-0 text-sm">
              <div class="truncate font-medium">{{ itemLabel(item) }}</div>
              <div class="text-xs text-muted">Saldo: {{ fmt(itemSummaries[item.id]?.balance ?? item.line_total) }}</div>
            </div>
            <UInput v-model.number="splitAmounts[item.id]" type="number" min="0" step="0.01" />
          </div>
          <p class="text-xs text-muted">
            Aplicado: {{ fmt(Object.values(splitAmounts).reduce((sum, value) => sum + Number(value || 0), 0)) }}
            · Saldo a favor: {{ fmt(Math.max(0, amount - Object.values(splitAmounts).reduce((sum, value) => sum + Number(value || 0), 0))) }}
          </p>
        </div>
      </section>
    </template>
    <template #narration="{ amount, pending }">
      <section
        v-if="amount > 0"
        class="rounded-md border-l-4 px-3 py-2 text-sm"
        :class="amount > pending
          ? 'border-amber-400 bg-amber-50 text-amber-900 dark:bg-amber-950 dark:text-amber-100'
          : amount === pending && pending > 0
            ? 'border-green-500 bg-green-50 text-green-900 dark:bg-green-950 dark:text-green-100'
            : 'border-info-accent bg-info-50 text-info-900 dark:bg-info-950 dark:text-info-100'"
      >
        <p v-if="pending === 0">
          {{ t('payments.budgetCollect.noteBudgetSettled') }}
          <strong>{{ fmt(amount) }}</strong>
          {{ t('payments.budgetCollect.noteToOnAccount') }}
        </p>
        <p v-else-if="amount > pending">
          <strong>{{ fmt(pending) }}</strong>
          {{ t('payments.budgetCollect.noteToBudget') }}
          <strong>{{ fmt(amount - pending) }}</strong>
          {{ t('payments.budgetCollect.noteExcessToOnAccount') }}
        </p>
        <p v-else-if="amount === pending">
          {{ t('payments.budgetCollect.noteFullySettled') }}
        </p>
        <p v-else>
          <strong>{{ fmt(amount) }}</strong>
          {{ t('payments.budgetCollect.noteAppliedToBudget') }}
          {{ t('payments.budgetCollect.notePendingAfter') }}
          <strong>{{ fmt(pending - amount) }}</strong>.
        </p>
      </section>
    </template>
  </CollectAmountModal>
</template>
