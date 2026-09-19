/**
 * useNtsOdontogramRecord — lifecycle state for the MINSA odontogram (NTS-05A).
 *
 * Owns the catalog, the current finalized record, the open draft and the
 * record history, plus the three lifecycle operations 05A exposes: create an
 * empty draft, finalize, discard. Finding/target/specification editing
 * belongs to later tickets and is deliberately absent.
 *
 * Three properties this file exists to guarantee:
 *
 * 1. **Nothing is cached across patients.** State is bound to
 *    clinic + patient + norm version, and a change to any of them clears it
 *    before the first byte of the new patient arrives.
 * 2. **A late response can never win.** Every load takes a generation token;
 *    a response whose token is stale is dropped. See `load()`.
 * 3. **A conflict is never retried silently.** A 409 refetches the
 *    authoritative state and tells the user; it never re-sends the mutation
 *    with a bumped version.
 *
 * Nothing clinical is written to localStorage: the record lives on the
 * server, and a second copy in the browser would be a second truth.
 */

import type { MaybeRefOrGetter } from 'vue'

import type {
  NtsApiError,
  NtsCatalog,
  NtsRecord,
  NtsRecordSummary,
  NtsSpecification
} from '../types/nts'
// Explicit relative import (not the layer auto-import) for the same reason as
// the components: `frontend/module_layers` does not resolve in the test
// environment, so an auto-imported `useNtsApi` would be undefined there.
import { toNtsApiError, useNtsApi } from './useNtsApi'

/** What kind of conflict the last mutation hit, if any. */
export type NtsConflictKind = 'version' | 'draft' | 'state'

export interface UseNtsOdontogramRecordOptions {
  /**
   * Reactive on purpose: a plain string would freeze the patient at setup
   * time, and the composable would then reload the *previous* patient when
   * the caller navigates — the exact bug the generation token exists to make
   * visible rather than to hide.
   */
  patientId: MaybeRefOrGetter<string>
  /**
   * The profile *is* the norm version (there is no separate mapping: a
   * record owns its `norm_version`, and the per-user profile preference only
   * decides which editor is mounted).
   */
  normVersion: MaybeRefOrGetter<string>
}

