/**
 * Prescriptions — response shapes of the backend API, as it sends them.
 *
 * Local to this layer on purpose: the host only knows that a `prescriptions`
 * clinical mode exists, not what a prescription looks like. Nothing here is
 * derived (no age, no name of whoever voided it): the API does not send it.
 *
 * `issue_date`, `valid_until` and `patient_date_of_birth_snapshot` are calendar
 * dates (`YYYY-MM-DD`), not instants: never parse them with `new Date(...)`
 * (see `utils/prescriptionDates.ts`). `issued_at` and `voided_at` are
 * timestamps.
 */

export type PrescriptionStatus = 'issued' | 'voided'

/** One row of a patient's history (`GET /prescriptions?patient_id=`). */
export interface PrescriptionListItem {
  id: string
  number: string
  issued_at: string
  issue_date: string
  valid_until: string
  prescriber_name_snapshot: string
  item_count: number
  status: PrescriptionStatus
  voided_at: string | null
}

export interface PrescriptionItem {
  id: string
  position: number
  active_ingredient: string
  strength: string
  pharmaceutical_form: string
  dose: string
  route: string
  frequency: string
  duration: string
  total_quantity: string
  commercial_name: string | null
  presentation: string | null
  instructions: string | null
}

/** The whole document (`GET /prescriptions/{id}`): every snapshot and its items. */
export interface PrescriptionDetail {
  id: string
  clinic_id: string
  patient_id: string
  prescriber_user_id: string

  number: string
  sequence: number
  year: number
  issued_at: string
  issue_date: string
  valid_until: string

  status: PrescriptionStatus
  voided_at: string | null
  /** A technical identifier only; the API sends no name for it. */
  voided_by: string | null
  void_reason: string | null

  patient_name_snapshot: string
  patient_national_id_snapshot: string | null
  patient_national_id_type_snapshot: string | null
  patient_date_of_birth_snapshot: string

  prescriber_name_snapshot: string
  prescriber_professional_id_snapshot: string

  clinic_name_snapshot: string
  clinic_legal_name_snapshot: string | null
  clinic_tax_id_snapshot: string
  clinic_address_snapshot: string | null
  clinic_phone_snapshot: string | null

  items: PrescriptionItem[]
}

/** The paginated envelope of the history endpoint. */
export interface PrescriptionListResponse {
  data: PrescriptionListItem[]
  total: number
  page: number
  page_size: number
  message: string | null
}

export interface PrescriptionDetailResponse {
  data: PrescriptionDetail
  message: string | null
}

/**
 * How a print request ended.
 *
 * `opened`      the PDF is in the window the click opened;
 * `downloaded`  the browser blocked that window, so the PDF was downloaded;
 * `busy`        a request for the same prescription is already running;
 * `cancelled`   the patient changed (or the view went away) meanwhile;
 * `failed`      nothing could be shown.
 */
export type PdfOutcome = 'opened' | 'downloaded' | 'busy' | 'cancelled' | 'failed'

// ---------------------------------------------------------------------------
// Writing (Phase D)
// ---------------------------------------------------------------------------

/** One medication as the API accepts it. Free text; nothing is looked up. */
export interface PrescriptionItemPayload {
  active_ingredient: string
  strength: string
  pharmaceutical_form: string
  dose: string
  route: string
  frequency: string
  duration: string
  total_quantity: string
  commercial_name?: string
  presentation?: string
  instructions?: string
}

/**
 * `POST /prescriptions` takes these three keys and nothing else
 * (`extra="forbid"`): clinic, prescriber, number, status, dates and snapshots
 * all come from the server.
 */
export interface PrescriptionCreatePayload {
  patient_id: string
  valid_until: string
  items: PrescriptionItemPayload[]
}

/** `POST /prescriptions/{id}/void`. */
export interface PrescriptionVoidPayload {
  reason: string
}

/** How a failed write came back: the HTTP status and the backend's own code. */
export interface WriteError {
  status: number | null
  code: string | null
}

/**
 * `done`    it worked;
 * `failed`  the server refused it (see the composable's error state);
 * `busy`    the same kind of write is already running;
 * `stale`   the patient changed meanwhile: the answer was dropped.
 */
export type WriteOutcome = 'done' | 'failed' | 'busy' | 'stale'
