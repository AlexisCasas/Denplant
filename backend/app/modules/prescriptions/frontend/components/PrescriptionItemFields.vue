<script setup lang="ts">
/**
 * PrescriptionItemFields — one medication of the new-prescription form.
 *
 * A card, not a table row: one column on a phone, two from `sm` up. Every field
 * is free text and nothing is looked up, suggested or calculated. The limits
 * are the backend's (`utils/prescriptionForm.ts`); the card only shows them.
 *
 * It holds no state of its own. The form (`usePrescriptionDraft`) owns the
 * values and the errors; this card shows them and says what changed.
 */

import {
  FIELD_LIMITS,
  REQUIRED_FIELDS,
  type FieldError,
  type ItemDraft,
  type ItemField
} from '../utils/prescriptionForm'
import type { PrescriptionMedicationInput } from '../types/prescriptions'

const props = defineProps<{
  item: ItemDraft
  /** 1-based position, as the user counts them. */
  number: number
  errors?: Partial<Record<ItemField, FieldError>>
  canRemove: boolean
  disabled?: boolean
  favoriteId?: string | null
  favoriteBusy?: boolean
  favoriteError?: boolean
}>()

const emit = defineEmits<{
  update: [field: ItemField, value: string]
  remove: []
  toggleFavorite: [input: PrescriptionMedicationInput, favoriteId: string | null]
}>()

const { t } = useI18n()

interface FieldSpec {
  field: ItemField
  label: string
  /** Spans both columns from `sm` up. */
  wide?: boolean
  multiline?: boolean
}

// Order of the form: what it is, how it is presented, how it is taken.
const FIELDS: FieldSpec[] = [
  { field: 'active_ingredient', label: 'activeIngredient', wide: true },
  { field: 'commercial_name', label: 'commercialName' },
  { field: 'strength', label: 'strength' },
  { field: 'pharmaceutical_form', label: 'pharmaceuticalForm' },
  { field: 'presentation', label: 'presentation' },
  { field: 'dose', label: 'dose' },
  { field: 'route', label: 'route' },
  { field: 'frequency', label: 'frequency' },
  { field: 'duration', label: 'duration' },
  { field: 'total_quantity', label: 'totalQuantity' },
  { field: 'instructions', label: 'instructions', wide: true, multiline: true }
]

function isRequired(field: ItemField): boolean {
  return (REQUIRED_FIELDS as readonly string[]).includes(field)
}

function messageFor(field: ItemField): string | undefined {
  const error = props.errors?.[field]
  if (!error) return undefined
  return error === 'tooLong'
    ? t('prescriptions.create.validation.tooLong', { max: FIELD_LIMITS[field] })
    : t('prescriptions.create.validation.required')
}

function favoriteInput(): PrescriptionMedicationInput | null {
  const required = [
    props.item.active_ingredient, props.item.strength, props.item.pharmaceutical_form, props.item.route
  ]
  if (required.some(value => !value.trim())) return null
  return {
    active_ingredient: props.item.active_ingredient,
    commercial_name: props.item.commercial_name || undefined,
    strength: props.item.strength,
    pharmaceutical_form: props.item.pharmaceutical_form,
    presentation: props.item.presentation || undefined,
    default_route: props.item.route
  }
}

function toggleFavorite(): void {
  const input = favoriteInput()
  if (input) emit('toggleFavorite', input, props.favoriteId ?? null)
}
</script>

<template>
  <section
    class="rounded-token-md border border-default p-3 sm:p-4 space-y-3"
    :aria-labelledby="`rx-item-${item.key}-title`"
    :data-item-key="item.key"
    :data-testid="`prescription-item-${number}`"
  >
    <header class="flex items-center justify-between gap-2">
      <h4
        :id="`rx-item-${item.key}-title`"
        class="text-sm font-semibold text-default"
      >
        {{ t('prescriptions.create.medication', { n: number }) }}
      </h4>
      <div class="flex items-center gap-1">
        <UButton
          size="xs"
          color="neutral"
          variant="ghost"
          :icon="favoriteId ? 'i-lucide-star' : 'i-lucide-star-off'"
          :disabled="disabled || favoriteBusy || !favoriteInput()"
          :title="t(favoriteId ? 'prescriptions.create.favorites.remove' : 'prescriptions.create.favorites.save')"
          :data-testid="`prescription-item-${number}-favorite`"
          @click="toggleFavorite"
        />
        <UButton
          v-if="canRemove"
          size="xs"
          color="error"
          variant="ghost"
          icon="i-lucide-trash-2"
          :disabled="disabled"
          :aria-label="t('prescriptions.create.removeMedication', { n: number })"
          :data-testid="`prescription-item-${number}-remove`"
          @click="emit('remove')"
        />
      </div>
    </header>
    <p
      v-if="favoriteError"
      class="text-caption text-error"
    >
      {{ t('prescriptions.create.favorites.saveError') }}
    </p>

    <div class="grid grid-cols-1 gap-x-4 gap-y-3 sm:grid-cols-2">
      <div
        v-for="spec in FIELDS"
        :key="spec.field"
        :class="spec.wide ? 'sm:col-span-2' : ''"
        :data-testid="`prescription-item-${number}-${spec.field}`"
      >
        <UFormField
          :label="t(`prescriptions.create.fields.${spec.label}`)"
          :name="`items.${number}.${spec.field}`"
          :required="isRequired(spec.field)"
          :error="messageFor(spec.field)"
          :hint="spec.field === 'instructions'
            ? t('prescriptions.create.counter', { count: item.instructions.length, max: FIELD_LIMITS.instructions })
            : undefined"
          class="w-full"
        >
          <UTextarea
            v-if="spec.multiline"
            :model-value="item[spec.field]"
            :maxlength="FIELD_LIMITS[spec.field]"
            :rows="3"
            :disabled="disabled"
            class="w-full"
            @update:model-value="emit('update', spec.field, String($event ?? ''))"
          />
          <UInput
            v-else
            :model-value="item[spec.field]"
            :maxlength="FIELD_LIMITS[spec.field]"
            :required="isRequired(spec.field)"
            :disabled="disabled"
            autocomplete="off"
            class="w-full"
            @update:model-value="emit('update', spec.field, String($event ?? ''))"
          />
        </UFormField>
      </div>
    </div>
  </section>
</template>
