<script setup lang="ts">
/**
 * NtsPrintAction — the one control that opens the print dialog (NTS-05F.3).
 *
 * ## Why there is exactly one of these
 *
 * The sheet always prints `viewRecord`: the historical record when one is
 * open, otherwise the draft, otherwise the record in force. That is *one*
 * record at a time, so one button. Putting a Print button in the current-record
 * card and another in the draft card would produce two controls that both
 * print the draft whenever a draft exists — the same document, from a control
 * that says otherwise.
 *
 * ## What it refuses, and what it merely labels
 *
 * Two different things, and conflating them would be the bug:
 *
 * * **Refusals** come from {@link resolvePrintAvailability} — unsaved text, a
 *   write in flight, a failed re-read, an unacknowledged conflict, a norm the
 *   catalog cannot serve. The button does not open the dialog, and says why.
 * * **Qualifications** — draft, discarded, superseded — are not refusals. A
 *   working copy is a legitimate thing to print; the printed sheet states what
 *   it is. Those live in `NtsOdontogramPrintView`, not here.
 *
 * ## The dialog this cannot configure
 *
 * `window.print()` takes no arguments. Paper size, orientation, scale and
 * colour belong to the browser's own dialog and nothing here can set them, so
 * the modal *asks* rather than promising. The scale line is not decoration:
 * at 100% the narrowest crown measures 0.545 cm² against §5.17's 0.5 cm²
 * minimum, so "Fit to page" produces a sheet that does not satisfy the norm.
 */

import type { NtsPrintAvailability, NtsPrintDeclaration } from '../../utils/ntsPrintModel'

const props = withDefaults(
  defineProps<{
    /** The single decision, shared with the print root. Never recomputed. */
    availability: NtsPrintAvailability
    /** Drives the label only — `draft`, `discarded` or anything else. */
    status?: string | null
    /**
     * Findings the chart cannot carry in full, from `printDeclarations`.
     * Summarised in the preflight so nobody meets them first on paper.
     */
    declarations?: readonly NtsPrintDeclaration[]
  }>(),
  { status: null, declarations: () => [] }
)

const { t } = useI18n()

const open = ref(false)

/**
 * Whether to offer the control at all.
 *
 * A structural blocker means there is nothing to print and nothing to do
 * about it here, so no button appears. A transient one keeps the button
 * visible and disabled: a control that vanishes gives no reason, and a
 * control that looks live and does nothing is worse than either.
 */
const visible = computed(
  () => props.availability.printable || props.availability.transient
)

const label = computed(() => {
  if (props.status === 'draft') return t('odontogram.nts.print.printDraft')
  if (props.status === 'discarded') return t('odontogram.nts.print.printDiscarded')
  return t('odontogram.nts.print.print')
})

/** Why the button is disabled, in the clinician's terms. */
const blockedReason = computed(() => {
  switch (props.availability.blocker) {
    case 'dirty': return t('odontogram.nts.print.dirtyBlocked')
    case 'writing': return t('odontogram.nts.print.writingBlocked')
    case 'refresh_failed': return t('odontogram.nts.print.refreshBlocked')
    case 'conflict': return t('odontogram.nts.print.conflictBlocked')
    case 'loading':
    case 'refreshing':
    case 'opening_historical': return t('odontogram.nts.print.loadingBlocked')
    default: return null
  }
})

const partialCount = computed(
  () => props.declarations.filter(d => d.completeness === 'partial').length
)
const unsupportedCount = computed(
  () => props.declarations.filter(d => d.completeness === 'unsupported').length
)

function requestPrint(): void {
  // Belt and braces: the button is already disabled, and the print root
  // refuses independently. A third check costs nothing and means no future
  // caller can open the dialog past a blocker.
  if (!props.availability.printable) return
  open.value = true
}

/**
 * Hand over to the browser.
 *
 * The modal is closed first and the DOM allowed to settle, so the overlay is
 * not what the print snapshot captures. `window.print()` is called once; there
 * is no PDF library, no server round trip and no external service — the sheet
 * never leaves the machine.
 */
