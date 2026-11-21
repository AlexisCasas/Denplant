<script setup lang="ts">
import type { DiscountType, TreatmentCatalogItem } from '~~/app/types'
import { injectBudgetDraft, type BudgetDraftItem } from '../../../composables/useBudgetDraft'
import type { BudgetDraftItemFields } from './BudgetDraftItemModal.vue'

const emit = defineEmits<{ back: [], next: [], cancel: [] }>()

const { t } = useI18n()
const draft = injectBudgetDraft()

const modalOpen = ref(false)
const editing = ref<BudgetDraftItem | null>(null)
const discountOpen = ref(false)
const discountForm = reactive<{ type: DiscountType, value: number | undefined }>({ type: 'percentage', value: undefined })

function quickAdd(catalog: TreatmentCatalogItem) {
  draft.addItem(catalog)
}

function openAdd() {
  editing.value = null
  modalOpen.value = true
}

function openEdit(item: BudgetDraftItem) {
  editing.value = item
  modalOpen.value = true
}

function save(fields: BudgetDraftItemFields) {
  if (editing.value) Object.assign(editing.value, fields)
  else draft.addItem(fields.catalog, fields)
}

function setQuantity(key: string, quantity: number) {
  const item = draft.items.value.find(i => i.key === key)
  if (item && quantity >= 1) item.quantity = quantity
}

function openDiscount() {
  discountForm.type = draft.globalDiscount.type ?? 'percentage'
  discountForm.value = draft.globalDiscount.value
  discountOpen.value = true
}

const discountError = computed(() => {
  const v = discountForm.value ?? 0
  if (v < 0 || (discountForm.type === 'percentage' && v > 100)) return t('budget.wizard.errors.discount')
  return undefined
})

function applyDiscount() {
  if (discountError.value) return
  if (discountForm.value) {
    draft.globalDiscount.type = discountForm.type
    draft.globalDiscount.value = discountForm.value
  } else {
    draft.globalDiscount.type = undefined
    draft.globalDiscount.value = undefined
  }
  discountOpen.value = false
}

const canContinue = computed(() => draft.itemsValid.value)
</script>

<template>
  <div class="space-y-6">
    <div class="grid grid-cols-1 lg:grid-cols-[22rem_1fr] gap-6 items-start">
      <BudgetCatalogPanel @add="quickAdd" />

      <div class="space-y-4 min-w-0">
        <UCard>
          <template #header>
            <div class="flex items-center justify-between gap-3">
              <div class="flex items-center gap-2">
                <UIcon
                  name="i-lucide-clipboard-list"
                  class="w-5 h-5 text-[var(--color-primary)]"
                />
                <h2 class="text-h2 text-default">
                  {{ t('budget.wizard.itemsTitle', { n: draft.items.value.length }) }}
                </h2>
              </div>
              <UButton
                variant="outline"
                color="primary"
                icon="i-lucide-plus"
                @click="openAdd"
              >
                {{ t('budget.wizard.addTreatment') }}
              </UButton>
            </div>
          </template>

          <BudgetDraftItemsTable
            v-if="draft.items.value.length"
            :items="draft.items.value"
            editable
            @quantity="setQuantity"
            @edit="openEdit"
            @remove="draft.removeItem"
          />
          <p
            v-else
            class="text-center text-subtle py-8"
          >
            {{ t('budget.items.empty') }}
          </p>

          <div class="mt-4 flex gap-2 rounded-lg bg-[color-mix(in_srgb,var(--color-primary-soft)_35%,transparent)] p-3 text-caption text-default">
            <UIcon
              name="i-lucide-info"
              class="w-4 h-4 shrink-0 mt-0.5 text-[var(--color-primary)]"
            />
            <span>{{ t('budget.wizard.itemsHint') }}</span>
          </div>
        </UCard>

        <UCard>
          <BudgetWizardTotals
            editable
            @discount="openDiscount"
          />
        </UCard>
      </div>
    </div>

    <div class="flex flex-wrap items-center justify-between gap-3 pt-4 border-t border-default">
      <UButton
        variant="outline"
        color="neutral"
        icon="i-lucide-arrow-left"
        @click="emit('back')"
      >
        {{ t('budget.wizard.backToData') }}
      </UButton>
      <div class="flex gap-3">
        <UButton
          variant="outline"
          color="neutral"
          @click="emit('cancel')"
        >
          {{ t('common.cancel') }}
        </UButton>
        <UButton
          color="primary"
          variant="solid"
          trailing-icon="i-lucide-arrow-right"
          :disabled="!canContinue"
          @click="emit('next')"
        >
          {{ t('budget.wizard.continueToReview') }}
        </UButton>
      </div>
    </div>

    <BudgetDraftItemModal
      v-model:open="modalOpen"
      :item="editing"
      @save="save"
    />

    <UModal v-model:open="discountOpen">
      <template #content>
        <UCard class="w-full max-w-sm">
          <template #header>
            <h2 class="text-h1 text-default">
              {{ t('budget.globalDiscount') }}
            </h2>
          </template>
          <form
            class="space-y-4"
            novalidate
            @submit.prevent="applyDiscount"
          >
            <UFormField :label="t('budget.discountType')">
              <USelectMenu
                v-model="discountForm.type"
                class="w-full"
                :items="[
                  { label: t('budget.percentage'), value: 'percentage' },
                  { label: t('budget.absolute'), value: 'absolute' }
                ]"
                value-key="value"
              />
            </UFormField>
            <UFormField
              :label="t('budget.discountValue')"
              :error="discountError"
            >
              <UInput
                v-model.number="discountForm.value"
                class="w-full"
                type="number"
                step="0.01"
                min="0"
                :max="discountForm.type === 'percentage' ? 100 : undefined"
              />
            </UFormField>
          </form>
          <template #footer>
            <div class="flex justify-end gap-3">
              <UButton
                variant="outline"
                color="neutral"
                @click="discountOpen = false"
              >
                {{ t('common.cancel') }}
              </UButton>
              <UButton
                color="primary"
                @click="applyDiscount"
              >
                {{ t('budget.wizard.applyDiscount') }}
              </UButton>
            </div>
          </template>
        </UCard>
      </template>
    </UModal>
  </div>
</template>
