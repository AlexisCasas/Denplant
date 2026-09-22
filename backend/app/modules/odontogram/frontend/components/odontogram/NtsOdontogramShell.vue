<script setup lang="ts">
/**
 * NtsOdontogramShell — lifecycle shell for the MINSA Perú odontogram (NTS-05A).
 *
 * Replaces the NTS-02 placeholder with a working surface over the NTS API:
 * catalog, current finalized record, open draft, history, and the three
 * lifecycle actions (create empty draft, finalize, discard).
 *
 * The chart itself is **not** here. The area where the 38 graphic rules will
 * be drawn is marked as pending on purpose, so nobody mistakes this for a
 * finished renderer.
 *
 * Explicit relative imports for the same reason as `OdontogramProfileView`:
 * the `module_layers` symlink does not resolve in the frontend test suite,
 * so the layer's auto-imports are unavailable there.
 */

import type { NtsFinding } from '../../types/nts'
import { useNtsOdontogramRecord } from '../../composables/useNtsOdontogramRecord'
import NtsOdontogramChart from './NtsOdontogramChart.vue'
import NtsFindingEditor from './NtsFindingEditor.vue'
import NtsFindingList from './NtsFindingList.vue'
import NtsSpecificationsPanel from './NtsSpecificationsPanel.vue'
import NtsObservationsPanel from './NtsObservationsPanel.vue'
import NtsRecordHistory from './NtsRecordHistory.vue'
import NtsOdontogramPrintView from './NtsOdontogramPrintView.vue'
import NtsPrintAction from './NtsPrintAction.vue'
import { printDeclarations, resolvePrintAvailability } from '../../utils/ntsPrintModel'
import { useNtsFindingEditor } from '../../composables/useNtsFindingEditor'
import { useNtsUnsavedChanges } from '../../composables/useNtsUnsavedChanges'
import { useNtsPrintIdentity } from '../../composables/useNtsPrintIdentity'

const props = defineProps<{
  patientId: string
  /** The profile value doubles as the norm version (see NTS-04A §3). */
  normVersion?: string
}>()

const { t, locale } = useI18n()

const normVersion = computed(() => props.normVersion ?? 'pe_nts_188_2022')

// Getters, not values: the shell can be reused across patients without being
// remounted, and a snapshot here would silently keep loading the first one.
const record = useNtsOdontogramRecord({
  patientId: () => props.patientId,
  normVersion: () => normVersion.value
})

const {
  catalog,
  currentRecord,
  draft,
  history,
  isLoading,
  isRefreshing,
  isMutating,
  error,
  clinicalErrors,
  conflict,
  normUnavailable,
  hasDraft,
  hasCurrent,
  isEmpty,
  pendingCarriedForward,
  hasPendingCarriedForward,
  observations,
  specifications,
  isTextEditable,
  isSavingText,
  isWriting,
  beginWrite,
  endWrite,
  refreshFailed: textRefreshFailed,
  retryRefresh: retryTextRefresh,
  mode,
  isHistorical,
  historicalId,
  historicalRecord,
  historicalError,
  historicalCatalogUnavailable,
  isOpeningHistorical,
  viewRecord,
  viewCatalog,
  openHistorical,
  retryHistorical,
  returnToCurrent,
  saveObservations,
  addSpecification,
  editSpecification,
  removeSpecification,
  load,
  reload,
  recoverFromConflict,
  createDraft,
  finalizeDraft,
  discardDraft,
  dismissConflict
} = record

/**
 * Stage taxonomy.
 *
 * This is **product metadata**, not a normative requirement: NTS N.° 188
 * does not mandate a fixed set of slots, and the prototype's three hardcoded
 * ones (diagnóstico / evolución / alta) were an antipattern. `other` plus a
 * free label is what keeps this from becoming three slots again.
 */
const STAGES = ['diagnosis', 'evolution', 'discharge', 'other'] as const
type Stage = typeof STAGES[number]

const createOpen = ref(false)
const createStage = ref<Stage>('diagnosis')
const createStageLabel = ref('')

const discardOpen = ref(false)
const discardReason = ref('')

/**
 * Which record the chart stands for.
 *
 * A draft is what the clinician is working on, so it wins; with no draft the
 * record in force is shown read-only; with neither, the chart is the blank
 * official form and says so. Nothing is fabricated to fill the gap.
 */
/**
 * The record on the chart, and whether it can be edited.
 *
 * One pair for both modes. A historical record is inspection and is read-only
 * whatever its status says: a draft that belongs to the history is still not
 * the draft this shell is working on.
 */
const chartRecord = computed(() => viewRecord.value)
const chartReadonly = computed(() => isHistorical.value || !hasDraft.value)

/**
 * The structured finding editor.
 *
 * It is given the draft, the catalog's rules and a way to reload; it never
 * reaches into the lifecycle state itself, and the lifecycle composable knows
 * nothing about editing. A 409 is routed to the same recovery 05A already
 * uses, so there is one conflict policy rather than two.
 */
