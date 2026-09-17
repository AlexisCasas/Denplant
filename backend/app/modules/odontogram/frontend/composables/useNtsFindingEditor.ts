/**
 * useNtsFindingEditor — structured capture of NTS findings (NTS-05C).
 *
 * Owns the editor's own state and its five mutations, and nothing else: the
 * record, the draft and the lifecycle stay with `useNtsOdontogramRecord`, so
 * neither composable has to know how the other keeps its state. Every write
 * ends by asking the caller to reload, because the server is the only thing
 * that knows what the record became.
 *
 * Three properties this file exists to guarantee:
 *
 * 1. **Nothing is inferred from a rule id.** Which targets a rule takes, what
 *    it requires and which roles it allows come from the catalog.
 * 2. **A conflict is never retried.** A 409 refetches and reports; it never
 *    re-sends the mutation with a bumped version.
 * 3. **Unsaved state never crosses a boundary.** Changing rule, patient or
 *    record resets the editor rather than carrying a stale target or an
 *    attribute that belongs to another rule.
 *
 * Nothing is written to localStorage: an unsaved finding is a draft of a
 * draft, and a second copy in the browser would be a second truth.
 */

import type {
  NtsApiError,
  NtsFinding,
  NtsRecord,
  NtsRule
} from '../types/nts'
import type { NtsArchCode, NtsSelectionProblem, NtsTargetSelection } from '../utils/ntsFindingModel'
import {
  activeSpecificationRequirements,
  anchorCount,
  buildTargets,
  emptySelection,
  expandRange,
  hasNumberedSubject,
  initialAttributes,
  missingRequiredAttributes,
  selectionFromTargets,
  selectionProblems,
  subjectToothCount,
  usesToothSelection
} from '../utils/ntsFindingModel'
import { toNtsApiError, useNtsApi } from './useNtsApi'

/** What the chart should let the clinician pick right now. */
export type NtsPickMode = 'none' | 'subject' | 'anchor'

/**
 * How far a multi-step mutation got before it failed.
 *
 * `appliedTo` names the finding whose first step the server accepted. It is
 * how a failure can tell "nothing happened" from "half of it happened", which
 * are two very different things to show a clinician.
 */
interface MutationProgress {
  appliedTo: string | null
}

export interface UseNtsFindingEditorOptions {
  /** The draft being edited, or null when there is nothing editable. */
  record: () => NtsRecord | null
  /** Rules the catalog served. Empty means the editor cannot open. */
  rules: () => readonly NtsRule[]
  /** Called after every successful mutation; must refetch authoritatively. */
  reload: () => Promise<void>
  /** Called when a mutation hits a 409, with the kind of conflict. */
  onConflict: (kind: 'version' | 'draft' | 'state') => Promise<void>
}

