<script setup lang="ts">
import { draftLine, type BudgetDraftItem } from '../../../composables/useBudgetDraft'

defineProps<{
  items: BudgetDraftItem[]
  editable?: boolean
}>()
const emit = defineEmits<{
  quantity: [key: string, quantity: number]
  edit: [item: BudgetDraftItem]
  remove: [key: string]
}>()

const { t } = useI18n()
const { format } = useCurrency()
const { getItemName } = useCatalog()
const { getCategoryName } = useTreatmentCatalogSearch()
</script>

<template>
  <div class="overflow-x-auto">
    <table class="w-full min-w-[34rem] text-body">
      <thead>
        <tr class="text-caption text-subtle text-left border-b border-default">
          <th class="py-2 pr-2 w-8">
            #
          </th>
          <th class="py-2 pr-2">
            {{ t('budget.items.treatment') }}
          </th>
          <th class="py-2 pr-2 text-center">
            {{ t('budget.wizard.tooth') }}
          </th>
          <th class="py-2 pr-2 text-center">
            {{ t('budget.items.quantity') }}
          </th>
          <th class="py-2 pr-2 text-right">
            {{ t('budget.wizard.unitPrice') }}
          </th>
          <th class="py-2 pr-2 text-right">
            {{ t('budget.wizard.lineSubtotal') }}
          </th>
          <th
            v-if="editable"
            class="py-2 text-right"
          >
            <span class="sr-only">{{ t('common.actions') }}</span>
          </th>
        </tr>
      </thead>
      <tbody>
        <tr
          v-for="(item, index) in items"
          :key="item.key"
          class="border-b border-default last:border-0"
        >
          <td class="py-3 pr-2 text-muted">
            {{ index + 1 }}
          </td>
          <td class="py-3 pr-2 min-w-0">
            <p class="font-medium text-default">
              {{ getItemName(item.catalog) }}
            </p>
            <p
              v-if="getCategoryName(item.catalog)"
              class="text-caption text-subtle"
            >
              {{ getCategoryName(item.catalog) }}
            </p>
            <p
              v-if="draftLine(item).discount > 0"
              class="text-caption text-success-accent"
            >
              − {{ format(draftLine(item).discount) }}
            </p>
          </td>
          <td class="py-3 pr-2 text-center">
            <UBadge
              v-if="item.tooth_number"
              color="neutral"
              variant="subtle"
            >
              {{ item.tooth_number }}
            </UBadge>
            <span
              v-else
              class="text-subtle"
            >—</span>
          </td>
          <td class="py-3 pr-2">
            <div
              v-if="editable"
              class="inline-flex items-center justify-center gap-1 w-full"
            >
              <UButton
                size="xs"
                variant="outline"
                color="neutral"
                icon="i-lucide-minus"
                :aria-label="t('budget.wizard.decrease')"
                :disabled="item.quantity <= 1"
                @click="emit('quantity', item.key, item.quantity - 1)"
              />
              <span class="w-8 text-center tnum">{{ item.quantity }}</span>
              <UButton
                size="xs"
                variant="outline"
                color="neutral"
                icon="i-lucide-plus"
                :aria-label="t('budget.wizard.increase')"
                @click="emit('quantity', item.key, item.quantity + 1)"
              />
            </div>
            <span
              v-else
              class="block text-center tnum"
            >{{ item.quantity }}</span>
          </td>
          <td class="py-3 pr-2 text-right tnum">
            {{ format(draftLine(item).unitPrice) }}
          </td>
          <td class="py-3 pr-2 text-right tnum font-semibold text-default">
            {{ format(draftLine(item).subtotal) }}
          </td>
          <td
            v-if="editable"
            class="py-3 text-right whitespace-nowrap"
          >
            <UButton
              size="xs"
              variant="soft"
              color="neutral"
              icon="i-lucide-pencil"
              :aria-label="t('budget.items.edit')"
              @click="emit('edit', item)"
            />
            <UButton
              size="xs"
              variant="soft"
              color="error"
              icon="i-lucide-trash-2"
              :aria-label="t('budget.items.remove')"
              @click="emit('remove', item.key)"
            />
          </td>
        </tr>
      </tbody>
    </table>
  </div>
</template>
