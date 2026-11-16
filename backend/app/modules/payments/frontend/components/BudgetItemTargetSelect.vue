<script setup lang="ts">
/** Select a concrete billable item after the caller selected its budget. */
import type { ApiResponse, BudgetDetail, BudgetItemPaymentSummary } from '~~/app/types'

const props = defineProps<{ budgetId: string, modelValue: string, disabled?: boolean }>()
const emit = defineEmits<{ (e: 'update:modelValue', value: string): void }>()
const api = useApi()
const { format: formatCurrency } = useCurrency()
const budget = ref<BudgetDetail | null>(null)
const summaries = ref<Record<string, BudgetItemPaymentSummary>>({})

async function load() {
  if (!props.budgetId) { budget.value = null; summaries.value = {}; return }
  try {
    const [detail, summary] = await Promise.all([
      api.get<ApiResponse<BudgetDetail>>(`/api/v1/budgets/${props.budgetId}`),
      api.get<ApiResponse<BudgetItemPaymentSummary[]>>(`/api/v1/payments/budgets/${props.budgetId}/item-summaries`)
    ])
    budget.value = detail.data
    summaries.value = Object.fromEntries(summary.data.map(row => [row.budget_item_id, row]))
  } catch { budget.value = null; summaries.value = {} }
}
watch(() => props.budgetId, load, { immediate: true })
const items = computed(() => (budget.value?.items || []).map(item => {
  const name = Object.values(item.catalog_item?.names || {})[0] || 'Tratamiento'
  const balance = summaries.value[item.id]?.balance ?? item.line_total
  return { label: `${name}${item.tooth_number ? ` ${item.tooth_number}` : ''} · ${formatCurrency(Number(balance))}`, value: item.id }
}))
</script>

<template>
  <USelect :model-value="modelValue" :items="items" :disabled="disabled || !budgetId" placeholder="Selecciona tratamiento" @update:model-value="emit('update:modelValue', $event as string)" />
</template>
