/**
 * evolutionNotes — the pure half of the "Evolución" tab.
 *
 * Everything here is a function of its arguments: no Vue, no Nuxt, no network
 * of its own. The view and the print sheet feed it, and the tests exercise it
 * directly, because the parts that can go quietly wrong — a pager that never
 * ends, a deep link that reopens on refresh, a note type the wrong way round —
 * are exactly the parts that need no component to check.
 */

import type {
  ClinicalNoteCreate,
  ClinicalNoteLinked,
  NoteAttachment,
  NoteType,
  RecentNoteEntry
} from '~~/app/types'

// ---------------------------------------------------------------------------
// what the tab shows
// ---------------------------------------------------------------------------

/**
 * The clinical note types, in the order the filter shows them.
 *
 * `administrative` and `appointment_administrative` are deliberately absent:
 * they are reception notes, not part of the clinical record, and the tab (and
 * its printout) is the clinical history.
 */
export const EVOLUTION_CLINICAL_TYPES: readonly NoteType[] = [
  'evolution',
  'diagnosis',
  'treatment',
  'treatment_plan',
  'appointment_clinical'
]

export function isClinicalType(type: string): type is NoteType {
  return (EVOLUTION_CLINICAL_TYPES as readonly string[]).includes(type)
}

// ---------------------------------------------------------------------------
// writing a note
// ---------------------------------------------------------------------------

/** What the composer is currently writing. */
export interface ComposerIntent {
  noteType: 'evolution' | 'diagnosis'
  /** FDI number, only ever for a `diagnosis` note. */
  toothNumber: number | null
}

export const NEW_EVOLUTION: ComposerIntent = { noteType: 'evolution', toothNumber: null }

/** What `NoteComposer` emits on submit. */
export interface ComposerSubmission {
  body: string
  toothNumber: number | null
  attachmentDocumentIds: string[]
}

/**
 * The request that creates the note.
 *
 * An evolution is patient-owned and never carries a tooth; a diagnosis note
 * keeps the tooth the clinician bound it to. The tooth is dropped for any
 * other type here as well as in the backend, so the two cannot disagree.
 */
export function buildCreatePayload(
  intent: Pick<ComposerIntent, 'noteType'>,
  patientId: string,
  submission: ComposerSubmission
): ClinicalNoteCreate {
  return {
    note_type: intent.noteType,
    owner_type: 'patient',
    owner_id: patientId,
    tooth_number: intent.noteType === 'diagnosis' ? submission.toothNumber : null,
    body: submission.body,
    attachment_document_ids: submission.attachmentDocumentIds
  }
}

// ---------------------------------------------------------------------------
// the deep link from Diagnóstico
// ---------------------------------------------------------------------------

type QueryValue = string | null | undefined | Array<string | null>
export type QueryLike = Record<string, QueryValue | unknown>

function first(value: unknown): string | null {
  const raw = Array.isArray(value) ? value[0] : value
  return typeof raw === 'string' && raw.length > 0 ? raw : null
}

/** A real FDI number: quadrants 1–4 hold teeth 1–8, quadrants 5–8 hold 1–5. */
export function isFdiTooth(value: number): boolean {
  if (!Number.isInteger(value)) return false
  const quadrant = Math.floor(value / 10)
  const position = value % 10
  if (quadrant >= 1 && quadrant <= 4) return position >= 1 && position <= 8
  if (quadrant >= 5 && quadrant <= 8) return position >= 1 && position <= 5
  return false
}

/**
 * What the query asks the composer to open as, or `null` when it asks for
 * nothing.
 *
 * `?newNote=diagnosis&tooth=<FDI>` opens a diagnosis note bound to that tooth.
 * A missing or invalid tooth is **not** replaced by a guess: the diagnosis
 * composer opens unbound. Any other `newNote` value is ignored.
 */
export function composerIntentFromQuery(query: QueryLike): ComposerIntent | null {
  const requested = first(query.newNote)
  if (requested === 'evolution') return { ...NEW_EVOLUTION }
  if (requested !== 'diagnosis') return null

  const rawTooth = first(query.tooth)
  const tooth = rawTooth !== null && /^\d+$/.test(rawTooth) ? Number(rawTooth) : null
  return { noteType: 'diagnosis', toothNumber: tooth !== null && isFdiTooth(tooth) ? tooth : null }
}

/**
 * The same query minus the deep-link parameters, so a refresh does not reopen
 * the composer. Every other parameter (`tab`, `clinicalMode`, …) is kept.
 */
export function withoutComposerIntent<T extends QueryLike>(query: T): Omit<T, 'newNote' | 'tooth'> {
  const { newNote: _newNote, tooth: _tooth, ...rest } = query
  return rest
}

// ---------------------------------------------------------------------------
// the whole history, for printing
// ---------------------------------------------------------------------------

/** One call to `/patients/{id}/recent`. */
export interface RecentPageRequest {
  types: NoteType[]
  limit: number
  before?: string
}
export type RecentPageFetcher = (request: RecentPageRequest) => Promise<RecentNoteEntry[]>

/** The endpoint's own ceiling on `limit`. */
export const PRINT_PAGE_SIZE = 100

/** A backstop, not a feature: 50 000 notes is not a chart, it is a bug. */
export const MAX_PRINT_PAGES = 500

export interface FullHistory {
  notes: RecentNoteEntry[]
  /**
   * False when the pager had to stop early (the cursor stopped advancing, a
   * page held nothing new, or the page budget ran out). The printout says so
   * rather than presenting a partial history as the whole one.
   */
  complete: boolean
}