const editor = useNtsFindingEditor({
  // Never the historical record: opening one is inspection, and an editor
  // bound to it would offer writes the server would refuse anyway.
  record: () => (!isHistorical.value && draft.value?.status === 'draft' ? draft.value : null),
  rules: () => catalog.value?.rules ?? [],
  reload: () => reload(),
  onConflict: kind => recoverFromConflict(kind),
  // One lock for the whole record, shared with the text panels: the two
  // families bump the same version and cannot both read it at once.
  lock: { begin: beginWrite, end: endWrite }
})

/** Teeth may only be picked while a rule that needs them is open. */
const chartSelectable = computed(
  () => editor.isOpen.value && editor.pickMode.value !== 'none'
)
const selectedTeeth = computed(() =>
  editor.pickMode.value === 'anchor' && editor.selection.value.teeth.length === 0
    ? []
    : editor.selection.value.teeth
)

const removing = ref<NtsFinding | null>(null)

async function confirmRemove(): Promise<void> {
  const finding = removing.value
  if (!finding) return
  const ok = await editor.removeFinding(finding)
  if (ok) removing.value = null
}

function saveEditor(): void {
  if (editor.isCreating.value) {
    void editor.createFinding()
    return
  }
  const original = draft.value?.findings.find(f => f.id === editor.editing.value)
  if (original) void editor.saveFinding(original)
}

const canSubmitCreate = computed(
  () => createStage.value !== 'other' || createStageLabel.value.trim().length > 0
)
const canSubmitDiscard = computed(() => discardReason.value.trim().length > 0)

function formatDate(value: string | null): string {
  if (!value) return '—'
  return new Date(value).toLocaleString(locale.value, {
    dateStyle: 'medium',
    timeStyle: 'short'
  })
}

function stageLabel(stage: string, label: string | null): string {
  const known = (STAGES as readonly string[]).includes(stage)
  const base = known ? t(`odontogram.nts.stage.${stage}`) : stage
  return label ? `${base} — ${label}` : base
}

async function submitCreate() {
  const ok = await createDraft({
    stage: createStage.value,
    stageLabel: createStage.value === 'other' ? createStageLabel.value.trim() : null
  })
  if (ok) {
    createOpen.value = false
    createStageLabel.value = ''
  }
}

async function submitDiscard() {
  const ok = await discardDraft(discardReason.value)
  if (ok) {
    discardOpen.value = false
    discardReason.value = ''
  }
}

/**
 * The record's own two text blocks (§5.14, §5.15).
 *
 * Both panels are controlled: they hold a local buffer and emit, and the
 * write goes through the record composable, which owns the id and the
 * version. A panel is told a write *succeeded* rather than guessing from a
 * prop change, so a rejected save leaves the clinician's text on screen
 * instead of silently reverting it.
 */
const specificationsPanel = ref<{
  createSucceeded: () => void
  editSucceeded: () => void
  removeSucceeded: () => void
} | null>(null)
const observationsPanel = ref<{ saveSucceeded: () => void } | null>(null)

/** Siglas the chart could not fit. Advisory input for §5.14, never a rule. */
const hiddenSiglas = ref(0)

/**
 * Unsaved work anywhere on the current record.
 *
 * One definition for one policy. The two text panels report their own
 * buffers; an open finding editor counts because it holds a half-built
 * finding that closing would discard. A historical view has no buffers of its
 * own, so leaving it is always safe.
 */
const textDirty = ref({ specifications: false, observations: false })
const hasUnsavedWork = computed(
  () => !isHistorical.value
    && (textDirty.value.specifications || textDirty.value.observations || editor.isOpen.value)
)

/** Where navigation was heading when it was stopped. */
const pendingNavigation = ref<{ kind: 'history', recordId: string } | { kind: 'current' } | null>(null)

/**
 * Navigate, or ask first.
 *
 * Opening a historical record swaps the record in view, which resets the
 * panels' buffers — so a stray click would silently destroy a half-written
 * observation. Rather than preserve buffers per record (state that would then
 * have to be invalidated correctly) the navigation is simply confirmed, which
 * is the smaller and more honest mechanism: the clinician is told what they
 * are about to lose and decides.
 */
function requestHistorical(recordId: string): void {
  if (hasUnsavedWork.value) {
    pendingNavigation.value = { kind: 'history', recordId }
    return
  }
  void openHistorical(recordId)
}

function requestCurrent(): void {
  if (hasUnsavedWork.value) {
    pendingNavigation.value = { kind: 'current' }
    return
  }
  backToCurrent()
}

/** The clinician chose to lose it. Nothing is saved on the way out. */
function confirmNavigation(): void {
  const target = pendingNavigation.value
  pendingNavigation.value = null
  if (!target) return
  editor.close()
  if (target.kind === 'history') void openHistorical(target.recordId)
  else backToCurrent()
}

/**
 * Leave the history.
 *
 * The editor is closed first: it is bound to the draft, and returning with a
 * half-filled form open would show a composer whose record just changed
 * underneath it.
 */
function backToCurrent(): void {
  editor.close()
  returnToCurrent()
}

async function submitObservations(text: string | null): Promise<void> {
  if (await saveObservations(text)) observationsPanel.value?.saveSucceeded()
}

