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
  /**
   * One write at a time, for the **whole record** — not per editor.
   *
   * Every mutation in this module bumps the same `version`: findings,
   * targets, specifications, observations, carry-forward confirmation,
   * finalize, discard. Each editor used to guard only itself, which left a
   * real gap: saving observations and confirming a carried-forward finding
   * are different components with different busy flags, so both read the
   * loaded record and both sent `expected_version: N`. The second one 409s,
   * and the clinician loses an action they were entitled to make.
   *
   * Held across the refetch as well as the request, because the loaded record
   * still carries the old version until the refresh lands.
   */
  const isWriting = ref(false)

  /** Take the record-wide write lock, or report that someone else has it. */
  function beginWrite(): boolean {
    if (isWriting.value) return false
    isWriting.value = true
    return true
  }

  function endWrite(): void {
    isWriting.value = false
  }
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

  /**
   * Catalogs by norm version, for the life of this composable.
   *
   * Keyed by the version string and by nothing else — never by profile, which
   * is a preference about what to *create* next and says nothing about how an
   * existing record must be read. Two records under the same norm share one
   * download; switching between them re-downloads nothing.
   */
  const catalogs = new Map<string, NtsCatalog>()

  /**
   * The catalog a record must be read under.
   *
   * There is no fallback. If this version cannot be served, the caller gets an
   * error and draws nothing: interpreting a finding under a norm it was not
   * recorded in would put marks on a chart that the record does not contain,
   * which is a fabricated clinical statement rather than a degraded view.
   */
  async function catalogFor(
    version: string,
    signal?: AbortSignal
  ): Promise<NtsCatalog> {
    const cached = catalogs.get(version)
    if (cached) return cached

    const loaded = await nts.getCatalog(version, signal)
    catalogs.set(version, loaded)
    return loaded
  }

  function clearState(): void {
    clearHistorical()
    mode.value = 'current'
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
      // The profile's catalog still gates the clinical reads: a norm this
      // build cannot interpret must not reach a patient's record at all.
      const profileCatalog = await catalogFor(normVersion.value, controller.signal)
      if (token !== generation) return true

      const [current, openDraft, records] = await Promise.all([
        nts.getCurrentRecord(patientId.value, normVersion.value, controller.signal),
        nts.getDraft(patientId.value, normVersion.value, controller.signal),
        // No `norm_version` filter: the history is the patient's clinical
        // history, and a record written under an earlier norm does not stop
        // existing because the clinic moved to a later one. The filter used to
        // be here, and it was quietly doing double duty as a correctness
        // guarantee — every listed record happened to match the loaded
        // catalog. 05E.3 makes that guarantee explicit instead, by resolving
        // each record's catalog from the record itself.
        nts.listRecords(patientId.value, null, {}, controller.signal)
      ])
      if (token !== generation) return true

      // A record in hand decides which norm it is read under; the profile only
      // decides which norm a *new* record would be created in. They agree in
      // every ordinary case, and `catalogFor` caches, so this costs a second
      // request only when they genuinely differ — which is precisely the case
      // that used to be read under the wrong norm.
      const recordVersion = (openDraft ?? current)?.norm_version
      const loadedCatalog = recordVersion && recordVersion !== normVersion.value
        ? await catalogFor(recordVersion, controller.signal)
        : profileCatalog
      if (token !== generation) return true

      catalog.value = loadedCatalog
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
    // In place, like every other post-mutation refetch. A foreground load here
    // swapped the whole clinical surface for a spinner and rebuilt it, which
    // took any unsaved text down with it — the worst possible answer to a
    // conflict, since the clinician's own words are exactly what they need to
    // decide what to do next. The conflict alert already says what happened;
    // a full-surface reload adds nothing but destruction.
    await load({ background: true })
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
    if (!beginWrite()) return false
    beginMutation()
    try {
      const created = await nts.createDraft(patientId.value, {
        norm_version: normVersion.value,
        stage: input.stage,
        stage_label: input.stageLabel ?? null,
        seed: 'empty'
      })
      draft.value = created
      await load({ background: true })
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
      endWrite()
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
    if (!open || !beginWrite()) return false

    beginMutation()
    try {
      await nts.finalize(open.id, { expected_version: open.version })
      // In place: finalizing does not need the clinical surface taken down
      // and rebuilt, and doing so would discard anything unsaved around it.
      await load({ background: true })
      return true
    } catch (raw) {
      const failure = applyFailure(raw)
      const kind = conflictKind(failure)
      if (kind) await recoverFromConflict(kind)
      return false
    } finally {
      isMutating.value = false
      endWrite()
    }
  }

  /** Discard the open draft. Nothing is deleted; a reason is required. */
  async function discardDraft(reason: string): Promise<boolean> {
    const open = draft.value
    if (!open || !reason.trim() || !beginWrite()) return false

    beginMutation()
    try {
      await nts.discard(open.id, {
        expected_version: open.version,
        reason: reason.trim()
      })
      await load({ background: true })
      return true
    } catch (raw) {
      const failure = applyFailure(raw)
      const kind = conflictKind(failure)
      if (kind) await recoverFromConflict(kind)
      return false
    } finally {
      isMutating.value = false
      endWrite()
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
  const textRecord = computed<NtsRecord | null>(() => viewRecord.value)

  /**
   * Whether the text can be changed at all.
   *
   * A convenience for the UI, never a defence: the server refuses a write to
   * anything but a draft in the same statement that checks the version, so a
   * client that got this wrong would be rejected rather than obeyed.
   */
  const isTextEditable = computed(() => !isHistorical.value && draft.value !== null)

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

  /**
   * One lock over both text mutations, held across the refetch too.
   *
   * `isMutating` drops as soon as the server answers, which is right for a
   * spinner but wrong for a lock: between that moment and the end of the
   * refetch the loaded record still carries the *old* version, so a second
   * write started there would send a version the server has already left
   * behind. Holding until the refresh lands means the next write reads the
   * version the last one produced.
   */
  const isSavingText = ref(false)

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
    // A historical view is inspection: the server would refuse the write
    // anyway, but the client must not ask.
    if (!record || isHistorical.value) return false
    // Someone else — this panel or the finding editor — is mid-write, and the
    // loaded version is about to be replaced.
    if (!beginWrite()) return false

    beginMutation()
    isSavingText.value = true
    refreshFailed.value = false
    try {
      try {
        await mutate(record)
      } catch (raw) {
        const failure = applyFailure(raw)
        const kind = conflictKind(failure)
        // The conflict policy refetches on its own; the mutation is not
        // retried and whatever the caller was editing stays with the caller.
        if (kind) await recoverFromConflict(kind)
        return false
      } finally {
        isMutating.value = false
      }

      refreshFailed.value = (await reload()) === false
      return true
    } finally {
      isSavingText.value = false
      endWrite()
    }
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

  // ------------------------------------------------------------------------
  // NTS-05E.3 — opening a record from the history
  // ------------------------------------------------------------------------

  /**
   * Which record the shell is showing.
   *
   * An explicit mode rather than a guess from `status`. The record in force is
   * routinely finalized and is still the *current* one, so "finalized" cannot
   * mean "historical" — and a clinician needs to know which of the two they
   * are looking at before they trust an empty action bar.
   */
  const mode = ref<'current' | 'historical'>('current')

  /** The opened record and the catalog it must be read under. Always a pair. */
  const historicalRecord = ref<NtsRecord | null>(null)
  const historicalCatalog = ref<NtsCatalog | null>(null)
  const historicalId = ref<string | null>(null)

  const isOpeningHistorical = ref(false)
  /** The record itself could not be read. */
  const historicalError = ref<NtsApiError | null>(null)
  /** The record was read; the norm it was written under could not be served. */
  const historicalCatalogUnavailable = ref(false)

  /**
   * Its own generation, separate from `load()`'s.
   *
   * Opening B while A is still in flight must end on B, and A's late response
   * must not install itself — neither its record nor its catalog. Both are
   * checked against the same token, so a record can never be paired with a
   * catalog fetched for a different one.
   */
  let historicalGeneration = 0
  let historicalInFlight: AbortController | null = null

  function clearHistorical(): void {
    historicalInFlight?.abort()
    historicalInFlight = null
    historicalGeneration += 1
    historicalRecord.value = null
    historicalCatalog.value = null
    historicalId.value = null
    historicalError.value = null
    historicalCatalogUnavailable.value = false
    isOpeningHistorical.value = false
  }

  /**
   * Open a record from the history, read-only.
   *
   * Nothing is shown until the record *and* its catalog are both in hand:
   * a chart drawn from one record's findings and another norm's rules is not
   * a partial view, it is a wrong one.
   */
  async function openHistorical(recordId: string): Promise<boolean> {
    const token = ++historicalGeneration
    historicalInFlight?.abort()
    const controller = new AbortController()
    historicalInFlight = controller

    historicalId.value = recordId
    historicalError.value = null
    historicalCatalogUnavailable.value = false
    isOpeningHistorical.value = true
    mode.value = 'historical'

    try {
      const opened = await nts.getRecord(recordId, controller.signal)
      if (token !== historicalGeneration) return false

      let openedCatalog: NtsCatalog
      try {
        openedCatalog = await catalogFor(opened.norm_version, controller.signal)
      } catch {
        if (token !== historicalGeneration) return false
        // The record is readable; the norm it cites is not. Its dates and
        // status can still be shown, but nothing on the chart may be drawn
        // from another norm's rules.
        historicalRecord.value = opened
        historicalCatalog.value = null
        historicalCatalogUnavailable.value = true
        return false
      }
      if (token !== historicalGeneration) return false

      // Installed together, so the two can never disagree.
      historicalRecord.value = opened
      historicalCatalog.value = openedCatalog
      return true
    } catch (raw) {
      if (token !== historicalGeneration) return false
      // The current record is untouched: a failed history read must not cost
      // the clinician the odontogram they already had open.
      historicalError.value = toNtsApiError(raw)
      historicalRecord.value = null
      historicalCatalog.value = null
      return false
    } finally {
      if (token === historicalGeneration) isOpeningHistorical.value = false
    }
  }

  /** Re-read the opened record. A GET, and only a GET. */
  async function retryHistorical(): Promise<boolean> {
    const recordId = historicalId.value
    return recordId ? await openHistorical(recordId) : false
  }

  /** Back to the record in force, with nothing of the historical left behind. */
  function returnToCurrent(): void {
    clearHistorical()
    mode.value = 'current'
  }

  const isHistorical = computed(() => mode.value === 'historical')

  /**
   * What the chart draws, and the norm it is drawn under.
   *
   * One pair for both modes, so there is a single answer to "which catalog"
   * rather than one rule for the current record and another for a historical
   * one. A historical view draws nothing while its catalog is missing.
   */
  const viewRecord = computed<NtsRecord | null>(() =>
    isHistorical.value ? historicalRecord.value : (draft.value ?? currentRecord.value)
  )
  const viewCatalog = computed<NtsCatalog | null>(() =>
    isHistorical.value ? historicalCatalog.value : catalog.value
  )

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
    mode,
    isHistorical,
    historicalRecord,
    historicalCatalog,
    historicalId,
    historicalError,
    historicalCatalogUnavailable,
    isOpeningHistorical,
    viewRecord,
    viewCatalog,
    catalogFor,
    observations,
    specifications,
    refreshFailed,
    isSavingText,
    isWriting,
    beginWrite,
    endWrite,

    load,
    reload,
    retryRefresh,
    /** Exposed so the finding editor shares one conflict policy, not two. */
    recoverFromConflict,
    createDraft,
    finalizeDraft,
    discardDraft,
    openHistorical,
    retryHistorical,
    returnToCurrent,
    saveObservations,
    addSpecification,
    editSpecification,
    removeSpecification,
    dismissConflict
  }
}