/**
 * Every clinical note of a patient, newest first, by walking the cursor.
 *
 * The endpoint pages by `created_at < before`, so the cursor is the oldest
 * timestamp seen. Three things end the walk, and only the first is success:
 *
 * * a short (or empty) page — nothing is left;
 * * a cursor that did not move, or a page with no unseen id — the server is
 *   not advancing, and asking again would loop forever;
 * * the page budget.
 *
 * Notes are de-duplicated by id, so a note returned twice (two notes sharing
 * the cursor instant, a retried page) is printed once.
 */
export async function fetchAllClinicalNotes(
  fetchPage: RecentPageFetcher,
  types: readonly NoteType[] = EVOLUTION_CLINICAL_TYPES,
  pageSize: number = PRINT_PAGE_SIZE,
  maxPages: number = MAX_PRINT_PAGES
): Promise<FullHistory> {
  const seen = new Map<string, RecentNoteEntry>()
  let before: string | undefined

  for (let page = 0; page < maxPages; page++) {
    const rows = await fetchPage({ types: [...types], limit: pageSize, before })
    if (rows.length === 0) return { notes: [...seen.values()], complete: true }

    let added = 0
    for (const row of rows) {
      if (seen.has(row.id)) continue
      seen.set(row.id, row)
      added += 1
    }

    if (rows.length < pageSize) return { notes: [...seen.values()], complete: true }

    const cursor = rows[rows.length - 1]!.created_at
    if (added === 0 || cursor === before) {
      return { notes: [...seen.values()], complete: false }
    }
    before = cursor
  }

  return { notes: [...seen.values()], complete: false }
}

/** Oldest first, which is how a clinical history reads. Ties break on id. */
export function sortForPrint(notes: readonly RecentNoteEntry[]): RecentNoteEntry[] {
  return [...notes].sort((a, b) => {
    const delta = Date.parse(a.created_at) - Date.parse(b.created_at)
    if (delta !== 0 && !Number.isNaN(delta)) return delta
    return a.id < b.id ? -1 : a.id > b.id ? 1 : 0
  })
}

// ---------------------------------------------------------------------------
// reading a note
// ---------------------------------------------------------------------------

export type Translate = (key: string, params?: Record<string, unknown>) => string

/**
 * "Diente 47", "Plan: PLAN-2024-0001", "Cita"… the context a note belongs to.
 *
 * The appointment label is opt-in because the existing feeds never showed one
 * and their layout was not designed around it.
 */
export function contextLabel(
  linked: ClinicalNoteLinked | null | undefined,
  t: Translate,
  options: { appointment?: boolean } = {}
): string | null {
  if (!linked) return null
  if (linked.kind === 'patient' && linked.tooth_number) {
    return t('clinicalNotes.linked.tooth', { n: linked.tooth_number })
  }
  if (linked.kind === 'treatment') {
    if (linked.tooth_number && linked.label) {
      return t('clinicalNotes.linked.treatmentOnTooth', {
        label: linked.label,
        n: linked.tooth_number
      })
    }
    return linked.label || t('clinicalNotes.linked.treatment')
  }
  if (linked.kind === 'plan') {
    return linked.label
      ? t('clinicalNotes.linked.planNamed', { label: linked.label })
      : t('clinicalNotes.linked.plan')
  }
  if (linked.kind === 'appointment' && options.appointment) {
    return t('clinicalNotes.linked.appointment')
  }
  return null
}

/** A short, human type for an attachment: "PDF", "JPEG", or the media kind. */
export function attachmentTypeLabel(attachment: Pick<NoteAttachment, 'mime_type' | 'media_kind'>): string {
  const mime = attachment.mime_type ?? ''
  if (mime === 'application/pdf') return 'PDF'
  if (mime.startsWith('image/')) return mime.slice('image/'.length).toUpperCase()
  if (mime.length > 0) return mime
  return attachment.media_kind ?? ''
}

/**
 * What a printed attachment reads as: the file's name and its type, nothing
 * rendered. Thumbnails are authenticated downloads; a print sheet that had to
 * wait for each of them would print with holes.
 */
export function attachmentPrintLine(
  attachment: Pick<NoteAttachment, 'title' | 'document_id' | 'mime_type' | 'media_kind'>
): string {
  const name = attachment.title?.trim() || attachment.document_id.slice(0, 8)
  const kind = attachmentTypeLabel(attachment)
  return kind ? `${name} (${kind})` : name
}

// ---------------------------------------------------------------------------
// who the printout is about
// ---------------------------------------------------------------------------

export interface EvolutionPrintPatient {
  fullName: string | null
  documentNumber: string | null
}

/** The shape this sheet needs of a cached patient; anything wider is ignored. */
export interface EvolutionPatientSource {
  first_name?: string | null
  last_name?: string | null
  national_id?: string | null
}

/**
 * Reduce a cached patient to the two things the header prints, or `null`.
 *
 * A missing field stays missing — the sheet omits the row — so a patient whose
 * document this page simply did not have is not printed as having none.
 */
export function toPrintPatient(
  source: EvolutionPatientSource | null | undefined
): EvolutionPrintPatient | null {
  if (!source) return null
  const fullName = [source.first_name?.trim(), source.last_name?.trim()].filter(Boolean).join(' ')
  const documentNumber = source.national_id?.trim() || null
  const patient = { fullName: fullName || null, documentNumber }
  return patient.fullName === null && patient.documentNumber === null ? null : patient
}