async function submitNewSpecification(text: string): Promise<void> {
  if (await addSpecification(text)) specificationsPanel.value?.createSucceeded()
}

async function submitSpecificationEdit(
  id: string,
  text: string,
  findingId: string | null
): Promise<void> {
  if (await editSpecification(id, text, findingId)) {
    specificationsPanel.value?.editSucceeded()
  }
}

async function submitSpecificationRemoval(id: string): Promise<void> {
  if (await removeSpecification(id)) specificationsPanel.value?.removeSucceeded()
}

/**
 * Publish what would be lost, for the controls that can take this away.
 *
 * The chart-format selector is a sibling and a route change comes from
 * outside both, so neither can see these buffers. They get one boolean each
 * instead: `dirty` is discardable text, `writing` is a mutation already sent.
 */
const unsaved = useNtsUnsavedChanges()
watch(
  [hasUnsavedWork, isWriting],
  ([dirty, writing]) => unsaved.publish({ dirty, writing }),
  { immediate: true }
)

/**
 * Leaving the page.
 *
 * Scoped to this component rather than to the patient page, which hosts
 * several other tabs that have nothing to protect. `onBeforeRouteLeave` is
 * only active while the shell is mounted, which is exactly the window in
 * which these buffers exist.
 *
 * A window-level `beforeunload` covers reload and tab close, following the
 * periodontogram's existing guard. The browser ignores any custom text, so
 * none is supplied: the point is the native prompt, not its wording.
 */
onBeforeRouteLeave(() => {
  // A mutation already sent is not the browser's to discard, and its result
  // needs a screen to land on. There is nothing to offer here — not even a
  // confirmation, because agreeing to it would not undo the write. The
  // navigation is refused until the request and its refetch have settled,
  // which is at most a moment.
  if (unsaved.writing.value) return false

  if (!unsaved.dirty.value) return true

  // Text the clinician typed and nobody has sent: theirs to abandon.
  // eslint-disable-next-line no-alert
  return window.confirm(t('odontogram.nts.unsaved.leavePage'))
})

function guardUnload(event: BeforeUnloadEvent): void {
  if (!unsaved.isBlocked.value) return
  event.preventDefault()
  event.returnValue = ''
}

onMounted(() => {
  if (typeof window !== 'undefined') {
    window.addEventListener('beforeunload', guardUnload)
  }
  void load()
})

onBeforeUnmount(() => {
  if (typeof window !== 'undefined') {
    window.removeEventListener('beforeunload', guardUnload)
  }
  // Shared state outlives the component; a stale `true` would block
  // navigation on a screen with nothing left to lose.
  unsaved.reset()
})

// A patient or norm change must never leave the previous record on screen;
// `load()` clears state before awaiting anything and drops the late response.
watch([() => props.patientId, normVersion], () => void load())

/**
 * The printed document (NTS-05F.2).
 *
 * Mounted alongside the working surface, not instead of it, and teleported to
 * `<body>` so that print CSS can hide every other child of the body in one
 * rule. Hiding the application control by control would be a list that goes
 * stale the next time somebody adds a button — and the thing going stale
 * would be a clinical document.
 *
 * It is mounted **always**, not on a click: the browser's own Ctrl+P must
 * produce the sheet, and 05F.3's button does not exist yet. On screen it is
 * `display: none`, so it costs a second render of the chart and nothing else
 * — the print view is pure props, issues no request and mutates nothing, and
 * the chart subtree declares no element ids, so two instances cannot collide
 * over an `id` or a `url(#…)` reference.
 *
 * It resolves nothing of its own. Record, catalog, patient and supersession
 * are all decided here, once, and handed down.
 */
const { identity: printPatient } = useNtsPrintIdentity(() => props.patientId)

/**
 * Whether a later finalized record has replaced the one being printed.
 *
 * Derived from the history rows, which is where the server publishes it; the
 * record itself does not carry the flag, so it is looked up rather than
 * guessed. Unknown means `false`: claiming a document is superseded when the
 * history has not loaded would be worse than saying nothing.
 */
const printSuperseded = computed(() => {
  const id = viewRecord.value?.id
  if (!id) return false
  return history.value.find(row => row.id === id)?.is_superseded ?? false
})

/**
 * Whether the record on screen may be printed right now (NTS-05F.3).
 *
 * **One computation, two consumers.** The print button asks it what to offer;
 * the always-mounted print root asks it whether to render the clinical
 * document at all. That second reader is the one that matters: the root is
 * reachable by the browser's own Ctrl+P without passing the button, so a
 * disabled button is a courtesy and this object is the actual gate.
 *
 * The two refresh failures are OR-ed because they mean the same thing for a
 * sheet — a write landed and the re-read did not, so what is on screen may be
 * behind the server — even though each has its own banner and its own
 * GET-only retry.
 */
const printAvailability = computed(() => resolvePrintAvailability({
  record: viewRecord.value,
  catalog: viewCatalog.value,
  dirty: unsaved.dirty.value,
  writing: unsaved.writing.value,
  loading: isLoading.value,
  refreshing: isRefreshing.value,
  openingHistorical: isOpeningHistorical.value,
  refreshFailed: textRefreshFailed.value || editor.refreshFailed.value,
  conflict: conflict.value !== null
}))