export function useNtsFindingEditor(options: UseNtsFindingEditorOptions) {
  const nts = useNtsApi()

  /** null = closed. A finding id = editing that one. 'new' = creating. */
  const editing = ref<string | null>(null)
  const rule = ref<NtsRule | null>(null)
  const attributes = ref<Record<string, unknown>>({})
  const selection = ref<NtsTargetSelection>(emptySelection())
  const pickMode = ref<NtsPickMode>('none')

  const isSaving = ref(false)
  const clinicalErrors = ref<string[]>([])
  const error = ref<NtsApiError | null>(null)
  /**
   * Set when one call of a multi-step edit reached the server and a later one
   * did not.
   *
   * Editing attributes and editing targets are two endpoints, each costing its
   * own version bump, so the first can succeed and the second fail. The record
   * has then genuinely moved and the client must not pretend otherwise: there
   * is no undo endpoint, and inventing one — a reverse PUT, a remove, a
   * re-create — would write a second clinical change to paper over the first.
   * What is owed instead is the truth: refetch, and say which half landed.
   *
   * It deliberately survives the editor closing, because a 409 closes it.
   */
  const partialUpdate = ref<{ findingId: string } | null>(null)

  const isOpen = computed(() => editing.value !== null)
  const isCreating = computed(() => editing.value === 'new')

  /**
   * An editor is only ever open over a draft. A finalized record is a locked
   * clinical document, and the chart shows it read-only.
   */
  const canEdit = computed(() => {
    const record = options.record()
    return record !== null && record.status === 'draft' && options.rules().length > 0
  })

  // --- derived requirements, all straight from the catalog ------------------

  const missingAttributes = computed(() =>
    rule.value ? missingRequiredAttributes(rule.value, attributes.value) : []
  )
  const problems = computed<NtsSelectionProblem[]>(() =>
    rule.value ? selectionProblems(rule.value, selection.value) : []
  )
  const specificationRequirements = computed(() =>
    rule.value ? activeSpecificationRequirements(rule.value, attributes.value) : []
  )
  /** Only `required` requirements block finalizing — and the server decides. */
  const blockingRequirements = computed(() =>
    specificationRequirements.value.filter(requirement => requirement.required)
  )
  const canSave = computed(
    () =>
      isOpen.value
      && rule.value !== null
      && missingAttributes.value.length === 0
      && problems.value.length === 0
      && !isSaving.value
  )

  function clearFeedback(): void {
    clinicalErrors.value = []
    error.value = null
  }

  /** Close and forget. Nothing survives: not the rule, not a target, not an id. */
  function close(): void {
    editing.value = null
    rule.value = null
    attributes.value = {}
    selection.value = emptySelection()
    pickMode.value = 'none'
    clearFeedback()
  }

  function defaultPickMode(next: NtsRule): NtsPickMode {
    if (usesToothSelection(next)) return 'subject'
    // A rule whose subject has no FDI is positioned by its anchors.
    if (anchorCount(next) > 0) return 'anchor'
    return 'none'
  }

  /**
   * Choose the rule for a new finding.
   *
   * Switching rule resets attributes, targets and roles wholesale rather than
   * keeping whatever happens to still typecheck: an attribute of rule A is
   * not an attribute of rule B, and a target picked for a pair is not a
   * target for an arch.
   */
  function selectRule(next: NtsRule): void {
    rule.value = next
    attributes.value = initialAttributes(next)
    selection.value = emptySelection()
    pickMode.value = defaultPickMode(next)
    clearFeedback()
  }

  function startCreate(): void {
    close()
    editing.value = 'new'
  }

  /** Open an existing finding, pre-filled from what the server stored. */
  function startEdit(finding: NtsFinding): void {
    const found = options.rules().find(r => r.rule_id === finding.rule_id) ?? null
    close()
    editing.value = finding.id
    rule.value = found
    attributes.value = { ...finding.attributes }
    selection.value = selectionFromTargets(finding.targets)
    pickMode.value = 'none'
  }

  // --- chart selection ------------------------------------------------------

  function dismissPartialUpdate(): void {
    partialUpdate.value = null
  }

  function setPickMode(mode: NtsPickMode): void {
    pickMode.value = mode
  }

  function toggleArch(arch: NtsArchCode): void {
    const arches = selection.value.arches
    selection.value = {
      ...selection.value,
      arches: arches.includes(arch) ? arches.filter(a => a !== arch) : [...arches, arch]
    }
  }

  function setRole(tooth: number, role: string | null): void {
    const roles = { ...selection.value.roles }
    if (role) roles[tooth] = role
    else delete roles[tooth]
    selection.value = { ...selection.value, roles }
  }

  /**
   * Handle a click on a tooth.
   *
   * `rowOrder` is the row as the chart draws it, which is what makes a range
   * the slice between two endpoints rather than a numeric interval — 18 → 28
   * is contiguous on screen and not in FDI arithmetic.
   */
  function pickTooth(tooth: number, rowOrder: readonly number[]): void {
    const current = rule.value
    if (!current || pickMode.value === 'none') return
    clearFeedback()

    if (pickMode.value === 'anchor') {
      const anchors = selection.value.anchors
      const limit = anchorCount(current)
      const next = anchors.includes(tooth)
        ? anchors.filter(t => t !== tooth)
        : [...anchors, tooth].slice(-Math.max(limit, 1))
      selection.value = { ...selection.value, anchors: next }
      return
    }

    if (!hasNumberedSubject(current)) return

    const teeth = selection.value.teeth
    const roles = { ...selection.value.roles }

    if (teeth.includes(tooth)) {
      delete roles[tooth]
      selection.value = { ...selection.value, teeth: teeth.filter(t => t !== tooth), roles }
      return
    }

    if (current.scope === 'range') {
      // First click sets the start; the second completes the span.
      const start = teeth.length === 1 ? teeth[0]! : tooth
      const next = teeth.length === 1 ? expandRange(rowOrder, start, tooth) : [tooth]
      selection.value = { ...selection.value, teeth: next, roles: {} }
      return
    }

    const limit = subjectToothCount(current)
    // At the limit a new pick replaces the oldest, so the chart never gets
    // stuck refusing clicks with no way to tell the user why.
    const next = limit === null ? [...teeth, tooth] : [...teeth, tooth].slice(-limit)
    selection.value = { ...selection.value, teeth: next, roles }
  }

  // --- mutations ------------------------------------------------------------

  function conflictKind(failure: NtsApiError) {
    if (failure.code === 'nts_version_conflict') return 'version' as const
    if (failure.code === 'nts_draft_conflict') return 'draft' as const
    if (failure.code === 'nts_state_conflict') return 'state' as const
    return null
  }

  /**
   * Run one mutation.
   *
   * On a 409 the editor closes: its `expected_version` and quite possibly its
   * finding are stale, so keeping the form open would invite the clinician to
   * press save again against a record that has moved.
   */
  async function run<T>(
    mutate: (record: NtsRecord, progress: MutationProgress) => Promise<T>
  ): Promise<boolean> {
    const record = options.record()
    if (!record) return false

    const progress: MutationProgress = { appliedTo: null }
    isSaving.value = true
    clearFeedback()
    partialUpdate.value = null

    try {
      await mutate(record, progress)
      await options.reload()
      return true
    } catch (raw) {
      const failure = toNtsApiError(raw)
      const kind = conflictKind(failure)

      // Something already reached the server, so the record has moved whatever
      // happens next. The failed call is not retried and the applied one is
      // not undone; the user is told which half landed.
      if (progress.appliedTo !== null) {
        partialUpdate.value = { findingId: progress.appliedTo }
      }

      if (kind) {
        close()
        // The conflict policy refetches; there is no second reload here.
        await options.onConflict(kind)
        return false
      }

      // A conflict-free failure does not refetch on its own, so a partially
      // applied edit has to ask for one: the screen must never keep showing a
      // draft the server has already left behind.
      if (progress.appliedTo !== null) await options.reload()

      if (failure.code === 'nts_clinical_validation' || failure.status === 422) {
        clinicalErrors.value = failure.errors
      } else {
        error.value = failure
      }
      return false
    } finally {
      isSaving.value = false
    }
  }

  /** Create the finding and its targets in one request. */
  async function createFinding(): Promise<boolean> {
    const current = rule.value
    if (!current || !canSave.value) return false

    const ok = await run(record =>
      nts.createFinding(record.id, {
        expected_version: record.version,
        rule_id: current.rule_id,
        attributes: attributes.value,
        targets: buildTargets(current, selection.value)
      })
    )
    if (ok) close()
    return ok
  }

  /**
   * Save an edited finding.
   *
   * Attributes and targets are separate endpoints, each costing its own
   * version bump, so the second call uses the version the first one reported
   * rather than the version the editor opened with. Targets are only touched
   * when they actually changed — editing a note should not rewrite a target
   * set that a colleague may have corrected meanwhile.
   */
  async function saveFinding(original: NtsFinding): Promise<boolean> {
    const current = rule.value
    if (!current || !canSave.value || editing.value === null) return false

    const nextTargets = buildTargets(current, selection.value)
    const targetsChanged
      = JSON.stringify(nextTargets) !== JSON.stringify(buildTargets(current, selectionFromTargets(original.targets)))

    const ok = await run(async (record, progress) => {
      const result = await nts.replaceFindingAttributes(record.id, original.id, {
        expected_version: record.version,
        attributes: attributes.value
      })
      if (targetsChanged) {
        // From here the attributes are persisted and the record has moved. The
        // second call uses the version the first reported, never the one the
        // editor opened with.
        progress.appliedTo = original.id
        await nts.replaceFindingTargets(record.id, original.id, {
          expected_version: result.record_version,
          targets: nextTargets
        })
      }
    })
    if (ok) close()
    return ok
  }

  /** Confirm one carried-forward finding. Never in bulk. */
  async function confirmFinding(finding: NtsFinding): Promise<boolean> {
    return await run(record =>
      nts.confirmFinding(record.id, finding.id, { expected_version: record.version })
    )
  }

  /** Withdraw a finding from the draft. The API takes no reason. */
  async function removeFinding(finding: NtsFinding): Promise<boolean> {
    const ok = await run(record =>
      nts.removeFinding(record.id, finding.id, { expected_version: record.version })
    )
    if (ok && editing.value === finding.id) close()
    return ok
  }

  /**
   * Reset when the ground moves.
   *
   * A record id change means a different patient, a different norm or a
   * different draft; none of the editor's state — rule, targets, attributes,
   * finding id, version — is valid across that boundary.
   */
  watch(
    () => options.record()?.id ?? null,
    (next, previous) => {
      if (next !== previous) close()
    }
  )

  return {
    // state
    editing,
    rule,
    attributes,
    selection,
    pickMode,
    isSaving,
    clinicalErrors,
    error,
    partialUpdate,

    // derived
    isOpen,
    isCreating,
    canEdit,
    canSave,
    missingAttributes,
    problems,
    specificationRequirements,
    blockingRequirements,

    // editor
    startCreate,
    startEdit,
    selectRule,
    close,
    setPickMode,
    pickTooth,
    toggleArch,
    setRole,

    dismissPartialUpdate,

    // mutations
    createFinding,
    saveFinding,
    confirmFinding,
    removeFinding
  }
}
