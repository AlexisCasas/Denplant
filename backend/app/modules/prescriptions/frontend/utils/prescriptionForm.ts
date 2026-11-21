/**
 * The new-prescription form: its fields, its limits and its checks.
 *
 * Limits and trimming are the backend's (`schemas.py`): a required field is
 * trimmed and keeps at least one character; an optional one is trimmed and, if
 * nothing is left, is simply not sent. The backend still decides; this only
 * saves a round trip for the obvious mistakes.
 *
 * `valid_until` is deliberately not compared with today: the backend compares
 * it with the issue date in the *clinic's* timezone, which the browser's day
 * may contradict. It is checked only for being a real calendar date.
 */

import type {
  PrescriptionCreatePayload,
  PrescriptionItemPayload,
  WriteError
} from '../types/prescriptions'

export const MAX_ITEMS = 50
export const MAX_REASON = 2000

export const REQUIRED_FIELDS = [
  'active_ingredient',
  'strength',
  'pharmaceutical_form',
  'dose',
  'route',
  'frequency',
  'duration',
  'total_quantity'
] as const

export const OPTIONAL_FIELDS = ['commercial_name', 'presentation', 'instructions'] as const

export type ItemField = typeof REQUIRED_FIELDS[number] | typeof OPTIONAL_FIELDS[number]

export const FIELD_LIMITS: Record<ItemField, number> = {
  active_ingredient: 200,
  strength: 100,
  pharmaceutical_form: 100,
  dose: 200,
  route: 100,
  frequency: 200,
  duration: 100,
  total_quantity: 100,
  commercial_name: 200,
  presentation: 200,
  instructions: 4000
}

export type ItemDraft = Record<ItemField, string> & { key: number }

export type FieldError = 'required' | 'tooLong'

let nextKey = 1

export function emptyItem(): ItemDraft {
  return {
    key: nextKey++,
    active_ingredient: '',
    strength: '',
    pharmaceutical_form: '',
    dose: '',
    route: '',
    frequency: '',
    duration: '',
    total_quantity: '',
    commercial_name: '',
    presentation: '',
    instructions: ''
  }
}

const DATE_ONLY = /^(\d{4})-(\d{2})-(\d{2})$/

/** A real calendar day written `YYYY-MM-DD`. The string is never parsed by `Date`. */
export function isCalendarDate(value: string): boolean {
  const match = DATE_ONLY.exec(value)
  if (!match) return false
  const year = Number(match[1])
  const month = Number(match[2])
  const day = Number(match[3])
  const moment = new Date(Date.UTC(year, month - 1, day, 12))
  return moment.getUTCFullYear() === year
    && moment.getUTCMonth() === month - 1
    && moment.getUTCDate() === day
}

export interface FormErrors {
  validUntil?: 'required' | 'invalid' | 'beforeIssue'
  /** Keyed by the item's `key`, then by field. */
  items: Record<number, Partial<Record<ItemField, FieldError>>>
  /** Whether anything at all is wrong. */
  any: boolean
}

export function validateForm(validUntil: string, items: ItemDraft[]): FormErrors {
  const errors: FormErrors = { items: {}, any: false }

  if (!validUntil) errors.validUntil = 'required'
  else if (!isCalendarDate(validUntil)) errors.validUntil = 'invalid'

  for (const item of items) {
    const found: Partial<Record<ItemField, FieldError>> = {}
    for (const field of REQUIRED_FIELDS) {
      const text = item[field].trim()
      if (!text) found[field] = 'required'
      else if (text.length > FIELD_LIMITS[field]) found[field] = 'tooLong'
    }
    for (const field of OPTIONAL_FIELDS) {
      if (item[field].trim().length > FIELD_LIMITS[field]) found[field] = 'tooLong'
    }
    if (Object.keys(found).length) errors.items[item.key] = found
  }

  errors.any = !!errors.validUntil
    || Object.keys(errors.items).length > 0
    || items.length < 1
    || items.length > MAX_ITEMS
  return errors
}

/** One item as the API takes it: trimmed, optional fields left out when empty. */
export function itemPayload(item: ItemDraft): PrescriptionItemPayload {
  const payload = {} as PrescriptionItemPayload
  for (const field of REQUIRED_FIELDS) payload[field] = item[field].trim()
  for (const field of OPTIONAL_FIELDS) {
    const text = item[field].trim()
    if (text) payload[field] = text
  }
  return payload
}

/**
 * What the form contributes to `POST /prescriptions`: the validity and the
 * medications. The patient is added where the request is made, from the patient
 * this view is bound to, so a draft cannot name another.
 */
export function createBody(
  validUntil: string,
  items: ItemDraft[]
): Omit<PrescriptionCreatePayload, 'patient_id'> {
  return { valid_until: validUntil, items: items.map(itemPayload) }
}

// ---------------------------------------------------------------------------
// failures
// ---------------------------------------------------------------------------

/**
 * The backend's own code for a failed write, or `request_validation` for the
 * array FastAPI sends when the body itself is malformed. Never the raw text.
 */
export function writeErrorOf(error: unknown): WriteError {
  const failure = error as {
    statusCode?: number
    status?: number
    data?: { code?: unknown, detail?: unknown }
  } | null
  const status = failure?.statusCode ?? failure?.status ?? null
  const code = failure?.data?.code
  if (typeof code === 'string' && code) return { status, code }
  if (Array.isArray(failure?.data?.detail)) return { status, code: 'request_validation' }
  return { status, code: null }
}

const CREATE_ERRORS = new Set([
  'prescriber_not_eligible',
  'prescriber_professional_id_required',
  'patient_date_of_birth_required',
  'patient_date_of_birth_invalid',
  'clinic_timezone_invalid',
  'valid_until_before_issue_date',
  'patient_not_found',
  'request_validation'
])

const VOID_ERRORS = new Set([
  'void_not_allowed',
  'prescription_state_conflict',
  'void_reason_required',
  'prescription_not_found',
  'request_validation'
])

/** The i18n key under `prescriptions.create.errors` for a failed issue. */
export function createErrorKey(error: WriteError): string {
  return error.code && CREATE_ERRORS.has(error.code) ? error.code : 'generic'
}

/** The i18n key under `prescriptions.void.errors` for a failed void. */
export function voidErrorKey(error: WriteError): string {
  return error.code && VOID_ERRORS.has(error.code) ? error.code : 'generic'
}
