/**
 * NTS N.° 188 print model — what the printed document says, as data.
 *
 * The printed odontogram is the same record the screen shows, arranged the
 * way the norm's **Anexo: Gráfico del odontograma** arranges it. This module
 * answers the questions that arrangement asks — which date, which
 * professional, which findings the drawing could not fully carry — and
 * answers them as plain values, so the view only has to lay them out.
 *
 * Three rules it keeps:
 *
 * * **Pure.** No Vue, no HTTP, no clock, no locale side effects. The same
 *   record always yields the same document. It is the property that lets the
 *   print tests assert on data instead of on pixels.
 * * **Read-only.** Nothing here writes. Discovering that a finding cannot be
 *   drawn produces a *statement about the record*, never an edit to it: the
 *   moment this module could append to `observations` it would be DenPlant
 *   authoring clinical text over a clinician's signature, and it would move
 *   the content hash under a finalized document.
 * * **No clinical vocabulary.** There is no list of rule ids here. Which
 *   findings are incompletely drawn is asked of the renderer, which is the
 *   only thing that knows what it can draw.
 */

import type { NtsCatalog, NtsRecord, NtsRule } from '../types/nts'
import type { NtsTargetSummary } from './ntsFindingModel'
import { describeTargets, ruleFor } from './ntsFindingModel'
import { resolveChart } from './ntsRenderModel'

// ---------------------------------------------------------------------------
// the coherence gate
// ---------------------------------------------------------------------------

/**
 * Whether this record and this catalog describe the same norm.
 *
 * The one precondition for putting anything clinical on the page, and the
 * only place it is decided.
 *
 * Two non-null objects are not a valid pair. `ruleFor` matches a finding to a
 * rule **by `rule_id` alone**, and rule ids are stable across revisions of a
 * norm — so handing this view a record from one norm and the catalog of
 * another does not fail loudly, it silently draws the second norm's marks for
 * the first norm's findings. That is a wrong clinical statement on a
 * document, which is worse than a blank page by some distance.
 *
 * The caller is not trusted to have paired them correctly. 05E does pair them
 * correctly today — `viewRecord`/`viewCatalog` are resolved together under one
 * generation token — but a document that is only correct because of a
 * guarantee made somewhere else is a document waiting for that guarantee to
 * be refactored.
 *
 * No norm version is named here. The question is only whether the two agree.
 */
export function canRenderPrintRecord(
  record: NtsRecord | null,
  catalog: NtsCatalog | null
): boolean {
  if (!record || !catalog) return false
  return record.norm_version === catalog.norm_version
}

// ---------------------------------------------------------------------------
// incompletely drawn findings
// ---------------------------------------------------------------------------

/** How short of the drawing a finding falls. `complete` never reaches here. */
export type NtsPrintGap = 'partial' | 'unsupported'

/**
 * One finding the chart does not carry in full, described for the page.
 *
 * `label` is the catalog's own `official_name`. `ruleId` rides along for
 * tests and debugging and is **not** meant for the printed page: a sigla code
 * tells a clinician nothing that the clinical name does not tell them better.
 */
export interface NtsPrintDeclaration {
  findingId: string
  ruleId: string
  label: string
  completeness: NtsPrintGap
  targets: NtsTargetSummary
}

/**
 * The findings this build cannot draw in full, for the record as given.
 *
 * Derived from the renderer, never from a list of rule ids. `resolveChart` is
 * the same call the chart itself makes, so a finding is declared here exactly
 * when the drawing the clinician is looking at is missing it — the two can
 * never disagree about what was drawn.
 *
 * An empty array means every finding is fully represented, which is the
 * common case and the one where the page shows no note at all.
 *
 * Ordered by the record's own `sequence` so two prints of one record list
 * them identically.
 *
 * Gated on {@link canRenderPrintRecord} rather than relying on the caller to
 * have gated first. A declaration says "this build could not draw *that*
 * finding", and computing it against the wrong norm's rules would make that
 * sentence a claim about a rule the record never cited. The pure model has to
 * be safe on its own: it is called directly, from tests and from anywhere a
 * later slice reaches for it.
 */
