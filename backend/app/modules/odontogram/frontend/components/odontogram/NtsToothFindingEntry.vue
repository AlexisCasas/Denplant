<script setup lang="ts">
/**
 * NtsToothFindingEntry — "record a finding on this tooth", step one.
 *
 * A small dialog that lets the clinician choose *which* finding after having
 * clicked a tooth. It is deliberately dumb: it receives the tooth and the
 * rules it may offer, and reports the choice. It makes no request, does not
 * know the record, validates nothing and writes nothing — the shell hands the
 * choice to the existing finding editor, which owns targets, attributes,
 * validation, the version lock and the save.
 *
 * Closed when `fdi` is null. Cancelling (button, Escape or the overlay) only
 * reports `cancel`; nothing has been selected or stored by then.
 */

import type { NtsRule } from '../../types/nts'
import NtsFindingPicker from './NtsFindingPicker.vue'

const props = defineProps<{
  /** The tooth that was clicked; null keeps the dialog closed. */
  fdi: number | null
  /** The rules the shell decided may be seeded from a tooth click. */
  rules: readonly NtsRule[]
}>()

const emit = defineEmits<{
  choose: [rule: NtsRule]
  cancel: []
}>()

const { t } = useI18n()

const open = computed(() => props.fdi !== null)
</script>

<template>
  <UModal
    :open="open"
    :title="t('odontogram.nts.entry.title', { fdi: fdi ?? '' })"
    :description="t('odontogram.nts.entry.hint')"
    data-testid="nts-tooth-entry"
    @update:open="$event || emit('cancel')"
  >
    <template #body>
      <NtsFindingPicker
        :rules="rules"
        :selected="null"
        @select="emit('choose', $event)"
      />
    </template>
    <template #footer>
      <div class="flex justify-end gap-2 w-full">
        <UButton
          color="neutral"
          variant="ghost"
          data-testid="nts-tooth-entry-cancel"
          @click="emit('cancel')"
        >
          {{ t('common.cancel') }}
        </UButton>
      </div>
    </template>
  </UModal>
</template>