/**
 * Findings the chart cannot carry in full, for the preflight summary.
 *
 * The same call the printed sheet makes, so the count the clinician is shown
 * before printing and the note they read afterwards cannot disagree.
 */
const printDeclarationList = computed(
  () => printDeclarations(viewRecord.value, viewCatalog.value)
)
</script>

<template>
  <div
    class="space-y-4"
    data-testid="nts-odontogram-shell"
  >
    <!-- Norm identity -->
    <div class="flex items-start justify-between gap-3 flex-wrap">
      <div>
        <p class="text-h2 text-default">
          {{ t('odontogram.profile.nts.title') }}
        </p>
        <p
          class="text-caption text-subtle"
          data-testid="nts-norm-label"
        >
          {{ catalog?.norm_label ?? t('odontogram.profile.nts.norm') }}
        </p>
      </div>
      <div class="flex items-center gap-2">
        <UIcon
          v-if="isRefreshing"
          name="i-lucide-loader-2"
          class="w-4 h-4 animate-spin text-subtle"
          :aria-label="t('odontogram.nts.editor.refreshing')"
          data-testid="nts-refreshing"
        />
        <UBadge
          color="warning"
          variant="subtle"
          size="sm"
        >
          {{ t('odontogram.nts.chart.findingRendererPending') }}
        </UBadge>
      </div>
    </div>

    <!-- Norm version this build cannot interpret: never fall back silently -->
    <UAlert
      v-if="normUnavailable"
      color="error"
      variant="subtle"
      icon="i-lucide-triangle-alert"
      :title="t('odontogram.nts.error.normUnavailableTitle')"
      :description="t('odontogram.nts.error.normUnavailable')"
      data-testid="nts-norm-unavailable"
    />

    <template v-else>
      <!-- Loading -->
      <!-- Only the first load, or a change of patient or norm, replaces the
           surface. A refetch after a mutation refreshes it in place. -->
      <div
        v-if="isLoading"
        class="flex items-center justify-center py-12"
        data-testid="nts-loading"
      >
        <UIcon
          name="i-lucide-loader-2"
          class="w-8 h-8 animate-spin text-primary-accent"
          :aria-label="t('common.loading')"
        />
      </div>

      <template v-else>
        <!-- Transport / unknown failure -->
        <UAlert
          v-if="error"
          color="error"
          variant="subtle"
          icon="i-lucide-triangle-alert"
          :title="t('odontogram.nts.error.loadTitle')"
          :description="error.message"
          data-testid="nts-load-error"
        >
          <template #actions>
            <UButton
              size="xs"
              color="neutral"
              variant="ghost"
              @click="load()"
            >
              {{ t('common.retry') }}
            </UButton>
          </template>
        </UAlert>

        <!-- A concurrent session moved the record on -->
        <UAlert
          v-if="conflict"
          color="warning"
          variant="subtle"
          icon="i-lucide-refresh-cw"
          :title="t('odontogram.nts.conflict.title')"
          :description="t(`odontogram.nts.conflict.${conflict}`)"
          :close="true"
          data-testid="nts-conflict"
          @update:open="dismissConflict()"
        />

        <!-- Clinical validation: every problem, never just the first -->
        <UAlert
          v-if="clinicalErrors.length > 0"
          color="error"
          variant="subtle"
          icon="i-lucide-clipboard-x"
          :title="t('odontogram.nts.error.clinicalTitle')"
          data-testid="nts-clinical-errors"
        >
          <template #description>
            <ul class="list-disc list-inside space-y-1">
              <li
                v-for="(message, index) in clinicalErrors"
                :key="index"
              >
                {{ message }}
              </li>
            </ul>
          </template>
        </UAlert>

        <!-- Nothing recorded yet. Reading never creates a draft. -->
        <div
          v-if="isEmpty"
          class="flex flex-col items-center text-center gap-3 py-10 px-6
                 rounded-token-md border border-dashed border-default bg-surface-muted"
          data-testid="nts-empty"
        >
          <UIcon
            name="i-lucide-file-plus-2"
            class="w-9 h-9 text-subtle"
            aria-hidden="true"
          />
          <p class="text-default">
            {{ t('odontogram.nts.empty.title') }}
          </p>
          <UButton
            icon="i-lucide-plus"
            :loading="isMutating"
            data-testid="nts-create-draft"
            @click="createOpen = true"
          >
            {{ t('odontogram.nts.actions.createDraft') }}
          </UButton>
        </div>

        <!-- A current record and an open draft can coexist: a draft never
             replaces the record in force. -->
        <UCard
          v-if="hasCurrent"
          data-testid="nts-current-record"
        >
          <template #header>
            <div class="flex items-center gap-2">
              <UIcon
                name="i-lucide-file-check-2"
                class="w-5 h-5 text-primary-accent"
              />
              <span class="font-medium">{{ t('odontogram.nts.current.title') }}</span>
              <UBadge
                color="success"
                variant="subtle"
                size="sm"
              >
                {{ t('odontogram.nts.status.finalized') }}
              </UBadge>
            </div>
          </template>

          <dl class="grid grid-cols-2 gap-x-4 gap-y-2 text-sm">
            <dt class="text-subtle">
              {{ t('odontogram.nts.field.stage') }}
            </dt>
            <dd>{{ stageLabel(currentRecord!.stage, currentRecord!.stage_label) }}</dd>

            <dt class="text-subtle">
              {{ t('odontogram.nts.field.finalizedAt') }}
            </dt>
            <dd>{{ formatDate(currentRecord!.finalized_at) }}</dd>

            <dt class="text-subtle">
              {{ t('odontogram.nts.field.recordedBy') }}
            </dt>
            <dd>{{ currentRecord!.recorded_by_name ?? '—' }}</dd>

            <dt class="text-subtle">
              {{ t('odontogram.nts.field.findings') }}
            </dt>
            <dd>{{ currentRecord!.findings.length }}</dd>
          </dl>
        </UCard>

        <!-- Draft -->
        <UCard
          v-if="hasDraft"
          data-testid="nts-draft"
        >
          <template #header>
            <div class="flex items-center justify-between gap-3 flex-wrap">
              <div class="flex items-center gap-2">
                <UIcon
                  name="i-lucide-file-pen-line"
                  class="w-5 h-5 text-warning"
                />
                <span class="font-medium">{{ t('odontogram.nts.draft.title') }}</span>
                <UBadge
                  color="warning"
                  variant="subtle"
                  size="sm"
                  data-testid="nts-draft-version"
                >
                  v{{ draft!.version }}
                </UBadge>
              </div>
              <div class="flex items-center gap-2">
                <UButton
                  size="xs"
                  color="neutral"
                  variant="ghost"
                  :loading="isMutating"
                  :disabled="isWriting"
                  data-testid="nts-discard-draft"
                  @click="discardOpen = true"
                >
                  {{ t('odontogram.nts.actions.discardDraft') }}
                </UButton>
                <UButton
                  size="xs"
                  :loading="isMutating"
                  :disabled="hasPendingCarriedForward || isWriting"
                  data-testid="nts-finalize-draft"
                  @click="finalizeDraft()"
                >
                  {{ t('odontogram.nts.actions.finalize') }}
                </UButton>
              </div>
            </div>
          </template>

          <dl class="grid grid-cols-2 gap-x-4 gap-y-2 text-sm">
            <dt class="text-subtle">
              {{ t('odontogram.nts.field.stage') }}
            </dt>
            <dd>{{ stageLabel(draft!.stage, draft!.stage_label) }}</dd>

            <dt class="text-subtle">
              {{ t('odontogram.nts.field.openedAt') }}
            </dt>
            <dd>{{ formatDate(draft!.recorded_at) }}</dd>

            <dt class="text-subtle">
              {{ t('odontogram.nts.field.findings') }}
            </dt>
            <dd>{{ draft!.findings.length }}</dd>
          </dl>

          <!-- Carried-forward findings a previous client left unreviewed.
               05A cannot resolve them, and must not imply they are settled. -->
          <UAlert
            v-if="hasPendingCarriedForward"
            class="mt-3"
            color="warning"
            variant="subtle"
            icon="i-lucide-list-checks"
            :title="t('odontogram.nts.carriedForward.title', { count: pendingCarriedForward.length })"
            :description="t('odontogram.nts.carriedForward.hint')"
            data-testid="nts-carried-forward"
          />
        </UCard>

        <!--
          Which record is on screen. An explicit statement, not an inference
          from a missing Save button: the record in force is routinely
          finalized and is still the current one, so a clinician must be able
          to tell inspection from the live document at a glance.
        -->
        <UAlert
          v-if="isHistorical"
          color="neutral"
          variant="subtle"
          icon="i-lucide-history"
          :title="t('odontogram.nts.history.viewingTitle')"
          :description="t('odontogram.nts.history.viewingBody')"
          data-testid="nts-historical-banner"
        >
          <template #actions>
            <UButton
              size="xs"
              color="neutral"
              data-testid="nts-historical-return"
              @click="requestCurrent()"
            >
              {{ t('odontogram.nts.history.returnToCurrent') }}
            </UButton>
          </template>
        </UAlert>

        <!--
          Who recorded it, when, and under which norm — but only the fields
          the record actually carries. A summary has no actor names, which is
          why the selector promises none; the full record sometimes does, and
          an absent one is simply not rendered rather than shown as a blank.
        -->
        <UCard
          v-if="isHistorical && historicalRecord"
          data-testid="nts-historical-detail"
        >
          <dl class="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 text-sm">
            <dt class="text-subtle">
              {{ t('odontogram.nts.field.stage') }}
            </dt>
            <dd>{{ stageLabel(historicalRecord.stage, historicalRecord.stage_label) }}</dd>

            <dt class="text-subtle">
              {{ t('odontogram.nts.field.openedAt') }}
            </dt>
            <dd>{{ formatDate(historicalRecord.recorded_at) }}</dd>

            <template v-if="historicalRecord.finalized_at">
              <dt class="text-subtle">
                {{ t('odontogram.nts.field.finalizedAt') }}
              </dt>
              <dd>{{ formatDate(historicalRecord.finalized_at) }}</dd>
            </template>

            <template v-if="historicalRecord.discarded_at">
              <dt class="text-subtle">
                {{ t('odontogram.nts.field.discardedAt') }}
              </dt>
              <dd>{{ formatDate(historicalRecord.discarded_at) }}</dd>
            </template>

            <template v-if="historicalRecord.discard_reason">
              <dt class="text-subtle">
                {{ t('odontogram.nts.field.discardReason') }}
              </dt>
              <dd data-testid="nts-historical-discard-reason">
                {{ historicalRecord.discard_reason }}
              </dd>
            </template>

            <template v-if="historicalRecord.recorded_by_name">
              <dt class="text-subtle">
                {{ t('odontogram.nts.field.recordedBy') }}
              </dt>
              <dd data-testid="nts-historical-actor">
                {{ historicalRecord.recorded_by_name }}
                <span
                  v-if="historicalRecord.recorded_by_professional_id"
                  class="text-subtle"
                >· {{ historicalRecord.recorded_by_professional_id }}</span>
              </dd>
            </template>

            <dt class="text-subtle">
              {{ t('odontogram.nts.field.normVersion') }}
            </dt>
            <dd data-testid="nts-historical-norm">{{ historicalRecord.norm_version }}</dd>
          </dl>
        </UCard>

        <!-- The record could not be read. The current one is untouched. -->
        <UAlert
          v-if="isHistorical && historicalError"
          color="error"
          variant="subtle"
          icon="i-lucide-file-x"
          :title="t('odontogram.nts.history.loadFailedTitle')"
          :description="historicalError.message"
          data-testid="nts-historical-error"
        >
          <template #actions>
            <UButton
              size="xs"
              color="neutral"
              :loading="isOpeningHistorical"
              data-testid="nts-historical-retry"
              @click="retryHistorical()"
            >
              {{ t('common.retry') }}
            </UButton>
          </template>
        </UAlert>

        <!--
          The record was read; the norm it cites cannot be served. Its dates
          and status stay visible, and nothing is drawn: interpreting these
          findings under another norm's rules would put marks on the chart
          that the record does not contain.
        -->
        <UAlert
          v-if="isHistorical && historicalCatalogUnavailable"
          color="warning"
          variant="subtle"
          icon="i-lucide-book-x"
          :title="t('odontogram.nts.history.catalogFailedTitle')"
          :description="t('odontogram.nts.history.catalogFailedBody', {
            version: historicalRecord?.norm_version ?? ''
          })"
          data-testid="nts-historical-catalog-error"
        >
          <template #actions>
            <UButton
              size="xs"
              color="neutral"
              :loading="isOpeningHistorical"
              data-testid="nts-historical-catalog-retry"
              @click="retryHistorical()"
            >
              {{ t('common.retry') }}
            </UButton>
          </template>
        </UAlert>

        <!--
          Printing the record on screen.

          One control, placed immediately above the chart, because the sheet
          always prints `viewRecord` — the historical record when one is open,
          otherwise the draft, otherwise the record in force. A Print button
          in the current-record card *and* another in the draft card would be
          two controls that both print the draft whenever a draft exists.

          It shares `printAvailability` with the print root, so the button and
          the browser's own Ctrl+P can never reach different conclusions.
        -->
        <div
          class="flex justify-end"
          data-testid="nts-print-actions"
        >
          <NtsPrintAction
            :availability="printAvailability"
            :status="viewRecord?.status ?? null"
            :declarations="printDeclarationList"
          />
        </div>

        <!--
          The official dental layout, with the findings drawn on it.

          The catalog goes down with the record because a finding cannot be
          drawn from the record alone: what a mark looks like is the norm's
          business, and the norm lives in the catalog.
        -->
        <NtsOdontogramChart
          v-if="!historicalCatalogUnavailable"
          :record="chartRecord"
          :catalog="viewCatalog"
          :readonly="chartReadonly"
          :selectable="chartSelectable"
          :selected-teeth="selectedTeeth"
          :anchor-teeth="editor.selection.value.anchors"
          @tooth-select="(fdi, rowOrder) => editor.pickTooth(fdi, rowOrder)"
          @overflow="hiddenSiglas = $event"
        />

        <!--
          The annex's two text blocks, in the annex's own order: the chart,
          then Especificaciones, then Observaciones. 05F prints from this DOM,
          so the order is part of the contract rather than a layout choice.

          Full width under the chart on every viewport. A sidebar would take
          width from a drawing that already scrolls horizontally on a phone.
        -->
        <NtsSpecificationsPanel
          ref="specificationsPanel"
          :specifications="specifications"
          :findings="chartRecord?.findings ?? []"
          :editable="isTextEditable"
          :saving="isWriting"
          :hidden-siglas="hiddenSiglas"
          @update:dirty="textDirty.specifications = $event"
          @create="submitNewSpecification"
          @update="submitSpecificationEdit"
          @remove="submitSpecificationRemoval"
        />

        <NtsObservationsPanel
          ref="observationsPanel"
          :observations="observations"
          :record-id="chartRecord?.id ?? null"
          :editable="isTextEditable"
          :saving="isWriting"
          @update:dirty="textDirty.observations = $event"
          @save="submitObservations"
        />

        <!--
          The text write landed; only re-reading it failed. A second banner
          rather than one shared with the finding editor, because the two have
          different retries and hiding one behind the other would leave a
          clinician pressing the wrong button.
        -->
        <UAlert
          v-if="textRefreshFailed"
          color="warning"
          variant="subtle"
          icon="i-lucide-refresh-cw"
          :title="t('odontogram.nts.text.refreshFailedTitle')"
          :description="t('odontogram.nts.text.refreshFailedBody')"
          data-testid="nts-text-refresh-failed"
        >
          <template #actions>
            <UButton
              size="xs"
              color="neutral"
              :loading="isRefreshing"
              data-testid="nts-text-refresh-retry"
              @click="retryTextRefresh()"
            >
              {{ t('odontogram.nts.editor.refreshRetry') }}
            </UButton>
          </template>
        </UAlert>

        <!-- The change is on the server; only re-reading it failed. Saying
             "not saved" here would invite sending the same finding twice. -->
        <UAlert
          v-if="editor.refreshFailed.value"
          color="warning"
          variant="subtle"
          icon="i-lucide-refresh-cw"
          :title="t('odontogram.nts.editor.refreshFailedTitle')"
          :description="t('odontogram.nts.editor.refreshFailedBody')"
          data-testid="nts-refresh-failed"
        >
          <template #actions>
            <UButton
              size="xs"
              color="neutral"
              :loading="editor.isSaving.value"
              data-testid="nts-refresh-retry"
              @click="editor.retryRefresh()"
            >
              {{ t('odontogram.nts.editor.refreshRetry') }}
            </UButton>
          </template>
        </UAlert>

        <!-- Half of a two-step edit reached the server. Never "saved
             successfully", and never undone behind the clinician's back. -->
        <UAlert
          v-if="editor.partialUpdate.value"
          color="warning"
          variant="subtle"
          icon="i-lucide-triangle-alert"
          :title="t('odontogram.nts.editor.partialTitle')"
          :description="t('odontogram.nts.editor.partialBody')"
          :close="true"
          data-testid="nts-partial-update"
          @update:open="editor.dismissPartialUpdate()"
        />

        <!-- Structured capture. Only a draft is editable; a finalized record
             is a locked clinical document and is shown read-only. -->
        <div
          v-if="editor.isOpen.value"
          data-testid="nts-editor-panel"
        >
          <NtsFindingEditor
            :rules="catalog?.rules ?? []"
            :rule="editor.rule.value"
            :is-creating="editor.isCreating.value"
            :attributes="editor.attributes.value"
            :selection="editor.selection.value"
            :pick-mode="editor.pickMode.value"
            :problems="editor.problems.value"
            :missing-attributes="editor.missingAttributes.value"
            :specification-requirements="editor.specificationRequirements.value"
            :can-save="editor.canSave.value"
            :is-saving="editor.isSaving.value"
            :clinical-errors="editor.clinicalErrors.value"
            @select-rule="editor.selectRule"
            @update:attributes="editor.attributes.value = $event"
            @retarget-subject="editor.startRetargetSubject"
            @retarget-anchors="editor.startRetargetAnchors"
            @stop-retarget="editor.stopRetarget"
            @toggle-arch="editor.toggleArch"
            @set-role="(tooth, role) => editor.setRole(tooth, role)"
            @save="saveEditor"
            @cancel="editor.close"
          />
        </div>

        <div
          v-else-if="editor.canEdit.value"
          class="flex justify-end"
        >
          <UButton
            icon="i-lucide-plus"
            size="sm"
            :disabled="isWriting"
            data-testid="nts-add-finding"
            @click="editor.startCreate"
          >
            {{ t('odontogram.nts.editor.addFinding') }}
          </UButton>
        </div>

        <NtsFindingList
          v-if="chartRecord"
          :findings="chartRecord.findings"
          :rules="viewCatalog?.rules ?? []"
          :readonly="!editor.canEdit.value"
          :busy-id="editor.isSaving.value ? editor.editing.value : null"
          :writing="isWriting"
          @edit="editor.startEdit"
          @confirm="editor.confirmFinding"
          @remove="removing = $event"
        />

        <!--
          The patient's odontograms. §5.10 and §5.11 mean a patient
          accumulates them, and each one is read under the norm it was
          written in — which is why the selector, not the shell, is where a
          foreign norm version is surfaced.
        -->
        <NtsRecordHistory
          v-if="history.length > 0"
          :records="history"
          :open-id="historicalId"
          :current-id="(draft ?? currentRecord)?.id ?? null"
          :loading="isOpeningHistorical"
          :profile-norm-version="normVersion"
          @open="requestHistorical"
          @return-to-current="requestCurrent"
        />
      </template>
    </template>

    <!-- Create draft -->
    <UModal
      v-model:open="createOpen"
      :title="t('odontogram.nts.actions.createDraft')"
    >
      <template #body>
        <div class="space-y-3">
          <UFormField :label="t('odontogram.nts.field.stage')">
            <USelect
              v-model="createStage"
              :items="STAGES.map(s => ({ label: t(`odontogram.nts.stage.${s}`), value: s }))"
              data-testid="nts-create-stage"
            />
          </UFormField>
          <UFormField
            v-if="createStage === 'other'"
            :label="t('odontogram.nts.field.stageLabel')"
          >
            <UInput
              v-model="createStageLabel"
              data-testid="nts-create-stage-label"
            />
          </UFormField>
          <p class="text-caption text-subtle">
            {{ t('odontogram.nts.create.hint') }}
          </p>
        </div>
      </template>
      <template #footer>
        <div class="flex justify-end gap-2 w-full">
          <UButton
            color="neutral"
            variant="ghost"
            @click="createOpen = false"
          >
            {{ t('common.cancel') }}
          </UButton>
          <UButton
            :loading="isMutating"
            :disabled="!canSubmitCreate"
            data-testid="nts-create-submit"
            @click="submitCreate()"
          >
            {{ t('odontogram.nts.actions.createDraft') }}
          </UButton>
        </div>
      </template>
    </UModal>

    <!-- Discard draft: discarded, never deleted -->
    <UModal
      v-model:open="discardOpen"
      :title="t('odontogram.nts.actions.discardDraft')"
    >
      <template #body>
        <div class="space-y-3">
          <p class="text-sm">
            {{ t('odontogram.nts.discard.explanation') }}
          </p>
          <UFormField :label="t('odontogram.nts.field.discardReason')">
            <UInput
              v-model="discardReason"
              data-testid="nts-discard-reason"
            />
          </UFormField>
        </div>
      </template>
      <template #footer>
        <div class="flex justify-end gap-2 w-full">
          <UButton
            color="neutral"
            variant="ghost"
            @click="discardOpen = false"
          >
            {{ t('common.cancel') }}
          </UButton>
          <UButton
            color="warning"
            :loading="isMutating"
            :disabled="!canSubmitDiscard"
            data-testid="nts-discard-submit"
            @click="submitDiscard()"
          >
            {{ t('odontogram.nts.actions.discardDraft') }}
          </UButton>
        </div>
      </template>
    </UModal>

    <!--
      Navigation away from unsaved text. Not a save prompt: there is no
      autosave here and offering one would blur what "saved" means on a
      clinical record. The choice is to discard and continue, or to stay.
    -->
    <UModal
      :open="pendingNavigation !== null"
      :title="t('odontogram.nts.unsaved.title')"
      data-testid="nts-unsaved-dialog"
      @update:open="$event || (pendingNavigation = null)"
    >
      <template #body>
        <p class="text-sm">
          {{ t('odontogram.nts.unsaved.body') }}
        </p>
      </template>
      <template #footer>
        <div class="flex justify-end gap-2 w-full">
          <UButton
            color="neutral"
            variant="ghost"
            data-testid="nts-unsaved-stay"
            @click="pendingNavigation = null"
          >
            {{ t('odontogram.nts.unsaved.stay') }}
          </UButton>
          <UButton
            color="warning"
            data-testid="nts-unsaved-discard"
            @click="confirmNavigation()"
          >
            {{ t('odontogram.nts.unsaved.discard') }}
          </UButton>
        </div>
      </template>
    </UModal>

    <!-- Withdraw a finding. Not "delete permanently": the record keeps its
         audit trail, and the wording must not promise otherwise. -->
    <UModal
      :open="removing !== null"
      :title="t('odontogram.nts.editor.removeFinding')"
      @update:open="$event || (removing = null)"
    >
      <template #body>
        <p class="text-sm">
          {{ t('odontogram.nts.editor.removeExplanation') }}
        </p>
      </template>
      <template #footer>
        <div class="flex justify-end gap-2 w-full">
          <UButton
            color="neutral"
            variant="ghost"
            @click="removing = null"
          >
            {{ t('common.cancel') }}
          </UButton>
          <UButton
            color="warning"
            :loading="editor.isSaving.value"
            data-testid="nts-remove-confirm"
            @click="confirmRemove()"
          >
            {{ t('odontogram.nts.editor.removeFinding') }}
          </UButton>
        </div>
      </template>
    </UModal>

    <!--
      The printed document.

      Teleported to `<body>` so the print stylesheet can hide every other body
      child in one rule instead of chasing individual controls. Wrapped in
      `<ClientOnly>` because a teleport that runs during SSR lands outside the
      server-rendered tree and breaks hydration — the same reason the layout
      and the patient header already use it, and no loss here since printing
      only ever happens in a live browser.

      `display: none` on screen, so it is absent from the accessibility tree:
      a second navigable copy of the whole record would be worse than no
      print view at all.
    -->
    <ClientOnly>
      <Teleport to="body">
        <div
          class="nts-print-root"
          data-testid="nts-print-root"
        >
          <NtsOdontogramPrintView
            :record="viewRecord"
            :catalog="viewCatalog"
            :patient="printPatient"
            :is-superseded="printSuperseded"
            :availability="printAvailability"
          />
        </div>
      </Teleport>
    </ClientOnly>
  </div>
</template>