export function useNtsOdontogramRecord(options: UseNtsOdontogramRecordOptions) {
  const nts = useNtsApi()
  const { currentClinic } = useClinicState()

  const patientId = computed(() => toValue(options.patientId))
  const normVersion = computed(() => toValue(options.normVersion))

  const catalog = ref<NtsCatalog | null>(null)
  const currentRecord = ref<NtsRecord | null>(null)
  const draft = ref<NtsRecord | null>(null)
  const history = ref<NtsRecordSummary[]>([])

  const isLoading = ref(false)
  /**
   * An authoritative refetch over the *same* patient, norm and record.
   *
   * Kept apart from `isLoading` because the shell replaces its whole clinical
   * surface while `isLoading` is true. Doing that after a mutation unmounted
   * the chart, the finding editor and its select popovers mid-save and then
   * rebuilt them, which is how a successful create ended up looking like a
   * stuck button. A refresh in place keeps the DOM and swaps the data.
   */
  const isRefreshing = ref(false)
  const isMutating = ref(false)
  /** Transport/unknown failure. Clinical problems go to `clinicalErrors`. */
  const error = ref<NtsApiError | null>(null)
  /** Every problem a 422 reported, in order. Never truncated to the first. */
  const clinicalErrors = ref<string[]>([])
  const conflict = ref<NtsConflictKind | null>(null)
  /** True when the requested norm version is not one this build can serve. */
  const normUnavailable = ref(false)

  /**
   * Monotonic generation token. Incremented whenever a load starts; a
   * response carrying an older token is discarded, so switching patient
   * mid-flight can never let the previous patient's data land.
   */
  let generation = 0
  let inFlight: AbortController | null = null
  let loadedKey: string | null = null

  const stateKey = computed(
    () =>
      `${currentClinic.value?.id ?? 'no-clinic'}::${patientId.value}::${normVersion.value}`
  )

  const hasDraft = computed(() => draft.value !== null)
  const hasCurrent = computed(() => currentRecord.value !== null)
  const isEmpty = computed(
    () => !isLoading.value && !hasDraft.value && !hasCurrent.value
  )

  /**
   * Findings a previous client carried forward and nobody has reviewed.
   *
   * 05A cannot resolve them — that needs the finding editor — but it must
   * not pretend they are confirmed either, so it surfaces the count and
   * lets the backend stay the authority on whether finalize is allowed.
   */
  const pendingCarriedForward = computed(
    () =>
      draft.value?.findings.filter(f => f.provenance === 'carried_forward') ?? []
  )
  const hasPendingCarriedForward = computed(
    () => pendingCarriedForward.value.length > 0
  )

  function clearState(): void {
    catalog.value = null
    currentRecord.value = null
    draft.value = null
    history.value = []
    error.value = null
    clinicalErrors.value = []
    conflict.value = null
    normUnavailable.value = false
  }

  function applyFailure(raw: unknown): NtsApiError {
    const failure = toNtsApiError(raw)
    if (failure.code === 'nts_clinical_validation' || failure.status === 422) {
      clinicalErrors.value = failure.errors
    } else {
      error.value = failure
    }
    return failure
  }

  /**
   * Load everything the shell needs.
   *
   * The catalog gates the rest: a norm version this build cannot interpret
   * must not render a clinical shell at all, so an unknown norm short-circuits
   * instead of showing an empty chart.
   */
  async function load(options: { background?: boolean } = {}): Promise<boolean> {
    const token = ++generation
    inFlight?.abort()
    const controller = new AbortController()
    inFlight = controller

    // Clear before awaiting: the previous patient's record must not stay on
    // screen while the new one loads.
    const contextChanged = loadedKey !== stateKey.value
    if (contextChanged) clearState()
    loadedKey = stateKey.value

    // A background refresh only stays background while the context holds. A
    // different patient or norm is a real load and must show as one.
    const background = options.background === true && !contextChanged
    const busy = background ? isRefreshing : isLoading

    busy.value = true
    error.value = null
    normUnavailable.value = false

    try {
      const loadedCatalog = await nts.getCatalog(
        normVersion.value,
        controller.signal
      )
      if (token !== generation) return true
      catalog.value = loadedCatalog

      const [current, openDraft, records] = await Promise.all([
        nts.getCurrentRecord(patientId.value, normVersion.value, controller.signal),
        nts.getDraft(patientId.value, normVersion.value, controller.signal),
        nts.listRecords(patientId.value, normVersion.value, {}, controller.signal)
      ])
      if (token !== generation) return true

      currentRecord.value = current
      draft.value = openDraft
      history.value = records.data
      return true
    } catch (raw) {
      // A superseded load is not a failure: a newer one owns the outcome.
      if (token !== generation) return true
      const failure = toNtsApiError(raw)
      if (failure.code === 'nts_norm_version_unknown') {
        // Never fall back to the Original chart: that would silently record
        // under a different format than the clinician selected.
        normUnavailable.value = true
        return false
      }
      error.value = failure
      return false
    } finally {
      if (token === generation) busy.value = false
    }
  }

  /**
   * Re-read the authoritative state, keeping any conflict notice visible.
   *
   * In place: the surface stays mounted, which is what a refresh after a
   * mutation needs. Only a context change tears anything down.
   */
  async function reload(): Promise<boolean> {
    return await load({ background: true })
  }

  /**
   * Refetch after a conflict and record which kind it was.
   *
   * Never re-sends the mutation: the user has to see what the other session
   * did before deciding again.
   */
  async function recoverFromConflict(kind: NtsConflictKind): Promise<void> {
    await load()
    conflict.value = kind
  }

  function conflictKind(failure: NtsApiError): NtsConflictKind | null {
    if (failure.code === 'nts_version_conflict') return 'version'
    if (failure.code === 'nts_draft_conflict') return 'draft'
    if (failure.code === 'nts_state_conflict') return 'state'
    return null
  }

  function beginMutation(): void {
    isMutating.value = true
    error.value = null
    clinicalErrors.value = []
    conflict.value = null
  }

  /** Open an empty draft. 05A never offers `carry_forward`. */
  async function createDraft(input: {
    stage: string
    stageLabel?: string | null
  }): Promise<boolean> {
    beginMutation()
    try {
      const created = await nts.createDraft(patientId.value, {
        norm_version: normVersion.value,
        stage: input.stage,
        stage_label: input.stageLabel ?? null,
        seed: 'empty'
      })
      draft.value = created
      await load()
      return true
    } catch (raw) {
      const failure = applyFailure(raw)
      const kind = conflictKind(failure)
      if (kind) {
        // A draft already exists — show it rather than a dead-end error.
        await recoverFromConflict(kind)
      }
      return false
    } finally {
      isMutating.value = false
    }
  }

  /**
   * Finalize the open draft.
   *
   * `expected_version` always comes from the loaded draft, never from
   * arithmetic, and the new state always comes from a refetch rather than
   * from assuming `version + 1`.
   */
  async function finalizeDraft(): Promise<boolean> {
    const open = draft.value
    if (!open) return false

    beginMutation()
    try {
      await nts.finalize(open.id, { expected_version: open.version })
      await load()
      return true
    } catch (raw) {
      const failure = applyFailure(raw)
      const kind = conflictKind(failure)
      if (kind) await recoverFromConflict(kind)
      return false
    } finally {
      isMutating.value = false
    }
  }

  /** Discard the open draft. Nothing is deleted; a reason is required. */
  async function discardDraft(reason: string): Promise<boolean> {
    const open = draft.value
    if (!open || !reason.trim()) return false

    beginMutation()
    try {
      await nts.discard(open.id, {
        expected_version: open.version,
        reason: reason.trim()
      })
      await load()
      return true
    } catch (raw) {
      const failure = applyFailure(raw)
      const kind = conflictKind(failure)
      if (kind) await recoverFromConflict(kind)
      return false
    } finally {
      isMutating.value = false
    }
  }

  // ------------------------------------------------------------------------
  // NTS-05E.1 — Especificaciones (§5.14) and Observaciones (§5.15)
  // ------------------------------------------------------------------------

  /**
   * The record these two fields belong to.
   *
   * The draft when one is open, because that is the only record the server
   * will accept a write for; otherwise the finalized record in force, so its
   * text can still be read. 05E.3 introduces a record *in view* — a historical
   * one, always read-only — and this follows it then rather than now.
   */
  const textRecord = computed<NtsRecord | null>(() => draft.value ?? currentRecord.value)

  /**
   * Whether the text can be changed at all.
   *
   * A convenience for the UI, never a defence: the server refuses a write to
   * anything but a draft in the same statement that checks the version, so a
   * client that got this wrong would be rejected rather than obeyed.
   */
  const isTextEditable = computed(() => draft.value !== null)

  /** §5.15. Free text on the record — never a finding, a plan or a treatment. */
  const observations = computed(() => textRecord.value?.observations ?? null)

  /**
   * §5.14, in the server's own order.
   *
   * Sorted by `sequence`, which the server owns and returns. Never by id and
   * never alphabetically: the clinician wrote these in an order, and an
   * odontogram that reorders what someone recorded is editing it.
   */
  const specifications = computed<NtsSpecification[]>(() =>
    [...(textRecord.value?.specifications ?? [])].sort((a, b) => a.sequence - b.sequence)
  )

  /**
   * A refetch after one of these mutations failed on its own.
   *
   * Kept apart from `error` for the reason 05C established: once the server
   * has accepted a change, nothing that goes wrong afterwards may be shown as
   * if the change was lost.
   */
  const refreshFailed = ref(false)

  /** Re-read after a refresh failure. A GET, and only a GET. */
  async function retryRefresh(): Promise<boolean> {
    refreshFailed.value = false
    const ok = await reload()
    refreshFailed.value = !ok
    return ok
  }

  /**
   * Run one text mutation, then refresh — as two separate phases.
   *
   * Up to `await mutate` a failure means the server rejected the change.
   * After it, the change is applied and anything that goes wrong is a display
   * problem: the mutation is never re-sent, and `refreshFailed` says so
   * instead of `error`.
   *
   * No optimistic write. Nothing local changes until the server has answered,
   * so there is no rollback to get wrong — and the new version comes from the
   * refetch rather than from `expected_version + 1`, which is what keeps two
   * mutations in a row from both claiming the same version.
   */
  async function runTextMutation(
    mutate: (record: NtsRecord) => Promise<unknown>
  ): Promise<boolean> {
    const record = draft.value
    if (!record) return false

    beginMutation()
    refreshFailed.value = false
    try {
      await mutate(record)
    } catch (raw) {
      const failure = applyFailure(raw)
      const kind = conflictKind(failure)
      // The conflict policy refetches on its own; the mutation is not retried
      // and whatever the caller was editing stays with the caller.
      if (kind) await recoverFromConflict(kind)
      return false
    } finally {
      isMutating.value = false
    }

    refreshFailed.value = (await reload()) === false
    return true
  }

  /**
   * Save *Observaciones*.
   *
   * Sends only that key, so the two other editable fields keep the value they
   * have: an absent key means "leave it alone", and a null would clear it.
   * `null` here is a deliberate clear, which is why the parameter accepts it.
   */
  async function saveObservations(text: string | null): Promise<boolean> {
    return await runTextMutation(record =>
      nts.updateMetadata(record.id, {
        expected_version: record.version,
        observations: text
      })
    )
  }

  /**
   * Add an *Especificaciones* entry.
   *
   * `findingId` is optional and never inferred. The norm asks for what did
   * not fit in the boxes, not for a row per finding, so a general entry is
   * legitimate; 05E.2 may *offer* an association, and will not require one.
   */
  async function addSpecification(
    text: string,
    findingId: string | null = null
  ): Promise<boolean> {
    return await runTextMutation(record =>
      nts.createSpecification(record.id, {
        expected_version: record.version,
        text,
        finding_id: findingId
      })
    )
  }

  /** Replace one entry. Its id never changes; `findingId` is always stated. */
  async function editSpecification(
    specificationId: string,
    text: string,
    findingId: string | null
  ): Promise<boolean> {
    return await runTextMutation(record =>
      nts.updateSpecification(record.id, specificationId, {
        expected_version: record.version,
        text,
        finding_id: findingId
      })
    )
  }

  /** Withdraw one entry. The server renumbers what is left; this does not. */
  async function removeSpecification(specificationId: string): Promise<boolean> {
    return await runTextMutation(record =>
      nts.removeSpecification(record.id, specificationId, {
        expected_version: record.version
      })
    )
  }

  function dismissConflict(): void {
    conflict.value = null
  }

  return {
    // state
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

    // derived
    hasDraft,
    hasCurrent,
    isEmpty,
    pendingCarriedForward,
    hasPendingCarriedForward,
    stateKey,

    // actions
    textRecord,
    isTextEditable,
    observations,
    specifications,
    refreshFailed,

    load,
    reload,
    retryRefresh,
    /** Exposed so the finding editor shares one conflict policy, not two. */
    recoverFromConflict,
    createDraft,
    finalizeDraft,
    discardDraft,
    saveObservations,
    addSpecification,
    editSpecification,
    removeSpecification,
    dismissConflict
  }
}
