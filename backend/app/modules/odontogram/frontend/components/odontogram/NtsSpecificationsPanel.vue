<script setup lang="ts">
/**
 * NtsSpecificationsPanel — the annex's *Especificaciones* block (NTS §5.14).
 *
 * The norm sends here "los hallazgos o características clínicas adicionales
 * que presenten las piezas dentarias, y que **por la falta de espacio** no
 * puedan ser registrados en los recuadros". So this is overflow of the boxes,
 * written by a clinician in their own words — not a second finding model, and
 * never a treatment, a plan or a budget line.
 *
 * Presentation and local editing only. Every write goes back out through the
 * shell, which owns the record and its version.
 *
 * Explicit relative imports for the same reason as the rest of the layer: the
 * `module_layers` symlink does not resolve in the frontend test suite.
 */

import type { NtsFinding, NtsSpecification } from '../../types/nts'

const props = defineProps<{
  specifications: readonly NtsSpecification[]
  /** Findings of the record in view, so an entry can name the tooth it is about. */
  findings?: readonly NtsFinding[]
  editable: boolean
  /** True while any record-text write is in flight, refetch included. */
  saving: boolean
  /** How many siglas the chart could not fit. Advisory only. */
  hiddenSiglas?: number
}>()

const emit = defineEmits<{
  create: [text: string]
  update: [id: string, text: string, findingId: string | null]
  remove: [id: string]
}>()

const { t } = useI18n()

const creating = ref(false)
const draftText = ref('')

const editingId = ref<string | null>(null)
const editText = ref('')

const removingId = ref<string | null>(null)

const removing = computed(
  () => props.specifications.find(s => s.id === removingId.value) ?? null
)

/**
 * Which tooth an entry is about, when it says.
 *
 * `finding_id` is nullable by contract and a general entry is legitimate, so
 * the absence of a link is not a defect. When a link *is* present but its
 * finding is not among the ones loaded, the entry is still shown with a
 * neutral reference: hiding a clinician's text because a join failed would
 * lose the record, which is the one thing that may never happen.
 */
function findingLabel(specification: NtsSpecification): string | null {
  if (!specification.finding_id) return null
  const finding = props.findings?.find(f => f.id === specification.finding_id)
  if (!finding) return t('odontogram.nts.specifications.linkedUnknown')

  const teeth = finding.targets
    .filter(target => target.tooth_number !== null)
    .map(target => target.tooth_number)
  return teeth.length > 0
    ? t('odontogram.nts.specifications.linkedTeeth', { teeth: teeth.join(', ') })
    : t('odontogram.nts.specifications.linkedFinding')
}

const canSubmitCreate = computed(() => draftText.value.trim().length > 0)
const canSubmitEdit = computed(() => editText.value.trim().length > 0)

function openCreate(): void {
  creating.value = true
  draftText.value = ''
}

function cancelCreate(): void {
  creating.value = false
  draftText.value = ''
}

function submitCreate(): void {
  if (!canSubmitCreate.value) return
  emit('create', draftText.value.trim())
}

/**
 * Close the composer once the write has landed.
 *
 * Driven from the outside rather than optimistically: the shell calls this
 * only after the server accepted, so a rejected write leaves the text where
 * the clinician can still see and retry it.
 */
function createSucceeded(): void {
  creating.value = false
  draftText.value = ''
}

function startEdit(specification: NtsSpecification): void {
  editingId.value = specification.id
  editText.value = specification.text
}

/** Cancel restores the persisted text; nothing local survives the cancel. */
function cancelEdit(): void {
  editingId.value = null
  editText.value = ''
}

function submitEdit(specification: NtsSpecification): void {
  if (!canSubmitEdit.value) return
  // `finding_id` is passed through untouched: this edits the text, and an
  // association nobody asked to change must survive it.
  emit('update', specification.id, editText.value.trim(), specification.finding_id)
}

function editSucceeded(): void {
  editingId.value = null
  editText.value = ''
}

function confirmRemove(): void {
  if (removingId.value) emit('remove', removingId.value)
}

function removeSucceeded(): void {
  removingId.value = null
}

defineExpose({ createSucceeded, editSucceeded, removeSucceeded })
</script>

