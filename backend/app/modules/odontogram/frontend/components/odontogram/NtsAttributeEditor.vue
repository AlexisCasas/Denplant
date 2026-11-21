<script setup lang="ts">
/**
 * NtsAttributeEditor — controls generated from a rule's attribute metadata.
 *
 * The catalog says a rule has an attribute named `caries_type` of kind `enum`
 * with four codes; this component turns that into a select. It knows nothing
 * about caries, crowns or orthodontics, and adding a 39th rule to the norm
 * would need no change here.
 *
 * `fixed` attributes are not shown: they are a constant the rule carries (its
 * sigla), already filled in, and asking the clinician to confirm a value that
 * has exactly one option is noise.
 */

import type { NtsRule, NtsRuleAttribute } from '../../types/nts'
import { editableAttributes } from '../../utils/ntsFindingModel'

const props = defineProps<{
  rule: NtsRule
  modelValue: Record<string, unknown>
  /** Attributes the catalog marks required and the clinician has not filled. */
  missing: NtsRuleAttribute[]
}>()

const emit = defineEmits<{ 'update:modelValue': [value: Record<string, unknown>] }>()

const { t } = useI18n()

const fields = computed(() => editableAttributes(props.rule))
const missingNames = computed(() => new Set(props.missing.map(a => a.name)))

function update(name: string, value: unknown): void {
  emit('update:modelValue', { ...props.modelValue, [name]: value })
}

function options(attribute: NtsRuleAttribute) {
  return attribute.values.map(value => ({ label: value.name, value: value.code }))
}

/** `enum_multi` stores a list of codes; a missing value is an empty list. */
function multiValue(name: string): string[] {
  const raw = props.modelValue[name]
  return Array.isArray(raw) ? (raw as string[]) : []
}

/**
 * An integer input reports an empty field differently depending on the
 * control, so it is normalised in one place: anything not a finite number
 * clears the value rather than storing NaN.
 */
function updateNumber(name: string, raw: unknown): void {
  const value = Number(raw)
  update(name, raw === '' || raw === null || raw === undefined || Number.isNaN(value) ? null : value)
}

function toggleMulti(name: string, code: string): void {
  const current = multiValue(name)
  update(name, current.includes(code) ? current.filter(c => c !== code) : [...current, code])
}

/**
 * An attribute the catalog flagged for clinical review is shown as-is with a
 * note. NTS-03.1's distinction matters: "we have no normative evidence" is
 * not the same as "the norm made this optional".
 */
function needsReview(attribute: NtsRuleAttribute): boolean {
  return attribute.status === 'needs_clinical_review'
}
</script>

<template>
  <div
    v-if="fields.length > 0"
    class="space-y-3"
    data-testid="nts-attribute-editor"
  >
    <div
      v-for="attribute in fields"
      :key="attribute.name"
      :data-attribute="attribute.name"
      :data-attribute-kind="attribute.kind"
    >
      <UFormField
        :label="attribute.name"
        :required="attribute.required"
        :error="missingNames.has(attribute.name) ? t('odontogram.nts.editor.attributeRequired') : undefined"
      >
        <!-- One value from a closed list. -->
        <USelectMenu
          v-if="attribute.kind === 'enum'"
          :model-value="(modelValue[attribute.name] as string) ?? undefined"
          :items="options(attribute)"
          value-key="value"
          class="w-full"
          :data-testid="`nts-attribute-${attribute.name}`"
          @update:model-value="update(attribute.name, $event)"
        />

        <!-- Zero or more values: surfaces are the norm's own M/D/O/V/L. -->
        <div
          v-else-if="attribute.kind === 'enum_multi'"
          class="flex flex-wrap gap-2"
          :data-testid="`nts-attribute-${attribute.name}`"
        >
          <UButton
            v-for="value in attribute.values"
            :key="value.code"
            size="xs"
            :color="multiValue(attribute.name).includes(value.code) ? 'primary' : 'neutral'"
            :variant="multiValue(attribute.name).includes(value.code) ? 'solid' : 'outline'"
            :aria-pressed="multiValue(attribute.name).includes(value.code)"
            :data-testid="`nts-attribute-${attribute.name}-${value.code}`"
            @click="toggleMulti(attribute.name, value.code)"
          >
            {{ value.name }}
          </UButton>
        </div>

        <UInput
          v-else-if="attribute.kind === 'integer'"
          type="number"
          :model-value="(modelValue[attribute.name] as number) ?? undefined"
          class="w-full"
          :data-testid="`nts-attribute-${attribute.name}`"
          @update:model-value="updateNumber(attribute.name, $event)"
        />

        <UInput
          v-else
          :model-value="(modelValue[attribute.name] as string) ?? ''"
          class="w-full"
          :data-testid="`nts-attribute-${attribute.name}`"
          @update:model-value="update(attribute.name, $event)"
        />
      </UFormField>

      <p
        v-if="needsReview(attribute)"
        class="text-caption text-subtle mt-1"
      >
        {{ t('odontogram.nts.editor.needsClinicalReview') }}
      </p>
    </div>
  </div>
</template>
