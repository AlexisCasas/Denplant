<script setup lang="ts">
/**
 * NtsFindingEditor — the panel that coordinates picking, attributes and
 * targets, and hands the result to the composable that saves it.
 *
 * It owns no clinical knowledge and no HTTP. The rule comes from the catalog,
 * the controls from the rule's metadata, the target requirements from its
 * scope, and every mutation from `useNtsFindingEditor`.
 */

import type { NtsFinding, NtsRule } from '../../types/nts'
import type { NtsArchCode, NtsSelectionProblem, NtsTargetSelection } from '../../utils/ntsFindingModel'
import type { NtsPickMode } from '../../composables/useNtsFindingEditor'
import type { NtsRuleAttribute, NtsSpecificationRequirement } from '../../types/nts'
import NtsFindingPicker from './NtsFindingPicker.vue'
import NtsAttributeEditor from './NtsAttributeEditor.vue'
import NtsTargetEditor from './NtsTargetEditor.vue'

const props = defineProps<{
  rules: readonly NtsRule[]
  rule: NtsRule | null
  isCreating: boolean
  attributes: Record<string, unknown>
  selection: NtsTargetSelection
  pickMode: NtsPickMode
  problems: NtsSelectionProblem[]
  missingAttributes: NtsRuleAttribute[]
  specificationRequirements: NtsSpecificationRequirement[]
  canSave: boolean
  isSaving: boolean
  clinicalErrors: string[]
  /** The finding being edited, absent while creating a new one. */
  original?: NtsFinding | null
}>()

const emit = defineEmits<{
  selectRule: [rule: NtsRule]
  'update:attributes': [value: Record<string, unknown>]
  pickMode: [mode: NtsPickMode]
  toggleArch: [arch: NtsArchCode]
  setRole: [tooth: number, role: string | null]
  save: []
  cancel: []
}>()

const { t } = useI18n()

/**
 * Requirements the norm actually blocks finalizing on, versus the ones
 * DentalPin merely surfaces. NTS-03.1 drew this line and it must not blur:
 * `required = false` means no normative evidence for an automatic block.
 */
const blocking = computed(() => props.specificationRequirements.filter(r => r.required))
const advisory = computed(() => props.specificationRequirements.filter(r => !r.required))
</script>

<template>
  <UCard data-testid="nts-finding-editor">
    <template #header>
      <div class="flex items-center justify-between gap-3">
        <span class="font-medium">
          {{ isCreating
            ? t('odontogram.nts.editor.newFinding')
            : t('odontogram.nts.editor.editFinding') }}
        </span>
        <UButton
          size="xs"
          color="neutral"
          variant="ghost"
          data-testid="nts-editor-cancel"
          @click="emit('cancel')"
        >
          {{ t('common.cancel') }}
        </UButton>
      </div>
    </template>

    <div class="space-y-4">
      <!-- The rule is fixed once a finding exists: a finding never changes
           which rule it cites, so editing shows it rather than offering the
           picker again. -->
      <NtsFindingPicker
        v-if="isCreating"
        :rules="rules"
        :selected="rule"
        @select="emit('selectRule', $event)"
      />
      <div
        v-else-if="rule"
        class="flex items-baseline justify-between gap-3"
        data-testid="nts-editor-rule"
      >
        <span class="font-medium text-sm">{{ rule.official_name }}</span>
        <span class="text-caption text-subtle tabular-nums">{{ rule.rule_id }}</span>
      </div>

      <!-- The catalog no longer serves this rule. Nothing is guessed. -->
      <UAlert
        v-else
        color="warning"
        variant="subtle"
        icon="i-lucide-triangle-alert"
        :title="t('odontogram.nts.editor.unknownRule')"
        data-testid="nts-editor-unknown-rule"
      />

      <template v-if="rule">
        <NtsTargetEditor
          :rule="rule"
          :selection="selection"
          :pick-mode="pickMode"
          :problems="problems"
          @pick-mode="emit('pickMode', $event)"
          @toggle-arch="emit('toggleArch', $event)"
          @set-role="(tooth, role) => emit('setRole', tooth, role)"
        />

        <NtsAttributeEditor
          :rule="rule"
          :model-value="attributes"
          :missing="missingAttributes"
          @update:model-value="emit('update:attributes', $event)"
        />

        <!-- Especificaciones are a separate clinical record with their own
             editor; 05C only says one will be needed, and never pretends the
             requirement is satisfied. -->
        <UAlert
          v-if="blocking.length > 0"
          color="warning"
          variant="subtle"
          icon="i-lucide-file-pen-line"
          :title="t('odontogram.nts.editor.specificationRequired')"
          :description="blocking.map(r => r.label).join(' · ')"
          data-testid="nts-specification-required"
        />
        <UAlert
          v-if="advisory.length > 0"
          color="neutral"
          variant="subtle"
          icon="i-lucide-info"
          :title="t('odontogram.nts.editor.specificationAdvisory')"
          :description="advisory.map(r => r.label).join(' · ')"
          data-testid="nts-specification-advisory"
        />
      </template>

      <!-- Every problem the server reported, never just the first. -->
      <UAlert
        v-if="clinicalErrors.length > 0"
        color="error"
        variant="subtle"
        icon="i-lucide-octagon-alert"
        :title="t('odontogram.nts.error.clinicalTitle')"
        data-testid="nts-editor-clinical-errors"
      >
        <template #description>
          <ul class="list-disc ps-4 space-y-1">
            <li
              v-for="message in clinicalErrors"
              :key="message"
            >
              {{ message }}
            </li>
          </ul>
        </template>
      </UAlert>
    </div>

    <template #footer>
      <div class="flex justify-end gap-2">
        <UButton
          color="neutral"
          variant="ghost"
          @click="emit('cancel')"
        >
          {{ t('common.cancel') }}
        </UButton>
        <UButton
          :disabled="!canSave"
          :loading="isSaving"
          data-testid="nts-editor-save"
          @click="emit('save')"
        >
          {{ isCreating
            ? t('odontogram.nts.editor.addFinding')
            : t('odontogram.nts.editor.saveFinding') }}
        </UButton>
      </div>
    </template>
  </UCard>
</template>