<template>
  <UCard data-testid="nts-specifications">
    <template #header>
      <div class="flex items-center justify-between gap-3 flex-wrap">
        <div class="flex items-center gap-2">
          <UIcon
            name="i-lucide-list-plus"
            class="w-5 h-5"
          />
          <h3 class="font-medium">
            {{ t('odontogram.nts.specifications.title') }}
          </h3>
          <UBadge
            v-if="specifications.length > 0"
            color="neutral"
            variant="subtle"
          >
            {{ specifications.length }}
          </UBadge>
        </div>

        <UButton
          v-if="editable && !creating"
          size="sm"
          icon="i-lucide-plus"
          :disabled="saving"
          data-testid="nts-spec-add"
          @click="openCreate()"
        >
          {{ t('odontogram.nts.specifications.add') }}
        </UButton>
      </div>
    </template>

    <div class="space-y-3">
      <!--
        Advisory, never a rule. §5.14 makes this block the natural home for
        what did not fit in a box, but nothing here is created automatically
        and nothing is copied: the findings still exist and are still listed,
        and the wording says so rather than implying anything was dropped.
      -->
      <UAlert
        v-if="editable && (hiddenSiglas ?? 0) > 0"
        color="neutral"
        variant="subtle"
        icon="i-lucide-info"
        :title="t('odontogram.nts.specifications.overflowTitle')"
        :description="t('odontogram.nts.specifications.overflowBody')"
        data-testid="nts-spec-overflow-advisory"
      />

      <p
        v-if="!editable"
        class="text-caption text-subtle"
        data-testid="nts-spec-readonly"
      >
        {{ t('odontogram.nts.specifications.readonly') }}
      </p>

      <!-- Entries, in the order the server keeps them. -->
      <ul
        v-if="specifications.length > 0"
        class="divide-y divide-default"
        data-testid="nts-spec-list"
      >
        <li
          v-for="(specification, index) in specifications"
          :key="specification.id"
          class="py-3"
          :data-testid="`nts-spec-row-${index}`"
        >
          <!-- Inline editor for this entry -->
          <div
            v-if="editingId === specification.id"
            class="space-y-2"
          >
            <UFormField
              :label="t('odontogram.nts.specifications.textLabel')"
              :name="`spec-edit-${specification.id}`"
            >
              <UTextarea
                v-model="editText"
                :rows="3"
                autoresize
                class="w-full"
                :aria-label="t('odontogram.nts.specifications.textLabel')"
                :data-testid="`nts-spec-edit-input-${index}`"
              />
            </UFormField>
            <div class="flex justify-end gap-2 flex-wrap">
              <UButton
                color="neutral"
                variant="ghost"
                size="sm"
                :data-testid="`nts-spec-edit-cancel-${index}`"
                @click="cancelEdit()"
              >
                {{ t('common.cancel') }}
              </UButton>
              <UButton
                size="sm"
                :disabled="!canSubmitEdit || saving"
                :loading="saving"
                :data-testid="`nts-spec-edit-save-${index}`"
                @click="submitEdit(specification)"
              >
                {{ t('common.save') }}
              </UButton>
            </div>
          </div>

          <!-- Or the entry as recorded -->
          <div
            v-else
            class="flex items-start justify-between gap-3"
          >
            <div class="min-w-0 space-y-1">
              <p class="text-sm whitespace-pre-wrap break-words">
                {{ specification.text }}
              </p>
              <p
                v-if="findingLabel(specification)"
                class="text-caption text-subtle"
                :data-testid="`nts-spec-link-${index}`"
              >
                {{ findingLabel(specification) }}
              </p>
            </div>

            <div
              v-if="editable"
              class="flex items-center gap-1 shrink-0"
            >
              <UButton
                color="neutral"
                variant="ghost"
                size="xs"
                icon="i-lucide-pencil"
                :disabled="saving"
                :aria-label="t('odontogram.nts.specifications.edit')"
                :data-testid="`nts-spec-edit-${index}`"
                @click="startEdit(specification)"
              />
              <UButton
                color="neutral"
                variant="ghost"
                size="xs"
                icon="i-lucide-trash-2"
                :disabled="saving"
                :aria-label="t('odontogram.nts.specifications.remove')"
                :data-testid="`nts-spec-remove-${index}`"
                @click="removingId = specification.id"
              />
            </div>
          </div>
        </li>
      </ul>

      <!-- Nothing recorded. Said plainly, in both states. -->
      <p
        v-else-if="!creating"
        class="text-caption text-subtle"
        data-testid="nts-spec-empty"
      >
        {{
          editable
            ? t('odontogram.nts.specifications.emptyDraft')
            : t('odontogram.nts.specifications.emptyFinalized')
        }}
      </p>

      <!-- Composer -->
      <div
        v-if="creating"
        class="space-y-2"
        data-testid="nts-spec-composer"
      >
        <UFormField
          :label="t('odontogram.nts.specifications.textLabel')"
          name="spec-new"
        >
          <UTextarea
            v-model="draftText"
            :rows="3"
            autoresize
            class="w-full"
            :aria-label="t('odontogram.nts.specifications.textLabel')"
            data-testid="nts-spec-new-input"
          />
        </UFormField>
        <div class="flex justify-end gap-2 flex-wrap">
          <UButton
            color="neutral"
            variant="ghost"
            size="sm"
            data-testid="nts-spec-new-cancel"
            @click="cancelCreate()"
          >
            {{ t('common.cancel') }}
          </UButton>
          <UButton
            size="sm"
            :disabled="!canSubmitCreate || saving"
            :loading="saving"
            data-testid="nts-spec-new-save"
            @click="submitCreate()"
          >
            {{ t('common.save') }}
          </UButton>
        </div>
      </div>
    </div>

    <!--
      Withdraw one entry. "Remove", never "delete permanently": the record
      keeps its audit trail and the wording must not promise otherwise.
    -->
    <UModal
      :open="removing !== null"
      :title="t('odontogram.nts.specifications.remove')"
      @update:open="$event || (removingId = null)"
    >
      <template #body>
        <p class="text-sm">
          {{ t('odontogram.nts.specifications.removeExplanation') }}
        </p>
        <p class="text-sm mt-2 whitespace-pre-wrap break-words text-subtle">
          {{ removing?.text }}
        </p>
      </template>
      <template #footer>
        <div class="flex justify-end gap-2 w-full">
          <UButton
            color="neutral"
            variant="ghost"
            @click="removingId = null"
          >
            {{ t('common.cancel') }}
          </UButton>
          <UButton
            color="warning"
            :loading="saving"
            data-testid="nts-spec-remove-confirm"
            @click="confirmRemove()"
          >
            {{ t('odontogram.nts.specifications.remove') }}
          </UButton>
        </div>
      </template>
    </UModal>
  </UCard>
</template>