export function printDeclarations(
  record: NtsRecord | null,
  catalog: NtsCatalog | null
): NtsPrintDeclaration[] {
  // The null tests are redundant after the gate; they are what narrows the
  // types for the compiler, which cannot see through the boolean.
  if (!canRenderPrintRecord(record, catalog) || !record || !catalog) return []

  const render = resolveChart(record.findings, catalog.rules)
  const bySequence = new Map(record.findings.map(finding => [finding.id, finding]))

  return render.findings
    .filter(rendered => rendered.completeness !== 'complete')
    .map((rendered): NtsPrintDeclaration | null => {
      const finding = bySequence.get(rendered.findingId)
      if (!finding) return null
      const rule: NtsRule | null = ruleFor(catalog.rules, finding)
      return {
        findingId: finding.id,
        ruleId: finding.rule_id,
        // A rule the catalog does not carry degrades to its id rather than to
        // silence: an unnamed finding is still a finding on this patient.
        label: rule?.official_name ?? finding.rule_id,
        completeness: rendered.completeness as NtsPrintGap,
        targets: describeTargets(rule, finding.targets)
      }
    })
    .filter((entry): entry is NtsPrintDeclaration => entry !== null)
    .sort(
      (a, b) =>
        (bySequence.get(a.findingId)?.sequence ?? 0)
        - (bySequence.get(b.findingId)?.sequence ?? 0)
    )
}

// ---------------------------------------------------------------------------
// the date on the page
// ---------------------------------------------------------------------------

/**
 * The single date the annex asks for, as an ISO string.
 *
 * The annex prints one "FECHA:" and does not say which event it names. For a
 * finalized record the honest answer is when it was finalized — that is the
 * moment the document became the record in force (§5.6, inalterable). For one
 * that never reached that state the only date it has is when it was opened,
 * and a draft printed today is a picture of a document still being written.
 *
 * A discarded record keeps whichever it has: discarding does not retroactively
 * unmake a finalization.
 */
export function printDateSource(record: NtsRecord | null): string | null {
  if (!record) return null
  return record.finalized_at ?? record.recorded_at ?? null
}

/**
 * Format a record timestamp exactly as the rest of the odontogram does.
 *
 * NTS timestamps are stored `timezone=True` and serialized in UTC, so
 * `new Date(iso)` renders them in the reader's own zone — which is what the
 * shell already shows on screen. The printed date and the screen date must be
 * the same date; they are the same expression for that reason.
 *
 * Deliberately **not** `parseWallClock`: that helper exists for agenda
 * timestamps the API serializes in the *clinic's* zone, and applying it here
 * would silently shift a record's hour.
 */
export function formatPrintDate(iso: string | null, locale: string): string | null {
  if (!iso) return null
  return new Date(iso).toLocaleString(locale, { dateStyle: 'medium', timeStyle: 'short' })
}

// ---------------------------------------------------------------------------
// patient identity
// ---------------------------------------------------------------------------

/**
 * The fields the printed header carries about the patient.
 *
 * Deliberately three, and deliberately outside the normative area: the annex
 * itself has no patient block at all, because §5.2 places the graphic inside
 * the Ficha Odonto-Estomatológica, which carries the identification. This
 * header exists so a loose sheet can be matched back to a person — it is
 * DenPlant information on a DenPlant page, and it says so.
 *
 * Sex, age and date of birth are not here on purpose. None of them is asked
 * for by the annex, and each is a piece of personal data that would then be
 * printed on every copy for no clinical gain.
 */
export interface NtsPrintPatient {
  fullName: string | null
  documentType: string | null
  documentNumber: string | null
}

/** The shape this module needs of a patient. Anything wider is ignored. */
export interface NtsPrintPatientSource {
  first_name?: string | null
  last_name?: string | null
  national_id?: string | null
  national_id_type?: string | null
}

/**
 * Reduce a cached patient to what the page prints, or `null`.
 *
 * Every field is independently optional, and a missing one stays missing: a
 * header that renders "Documento: —" invites the reader to believe the patient
 * has no document on file, when the truth is that this page did not have it.
 * The view omits the row instead.
 *
 * `null` in, `null` out — the caller has no patient and the header says
 * nothing about one. Never a fetch: see `useNtsPrintIdentity`.
 */
export function toPrintPatient(
  source: NtsPrintPatientSource | null | undefined
): NtsPrintPatient | null {
  if (!source) return null

  const first = source.first_name?.trim() ?? ''
  const last = source.last_name?.trim() ?? ''
  const fullName = [first, last].filter(Boolean).join(' ')
  const documentNumber = source.national_id?.trim() || null

  const identity: NtsPrintPatient = {
    fullName: fullName.length > 0 ? fullName : null,
    // A type with no number describes nothing, so it is dropped with it.
    documentType: documentNumber ? (source.national_id_type?.trim() || null) : null,
    documentNumber
  }

  // A patient object that yielded nothing printable is the same as none.
  return identity.fullName === null && identity.documentNumber === null ? null : identity
}

// ---------------------------------------------------------------------------
// professional identity
// ---------------------------------------------------------------------------