async function confirmPrint(): Promise<void> {
  open.value = false
  await nextTick()
  window.print()
}
</script>

<template>
  <div v-if="visible">
    <UButton
      size="xs"
      color="neutral"
      variant="subtle"
      icon="i-lucide-printer"
      :disabled="!availability.printable"
      :aria-label="label"
      :title="blockedReason ?? undefined"
      data-testid="nts-print-action"
      :data-blocker="availability.blocker ?? undefined"
      @click="requestPrint()"
    >
      {{ label }}
    </UButton>

    <!-- The reason, as text rather than only a disabled attribute: a control
         that refuses without saying why is a control nobody can act on. -->
    <p
      v-if="blockedReason"
      class="mt-1 text-caption text-subtle max-w-xs"
      data-testid="nts-print-blocked-reason"
    >
      {{ blockedReason }}
    </p>

    <UModal
      :open="open"
      :title="t('odontogram.nts.print.prepare')"
      data-testid="nts-print-preflight"
      @update:open="open = $event"
    >
      <template #body>
        <div class="space-y-4 text-sm">
          <p class="text-caption text-subtle">
            {{ t('odontogram.nts.print.prepareHint') }}
          </p>

          <!-- The four settings the sheet depends on. Stated as a list the
               clinician can check off against the native dialog. -->
          <ul
            class="space-y-1 list-disc list-inside"
            data-testid="nts-print-settings"
          >
            <li>{{ t('odontogram.nts.print.paper') }}</li>
            <li>{{ t('odontogram.nts.print.orientation') }}</li>
            <li>{{ t('odontogram.nts.print.scale') }}</li>
            <li>{{ t('odontogram.nts.print.color') }}</li>
          </ul>

          <p
            class="text-caption text-subtle"
            data-testid="nts-print-color-hint"
          >
            {{ t('odontogram.nts.print.colorHint') }}
          </p>

          <!-- §5.17: the crown has a stated minimum size, and shrinking the
               sheet to fit is the one setting that silently breaks it. -->
          <UAlert
            color="warning"
            variant="subtle"
            icon="i-lucide-ruler"
            :description="t('odontogram.nts.print.doNotFit')"
            data-testid="nts-print-fit-warning"
          />

          <!-- Findings the chart cannot carry in full. Counted from the same
               `printDeclarations` the sheet itself uses, never recomputed. -->
          <UAlert
            v-if="declarations.length > 0"
            color="neutral"
            variant="subtle"
            icon="i-lucide-shapes"
            :title="t('odontogram.nts.print.incompleteWarning')"
            data-testid="nts-print-incomplete-warning"
          >
            <template #description>
              <div class="space-y-1">
                <p v-if="unsupportedCount > 0" data-testid="nts-print-unsupported-count">
                  {{ t('odontogram.nts.print.unsupportedCount', { count: unsupportedCount }) }}
                </p>
                <p v-if="partialCount > 0" data-testid="nts-print-partial-count">
                  {{ t('odontogram.nts.print.partialCount', { count: partialCount }) }}
                </p>
                <p>{{ t('odontogram.nts.print.incompleteNote') }}</p>
                <!-- Where the clinician *may* add detail if they judge it
                     needed. Not a recommendation about any particular rule,
                     and nothing is written on their behalf. -->
                <p class="text-subtle">
                  {{ t('odontogram.nts.print.additionalDetailsHint') }}
                </p>
              </div>
            </template>
          </UAlert>
        </div>
      </template>

      <template #footer>
        <div class="flex justify-end gap-2 w-full">
          <UButton
            color="neutral"
            variant="ghost"
            data-testid="nts-print-cancel"
            @click="open = false"
          >
            {{ t('odontogram.nts.print.cancel') }}
          </UButton>
          <UButton
            data-testid="nts-print-confirm"
            @click="confirmPrint()"
          >
            {{ t('odontogram.nts.print.openPrintDialog') }}
          </UButton>
        </div>
      </template>
    </UModal>
  </div>
</template>
