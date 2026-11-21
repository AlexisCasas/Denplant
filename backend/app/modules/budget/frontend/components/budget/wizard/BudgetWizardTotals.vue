<script setup lang="ts">
import { injectBudgetDraft } from '../../../composables/useBudgetDraft'

defineProps<{ editable?: boolean }>()
const emit = defineEmits<{ discount: [] }>()

const { t } = useI18n()
const { format } = useCurrency()
const draft = injectBudgetDraft()
const hasGlobalDiscount = computed(() => !!draft.globalDiscount.value)
</script>

<template>
  <dl class="space-y-2">
    <div class="flex items-baseline justify-between gap-4">
      <dt class="text-body text-muted">
        {{ t('budget.subtotal') }}
      </dt>
      <dd class="tnum text-default">
        {{ format(draft.totals.value.subtotal) }}
      </dd>
    </div>
    <div class="flex flex-wrap items-center justify-between gap-x-4 gap-y-1">
      <dt class="flex flex-wrap items-center gap-2 text-body text-muted">
        {{ t('budget.totalDiscount') }}
        <UButton
          v-if="editable"
          size="xs"
          variant="outline"
          color="neutral"
          icon="i-lucide-percent"
          @click="emit('discount')"
        >
          {{ hasGlobalDiscount ? t('budget.wizard.editDiscount') : t('budget.wizard.applyDiscount') }}
        </UButton>
      </dt>
      <dd class="tnum text-default">
        {{ draft.totals.value.discount > 0 ? '- ' : '' }}{{ format(draft.totals.value.discount) }}
      </dd>
    </div>
    <div
      v-if="draft.totals.value.tax > 0"
      class="flex items-baseline justify-between gap-4"
    >
      <dt class="text-body text-muted">
        {{ t('budget.totalTax') }}
      </dt>
      <dd class="tnum text-default">
        {{ format(draft.totals.value.tax) }}
      </dd>
    </div>
    <div class="flex items-baseline justify-between gap-4 rounded-lg bg-[color-mix(in_srgb,var(--color-primary-soft)_35%,transparent)] px-4 py-3">
      <dt class="text-h3 text-default font-semibold">
        {{ t('budget.wizard.totalBudget') }}
      </dt>
      <dd class="text-h1 tnum text-[var(--color-primary)] font-bold whitespace-nowrap">
        {{ format(draft.totals.value.total) }}
      </dd>
    </div>
  </dl>
</template>