/**
 * Who is answerable for the record, per §5.3.
 *
 * The norm names "el/la cirujano dentista" who records the data, and the
 * service snapshots exactly that person at finalize time into
 * `recorded_by_*` — its own comment says the snapshot describes
 * `recorded_by` **even when somebody else presses finalize**.
 *
 * So `finalized_by` is never read here. It may be a supervisor who closed the
 * document, and printing their name as the professional would attribute the
 * clinical content to someone who did not record it.
 *
 * This is identification, not a signature. §5.3 puts the firma y sello on the
 * Ficha, not on this graphic, and no signature line is printed.
 */
export interface NtsPrintProfessional {
  name: string | null
  role: string | null
  professionalId: string | null
}

/** `null` when the record names nobody — a draft has not been snapshotted yet. */
export function toPrintProfessional(record: NtsRecord | null): NtsPrintProfessional | null {
  if (!record) return null
  const professional: NtsPrintProfessional = {
    name: record.recorded_by_name?.trim() || null,
    role: record.recorded_by_role?.trim() || null,
    professionalId: record.recorded_by_professional_id?.trim() || null
  }
  return professional.name === null
    && professional.role === null
    && professional.professionalId === null
    ? null
    : professional
}

// ---------------------------------------------------------------------------
// technical footer
// ---------------------------------------------------------------------------

/**
 * What lets a printed sheet be reconciled with the record it came from.
 *
 * None of this is asked for by the annex, which is why it belongs in a footer
 * set apart from the document rather than inside the form. A sheet that
 * cannot be traced back to a record is an orphan, and orphaned clinical
 * paper is its own problem.
 *
 * `contentHash` is whole or absent. It is offered as a fingerprint over the
 * canonical content — it attests the content has not changed since it was
 * finalized, and it is **not** a digital signature, a certification, or a
 * claim of legal validity. Half a hash attests nothing at all, so it is never
 * abbreviated for layout.
 */
export interface NtsPrintFooter {
  recordId: string
  normVersion: string
  status: string
  contentHash: string | null
  hashAlgorithm: string | null
}

export function toPrintFooter(record: NtsRecord | null): NtsPrintFooter | null {
  if (!record) return null
  return {
    recordId: record.id,
    normVersion: record.norm_version,
    status: record.status,
    // Present together or not at all: an algorithm without a digest, or a
    // digest whose algorithm is unknown, cannot be checked by anyone.
    contentHash: record.content_hash && record.hash_algorithm ? record.content_hash : null,
    hashAlgorithm: record.content_hash && record.hash_algorithm ? record.hash_algorithm : null
  }
}

// ---------------------------------------------------------------------------
// document status
// ---------------------------------------------------------------------------

/**
 * What kind of document this sheet is.
 *
 * 05F.1 only computes it. The visual consequence — the qualifying banner that
 * stops a draft from being mistaken for the record in force — is 05F.3's.
 * Separating them means the rule is testable before it is decorated.
 *
 * `superseded` is not a status the record carries; it is derived by the server
 * for a history row and only reaches here when the caller has it, so it is an
 * explicit input rather than something guessed from the record.
 */
export interface NtsPrintStatus {
  status: NtsRecord['status']
  /** A finalized record that a later one has replaced. */
  isSuperseded: boolean
  /** True for anything that is not the finalized, current document. */
  isQualified: boolean
}

export function toPrintStatus(
  record: NtsRecord | null,
  options: { isSuperseded?: boolean } = {}
): NtsPrintStatus | null {
  if (!record) return null
  const isSuperseded = options.isSuperseded ?? false
  return {
    status: record.status,
    isSuperseded,
    isQualified: record.status !== 'finalized' || isSuperseded
  }
}

/**
 * Findings carried from an earlier record that nobody has reviewed yet.
 *
 * A count, not a list: the qualifying banner says how many are outstanding so
 * the sheet cannot be read as a reviewed document, and the finding list on
 * screen is where each one is actually dealt with.
 */
export function pendingCarriedForwardCount(record: NtsRecord | null): number {
  return (record?.findings ?? []).filter(f => f.provenance === 'carried_forward').length
}

// ---------------------------------------------------------------------------
// may this be printed at all?
// ---------------------------------------------------------------------------

/**
 * Why printing is not available right now.
 *
 * Two families, and the difference decides the affordance:
 *
 * * **Structural** — `no_record`, `catalog_unavailable`, `norm_mismatch`.
 *   There is nothing to print and nothing the clinician can do about it here.
 *   No button is offered at all.
 * * **Transient** — everything else. The record is printable in principle;
 *   something is in flight, unsaved, or unacknowledged. The button stays
 *   visible and disabled so the reason can be read, because a control that
 *   silently does nothing is worse than one that says why.
 */
