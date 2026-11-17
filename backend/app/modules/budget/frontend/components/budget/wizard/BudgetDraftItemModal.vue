<script setup lang="ts">
import type { ApiResponse, DiscountType, TreatmentCatalogItem } from '~~/app/types'
import { draftLine, type BudgetDraftItem } from '../../../composables/useBudgetDraft'

export interface BudgetDraftItemFields {
  catalog: TreatmentCatalogItem
  quantity: number
  tooth_number?: number
  surfaces: string[]
  discount_type?: DiscountType
  discount_value?: number
  notes: string
}

const props = defineProps<{
  open: boolean
  /** null = add a new treatment, otherwise edit this one */
  item: BudgetDraftItem | null
}>()
const emit = defineEmits<{
  'update:open': [value: boolean]
  'save': [fields: BudgetDraftItemFields]
}>()

const { t } = useI18n()
const api = useApi()
const { format } = useCurrency()
const { getItemName } = useCatalog()

const catalog = ref<TreatmentCatalogItem | null>(null)
const form = reactive({
  quantity: 1,
  tooth_number: undefined as number | undefined,
  surfaces: [] as string[],
  discount_type: '' as DiscountType | '',
  discount_value: undefined as number | undefined,
  notes: ''
})
const submitted = ref(false)
const toothSurfaces = ['M', 'O', 'D', 'V', 'L', 'P', 'I']

watch(() => props.open, (isOpen) => {
  if (!isOpen) return
  submitted.value = false
  const it = props.item
  catalog.value = it?.catalog ?? null
  form.quantity = it?.quantity ?? 1
  form.tooth_number = it?.tooth_number
  form.surfaces = [...(it?.surfaces ?? [])]
  form.discount_type = it?.discount_type ?? ''
  form.discount_value = it?.discount_value
  form.notes = it?.notes ?? ''
}, { immediate: true })

// The selector may hand back a "brief" (no VAT / category): reload the full item
// so the preview totals match what the backend will compute.
async function handleSelect(selected: TreatmentCatalogItem | null) {
  if (!selected) {
    catalog.value = null
    return
  }
  catalog.value = selected
  try {
    const res = await api.get<ApiResponse<TreatmentCatalogItem>>(`/api/v1/catalog/items/${selected.id}`)
    if (catalog.value?.id === selected.id) catalog.value = res.data
  } catch {
    // keep the brief; totals are only a preview
  }
}

function toggleSurface(s: string) {
  const i = form.surfaces.indexOf(s)
  if (i >= 0) form.surfaces.splice(i, 1)
  else form.surfaces.push(s)
}

const errors = computed(() => {
  const e: Record<string, string> = {}
  if (!catalog.value) e.catalog = t('budget.wizard.errors.treatment')
  if (!Number.isInteger(form.quantity) || form.quantity < 1) e.quantity = t('budget.wizard.errors.quantity')
  if (form.tooth_number !== undefined && form.tooth_number !== null
    && (form.tooth_number < 11 || form.tooth_number > 85)) e.tooth = t('budget.wizard.errors.tooth')
  if (form.discount_type) {
    const v = form.discount_value ?? 0
    if (v < 0 || (form.discount_type === 'percentage' && v > 100)) e.discount = t('budget.wizard.errors.discount')
  }
  return e
})

const preview = computed(() => {
  if (!catalog.value) return 0
  return draftLine({
    key: 'preview',
    catalog: catalog.value,
    quantity: Number(form.quantity) || 1,
    discount_type: form.discount_type || undefined,
    discount_value: form.discount_value,
    surfaces: [],
    notes: ''
  }).total
})

function save() {
  submitted.value = true
  if (Object.keys(errors.value).length > 0 || !catalog.value) return
  emit('save', {
    catalog: catalog.value,
    quantity: form.quantity,
    tooth_number: form.tooth_number || undefined,
    surfaces: form.tooth_number ? [...form.surfaces] : [],
    discount_type: form.discount_type || undefined,
    discount_value: form.discount_type ? form.discount_value : undefined,
    notes: form.notes
  })
  emit('update:open', false)
}
</script>

