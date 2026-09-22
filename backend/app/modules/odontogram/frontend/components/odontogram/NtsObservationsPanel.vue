<script setup lang="ts">
/**
 * NtsObservationsPanel — the annex's *Observaciones* block (NTS §5.15).
 *
 * The norm sends here "los hallazgos clínicos que **no se encuentren
 * contemplados en la nomenclatura** del registro". That is the opposite of
 * *Especificaciones*, which holds vocabulary that exists and had no room:
 * this holds what the 38 rules cannot express at all. One free-text block on
 * the record — never a structured finding, and never a treatment or a plan.
 *
 * Local buffer, explicit save. There is no autosave: a clinical record that
 * writes itself as someone types would record half-formed sentences as
 * observations.
 */

const props = defineProps<{
  /** As persisted. `null` and `''` are different: one is unset, one is empty. */
  observations: string | null
  /** Identity of the record in view, so a buffer cannot cross records. */
  recordId: string | null
  editable: boolean
  /** True while any record-text write is in flight, refetch included. */
  saving: boolean
}>()

const emit = defineEmits<{
  save: [text: string | null]
  /**
   * Whether there is text here the server has not been told about.
   *
   * Reported outward so the shell can refuse to navigate away from it: the
   * buffer resets on a change of record, and losing a clinician's half-written
   * observation to a stray click is not an acceptable way to change screens.
   */
  'update:dirty': [dirty: boolean]
}>()

const { t } = useI18n()

const persisted = computed(() => props.observations ?? '')
const buffer = ref(persisted.value)

/**
 * Reset on a change of *record*, never on a change of its content.
 *
 * The distinction is what makes a conflict survivable: when another session
 * moves the record on, the refetch replaces `observations` while the
 * clinician still has unsaved text, and throwing that text away would be the
 * worst possible response to a conflict. A different record id, on the other
 * hand, is a different document and must not inherit anything.
 */
watch(
  () => props.recordId,
  () => { buffer.value = persisted.value }
)

/** After a save lands, the buffer follows what the server stored. */
function saveSucceeded(): void {
  buffer.value = persisted.value
}

const isDirty = computed(() => buffer.value !== persisted.value)
watch(isDirty, value => emit('update:dirty', value), { immediate: true })
const canSave = computed(() => props.editable && isDirty.value && !props.saving)

function cancel(): void {
  buffer.value = persisted.value
}

/**
 * Save, translating an emptied box into a deliberate clear.
 *
 * The API distinguishes three states, and only two of them are reachable
 * from here: a value sets, and `null` clears. *Absent* — "leave it alone" —
 * is never what a save means, so this always sends the key.
 */
function save(): void {
  if (!canSave.value) return
  const text = buffer.value.trim()
  emit('save', text.length > 0 ? text : null)
}

defineExpose({ saveSucceeded })
</script>

<template>
  <UCard data-testid="nts-observations">
    <template #header>
      <div class="flex items-center gap-2">
        <UIcon
          name="i-lucide-notebook-pen"
          class="w-5 h-5"
        />
        <h3 class="font-medium">
          {{ t('odontogram.nts.observations.title') }}
        </h3>
      </div>
    </template>

    <div class="space-y-3">
      <p class="text-caption text-subtle">
        {{ t('odontogram.nts.observations.hint') }}
      </p>

      <!-- Draft: an editable block with an explicit save. -->
      <template v-if="editable">
        <UFormField
          :label="t('odontogram.nts.observations.label')"
          name="nts-observations"
        >
          <UTextarea
            id="nts-observations-input"
            v-model="buffer"
            :rows="4"
            autoresize
            class="w-full"
            :aria-label="t('odontogram.nts.observations.label')"
            data-testid="nts-observations-input"
          />
        </UFormField>

        <div class="flex justify-end gap-2 flex-wrap">
          <UButton
            color="neutral"
            variant="ghost"
            size="sm"
            :disabled="!isDirty || saving"
            data-testid="nts-observations-cancel"
            @click="cancel()"
          >
            {{ t('common.cancel') }}
          </UButton>
          <UButton
            size="sm"
            :disabled="!canSave"
            :loading="saving"
            data-testid="nts-observations-save"
            @click="save()"
          >
            {{ t('common.save') }}
          </UButton>
        </div>
      </template>

      <!--
        Finalized or historical: the text as recorded. Read-only is said in
        words and in the markup, not left to colour — a locked clinical
        document must read as locked to a screen reader too.
      -->
      <template v-else>
        <p
          class="text-caption text-subtle"
          data-testid="nts-observations-readonly"
        >
          {{ t('odontogram.nts.observations.readonly') }}
        </p>
        <p
          v-if="persisted.length > 0"
          class="text-sm whitespace-pre-wrap break-words"
          aria-readonly="true"
          data-testid="nts-observations-text"
        >
          {{ persisted }}
        </p>
        <p
          v-else
          class="text-caption text-subtle"
          data-testid="nts-observations-empty"
        >
          {{ t('odontogram.nts.observations.empty') }}
        </p>
      </template>
    </div>
  </UCard>
</template>