export type NtsPrintBlocker =
  | 'no_record'
  | 'catalog_unavailable'
  | 'norm_mismatch'
  | 'loading'
  | 'opening_historical'
  | 'refreshing'
  | 'writing'
  | 'dirty'
  | 'refresh_failed'
  | 'conflict'

/** Blockers that mean "not now"; the rest mean "not here". */
const TRANSIENT_BLOCKERS: ReadonlySet<NtsPrintBlocker> = new Set<NtsPrintBlocker>([
  'loading',
  'opening_historical',
  'refreshing',
  'writing',
  'dirty',
  'refresh_failed',
  'conflict'
])

export interface NtsPrintAvailabilityInput {
  /** The record on screen — `viewRecord`, whichever mode the shell is in. */
  record: NtsRecord | null
  /** The catalog of *that record's* norm — `viewCatalog`. */
  catalog: NtsCatalog | null
  /** Clinical text typed and not sent. `useNtsUnsavedChanges.dirty`. */
  dirty: boolean
  /** A mutation is in flight, or its refetch is. */
  writing: boolean
  /** First load, or a change of patient or norm. */
  loading: boolean
  /** A background refetch is installing a new snapshot. */
  refreshing: boolean
  /** A historical record is being opened. */
  openingHistorical: boolean
  /**
   * A write landed but its refetch did not — from either source the shell
   * has, OR-ed. The record is not lost; what is on screen may be behind it.
   */
  refreshFailed: boolean
  /** An unresolved version/draft/state conflict is being shown. */
  conflict: boolean
}

export interface NtsPrintAvailability {
  printable: boolean
  blocker: NtsPrintBlocker | null
  /** Whether the blocker is something waiting or acting will clear. */
  transient: boolean
}

/**
 * Whether the record on screen may be printed right now, and if not, why.
 *
 * **One decision for two consumers.** The print button reads it to decide
 * what to offer, and the always-mounted print root reads the same object to
 * decide whether to render the clinical document at all. They cannot diverge,
 * which matters because the root is reachable by the browser's own Ctrl+P
 * without ever passing the button.
 *
 * The ordering below is the order the reasons are *reported*, not a hierarchy
 * of severity: structural reasons first because they remove the affordance
 * entirely, then whatever the clinician would have to do about it.
 *
 * What is deliberately **not** here: `draft`, `discarded` and `superseded`.
 * Those are qualifications of the document, not reasons to refuse it — a
 * working copy is a legitimate thing to print as long as the sheet says what
 * it is (§5.6 makes the *recorded finding* inalterable, not the printing of a
 * draft). {@link toPrintStatus} carries that, and the sheet states it.
 */
export function resolvePrintAvailability(
  input: NtsPrintAvailabilityInput
): NtsPrintAvailability {
  const blocked = (blocker: NtsPrintBlocker): NtsPrintAvailability => ({
    printable: false,
    blocker,
    transient: TRANSIENT_BLOCKERS.has(blocker)
  })

  if (!input.record) return blocked('no_record')
  if (!input.catalog) return blocked('catalog_unavailable')
  // The same test `canRenderPrintRecord` makes, reported with its own reason:
  // a catalog for another norm draws the wrong marks rather than none.
  if (!canRenderPrintRecord(input.record, input.catalog)) return blocked('norm_mismatch')

  // Something is being installed; printing a snapshot mid-swap would print a
  // record that is already being replaced.
  if (input.loading) return blocked('loading')
  if (input.openingHistorical) return blocked('opening_historical')
  if (input.refreshing) return blocked('refreshing')

  // A mutation already sent can still change the record about to be printed.
  if (input.writing) return blocked('writing')

  // The sheet prints the record as *persisted*. Text typed and not saved is
  // not on it, and a clinician who printed now would reasonably assume it
  // was. Saving or discarding is the clinician's call, so neither is done
  // for them and neither is offered as "print anyway".
  if (input.dirty) return blocked('dirty')

  // The write landed; the re-read did not. Nothing is lost, but what is on
  // screen may be behind the server, and a document is the wrong place to
  // find that out. Cleared by the existing GET-only retry.
  if (input.refreshFailed) return blocked('refresh_failed')

  // Not stale — `recoverFromConflict` refetches before raising this — but
  // another session changed the record and the clinician has not yet seen
  // what. Printing in the middle of that is printing a decision not made.
  if (input.conflict) return blocked('conflict')

  return { printable: true, blocker: null, transient: false }
}