<template>
  <UModal
    :open="open"
    @update:open="emit('update:open', $event)"
  >
    <template #content>
      <UCard class="w-full max-w-lg">
        <template #header>
          <div class="flex items-center justify-between">
            <h2 class="text-h1 text-default">
              {{ item ? t('budget.items.edit') : t('budget.items.add') }}
            </h2>
            <UButton
              variant="ghost"
              color="neutral"
              icon="i-lucide-x"
              :aria-label="t('common.close')"
              @click="emit('update:open', false)"
            />
          </div>
        </template>

        <form
          class="space-y-4"
          novalidate
          @submit.prevent="save"
        >
          <UFormField
            :label="t('budget.items.treatment')"
            :error="submitted ? errors.catalog : undefined"
            required
          >
            <p
              v-if="item && catalog"
              class="text-default font-medium"
            >
              {{ getItemName(catalog) }}
            </p>
            <TreatmentVisualSelector
              v-else
              :model-value="catalog"
              :in-modal="true"
              @update:model-value="handleSelect"
            />
          </UFormField>

          <div class="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <UFormField
              :label="t('budget.items.quantity')"
              :error="submitted ? errors.quantity : undefined"
            >
              <UInput
                v-model.number="form.quantity"
                class="w-full"
                type="number"
                min="1"
                step="1"
              />
            </UFormField>
            <UFormField
              :label="t('budget.items.toothNumber')"
              :error="submitted ? errors.tooth : undefined"
            >
              <UInput
                v-model.number="form.tooth_number"
                class="w-full"
                type="number"
                min="11"
                max="85"
                :placeholder="t('budget.items.toothNumberPlaceholder')"
              />
            </UFormField>
          </div>

          <UFormField
            v-if="form.tooth_number"
            :label="t('budget.items.surfaces')"
          >
            <div class="flex flex-wrap gap-2">
              <UButton
                v-for="s in toothSurfaces"
                :key="s"
                size="sm"
                :variant="form.surfaces.includes(s) ? 'solid' : 'outline'"
                :color="form.surfaces.includes(s) ? 'primary' : 'neutral'"
                @click="toggleSurface(s)"
              >
                {{ s }}
              </UButton>
            </div>
          </UFormField>

          <div class="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <UFormField :label="t('budget.discountType')">
              <USelectMenu
                v-model="form.discount_type"
                class="w-full"
                :items="[
                  { label: '-', value: '' },
                  { label: t('budget.percentage'), value: 'percentage' },
                  { label: t('budget.absolute'), value: 'absolute' }
                ]"
                value-key="value"
              />
            </UFormField>
            <UFormField
              v-if="form.discount_type"
              :label="t('budget.discountValue')"
              :error="submitted ? errors.discount : undefined"
            >
              <UInput
                v-model.number="form.discount_value"
                class="w-full"
                type="number"
                step="0.01"
                min="0"
                :max="form.discount_type === 'percentage' ? 100 : undefined"
              />
            </UFormField>
          </div>

          <UFormField :label="t('budget.items.notes')">
            <UTextarea
              v-model="form.notes"
              class="w-full"
              :placeholder="t('budget.items.notesPlaceholder')"
              :rows="2"
            />
          </UFormField>

          <div
            v-if="catalog"
            class="flex justify-between items-center p-3 bg-surface-muted rounded-lg"
          >
            <span class="text-muted">{{ t('budget.items.lineTotal') }}</span>
            <span class="text-h1 tnum text-default">{{ format(preview) }}</span>
          </div>
        </form>

        <template #footer>
          <div class="flex justify-end gap-3">
            <UButton
              variant="outline"
              color="neutral"
              @click="emit('update:open', false)"
            >
              {{ t('common.cancel') }}
            </UButton>
            <UButton
              color="primary"
              :icon="item ? 'i-lucide-check' : 'i-lucide-plus'"
              @click="save"
            >
              {{ item ? t('common.save') : t('budget.items.add') }}
            </UButton>
          </div>
        </template>
      </UCard>
    </template>
  </UModal>
</template>
