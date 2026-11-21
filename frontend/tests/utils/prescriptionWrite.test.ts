/**
 * Phase D, the pure parts: who may write, what the form accepts, what it sends.
 *
 * The limits and the trimming are `backend/app/modules/prescriptions/schemas.py`
 * restated; if the backend changes them this file is where it should fail.
 */

import { describe, expect, it } from 'vitest'

import {
  createBody,
  createErrorKey,
  emptyItem,
  FIELD_LIMITS,
  isCalendarDate,
  itemPayload,
  MAX_ITEMS,
  MAX_REASON,
  OPTIONAL_FIELDS,
  REQUIRED_FIELDS,
  validateForm,
  voidErrorKey,
  writeErrorOf,
  type ItemDraft
} from '../../../backend/app/modules/prescriptions/frontend/utils/prescriptionForm'
import {
  canVoid,
  dateOfBirthMissing,
  issueAccess
} from '../../../backend/app/modules/prescriptions/frontend/utils/prescriptionRules'

function filled(over: Partial<ItemDraft> = {}): ItemDraft {
  const item = emptyItem()
  for (const field of REQUIRED_FIELDS) item[field] = `valor ${field}`
  return Object.assign(item, over)
}

// ===========================================================================
// who may issue
// ===========================================================================

describe('issueAccess', () => {
  const dentist = { hasPrescribePermission: true, role: 'dentist', professionalId: '28/12345' }

  it('a dentist with the permission and a registration number may issue', () => {
    expect(issueAccess(dentist)).toBe('allowed')
  })

  it.each(['admin', 'hygienist', 'assistant', 'receptionist', null, 'superuser'])(
    'is hidden for role %s even with the permission (an admin holds the * wildcard)',
    (role) => {
      expect(issueAccess({ ...dentist, role })).toBe('hidden')
    }
  )

  it('is hidden for a dentist without the permission', () => {
    expect(issueAccess({ ...dentist, hasPrescribePermission: false })).toBe('hidden')
  })

  it.each([undefined, null, '', '   '])('a dentist with registration number %j is shown the reason', (professionalId) => {
    expect(issueAccess({ ...dentist, professionalId })).toBe('missing-professional-id')
  })

  it('never infers the role from the registration number', () => {
    expect(issueAccess({ hasPrescribePermission: true, role: 'admin', professionalId: '28/12345' })).toBe('hidden')
  })
})

// ===========================================================================
// who may void
// ===========================================================================

describe('canVoid', () => {
  const base = {
    hasVoidPermission: true,
    role: 'dentist' as string | null,
    userId: 'u1',
    prescriberUserId: 'u1',
    status: 'issued'
  }

  it('the dentist who issued it may', () => {
    expect(canVoid(base)).toBe(true)
  })

  it('another dentist may not, whatever permission they hold', () => {
    expect(canVoid({ ...base, userId: 'u2' })).toBe(false)
  })

  it('an admin may, even if somebody else wrote it', () => {
    expect(canVoid({ ...base, role: 'admin', userId: 'u9' })).toBe(true)
  })

  it.each(['hygienist', 'assistant', 'receptionist', null])('role %s may not, even as the same user', (role) => {
    expect(canVoid({ ...base, role })).toBe(false)
  })

  it('a voided prescription cannot be voided again', () => {
    expect(canVoid({ ...base, status: 'voided' })).toBe(false)
    expect(canVoid({ ...base, role: 'admin', status: 'voided' })).toBe(false)
  })

  it('without the permission nobody may', () => {
    expect(canVoid({ ...base, hasVoidPermission: false })).toBe(false)
    expect(canVoid({ ...base, role: 'admin', hasVoidPermission: false })).toBe(false)
  })

  it('an unknown user is not the prescriber', () => {
    expect(canVoid({ ...base, userId: undefined })).toBe(false)
    expect(canVoid({ ...base, userId: '', prescriberUserId: '' })).toBe(false)
  })
})

// ===========================================================================
// the cached patient
// ===========================================================================

describe('dateOfBirthMissing', () => {
  it('is false when there is no cached record: uncertainty is not a no', () => {
    expect(dateOfBirthMissing(null)).toBe(false)
    expect(dateOfBirthMissing(undefined)).toBe(false)
  })

  it('is false when the record has a date of birth', () => {
    expect(dateOfBirthMissing({ date_of_birth: '1980-05-01' })).toBe(false)
  })

  it.each([undefined, null, ''])('is true when the record is there and date_of_birth is %j', (value) => {
    expect(dateOfBirthMissing({ date_of_birth: value })).toBe(true)
  })
})

// ===========================================================================
// limits, as the backend sets them
// ===========================================================================

describe('the limits', () => {
  it('are the backend schema\'s', () => {
    expect(FIELD_LIMITS).toEqual({
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
    })
    expect(MAX_ITEMS).toBe(50)
    expect(MAX_REASON).toBe(2000)
  })

  it('eight fields are required and three are optional', () => {
    expect([...REQUIRED_FIELDS]).toHaveLength(8)
    expect([...OPTIONAL_FIELDS]).toEqual(['commercial_name', 'presentation', 'instructions'])
  })
})

// ===========================================================================
// validation
// ===========================================================================

describe('validateForm', () => {
  it('accepts a complete form', () => {
    const errors = validateForm('2026-10-31', [filled()])
    expect(errors.any).toBe(false)
  })

  it('requires valid_until, and a real calendar day', () => {
    expect(validateForm('', [filled()]).validUntil).toBe('required')
    expect(validateForm('2026-02-31', [filled()]).validUntil).toBe('invalid')
    expect(validateForm('31/10/2026', [filled()]).validUntil).toBe('invalid')
    expect(validateForm('2026-10-31', [filled()]).validUntil).toBeUndefined()
  })

  it('does not compare valid_until with today: the backend does, in the clinic\'s zone', () => {
    expect(validateForm('1999-01-01', [filled()]).any).toBe(false)
    expect(validateForm('2999-12-31', [filled()]).any).toBe(false)
  })

  it.each([...REQUIRED_FIELDS])('requires %s', (field) => {
    const item = filled({ [field]: '' })
    expect(validateForm('2026-10-31', [item]).items[item.key]?.[field]).toBe('required')
  })

  it.each([...REQUIRED_FIELDS])('a %s of only whitespace is empty', (field) => {
    const item = filled({ [field]: ' \t\n  ' })
    expect(validateForm('2026-10-31', [item]).items[item.key]?.[field]).toBe('required')
  })

  it.each([...REQUIRED_FIELDS, ...OPTIONAL_FIELDS])('%s accepts exactly its maximum and refuses one more', (field) => {
    const max = FIELD_LIMITS[field]
    const ok = filled({ [field]: 'a'.repeat(max) })
    const tooLong = filled({ [field]: 'a'.repeat(max + 1) })

    expect(validateForm('2026-10-31', [ok]).items[ok.key]?.[field]).toBeUndefined()
    expect(validateForm('2026-10-31', [tooLong]).items[tooLong.key]?.[field]).toBe('tooLong')
  })

  it('counts length after trimming, as the backend does', () => {
    const item = filled({ strength: `  ${'a'.repeat(100)}  ` })
    expect(validateForm('2026-10-31', [item]).items[item.key]?.strength).toBeUndefined()
  })

  it('optional fields may be empty or whitespace', () => {
    const item = filled({ commercial_name: '   ', presentation: '', instructions: '\n' })
    expect(validateForm('2026-10-31', [item]).any).toBe(false)
  })

  it('reports each medication on its own', () => {
    const first = filled()
    const second = filled({ dose: '' })
    const errors = validateForm('2026-10-31', [first, second])

    expect(errors.items[first.key]).toBeUndefined()
    expect(errors.items[second.key]?.dose).toBe('required')
    expect(errors.any).toBe(true)
  })

  it('needs at least one and at most fifty medications', () => {
    expect(validateForm('2026-10-31', []).any).toBe(true)
    expect(validateForm('2026-10-31', Array.from({ length: 50 }, () => filled())).any).toBe(false)
    expect(validateForm('2026-10-31', Array.from({ length: 51 }, () => filled())).any).toBe(true)
  })
})

describe('isCalendarDate', () => {
  it.each(['2026-10-03', '2024-02-29', '1999-12-31'])('%s is a day', (value) => {
    expect(isCalendarDate(value)).toBe(true)
  })

  it.each(['', '2026-13-01', '2026-02-30', '2025-02-29', '03/10/2026', '2026-1-3', '2026-10-03T00:00:00Z'])(
    '%j is not',
    (value) => {
      expect(isCalendarDate(value)).toBe(false)
    }
  )
})

// ===========================================================================
// what is sent
// ===========================================================================

describe('itemPayload', () => {
  it('trims every field', () => {
    const item = filled({ dose: '  1 tableta  ' })
    expect(itemPayload(item).dose).toBe('1 tableta')
  })

  it('leaves out optional fields that are empty after trimming', () => {
    const payload = itemPayload(filled({ commercial_name: '  ', presentation: '', instructions: '\n' }))

    expect(payload).not.toHaveProperty('commercial_name')
    expect(payload).not.toHaveProperty('presentation')
    expect(payload).not.toHaveProperty('instructions')
  })

  it('sends optional fields that have text, trimmed', () => {
    const payload = itemPayload(filled({ commercial_name: ' Amoxil ', instructions: ' Con agua\nSin alcohol ' }))

    expect(payload.commercial_name).toBe('Amoxil')
    expect(payload.instructions).toBe('Con agua\nSin alcohol')
  })

  it('has exactly the schema\'s keys and never the draft\'s local key', () => {
    const payload = itemPayload(filled({ commercial_name: 'x', presentation: 'y', instructions: 'z' }))

    expect(Object.keys(payload).sort()).toEqual([...REQUIRED_FIELDS, ...OPTIONAL_FIELDS].sort())
    expect(payload).not.toHaveProperty('key')
  })
})

describe('createBody', () => {
  it('is the validity and the medications, in the order they were written', () => {
    const a = filled({ active_ingredient: 'A' })
    const b = filled({ active_ingredient: 'B' })
    const body = createBody('2026-10-31', [a, b])

    expect(Object.keys(body).sort()).toEqual(['items', 'valid_until'])
    expect(body.valid_until).toBe('2026-10-31')
    expect(body.items.map(item => item.active_ingredient)).toEqual(['A', 'B'])
  })

  it('sends the date as typed: a plain string, not a Date', () => {
    expect(typeof createBody('2026-10-03', [filled()]).valid_until).toBe('string')
    expect(createBody('2026-10-03', [filled()]).valid_until).toBe('2026-10-03')
  })

  it('carries nothing the server decides', () => {
    const body = createBody('2026-10-31', [filled()]) as Record<string, unknown>
    for (const forbidden of [
      'patient_id', 'clinic_id', 'prescriber_user_id', 'number', 'status', 'issued_at', 'issue_date',
      'void_reason', 'voided_at', 'voided_by', 'patient_name_snapshot', 'prescriber_professional_id_snapshot'
    ]) {
      expect(body).not.toHaveProperty(forbidden)
    }
  })
})

// ===========================================================================
// failures
// ===========================================================================

describe('writeErrorOf', () => {
  it('takes the backend\'s code from its error body', () => {
    const error = { statusCode: 422, data: { code: 'patient_date_of_birth_required', message: 'x', errors: ['x'] } }
    expect(writeErrorOf(error)).toEqual({ status: 422, code: 'patient_date_of_birth_required' })
  })

  it('reads the status from either field', () => {
    expect(writeErrorOf({ status: 409, data: { code: 'prescription_state_conflict' } }).status).toBe(409)
  })

  it('recognises FastAPI\'s own validation array', () => {
    const error = { statusCode: 422, data: { detail: [{ loc: ['body'], msg: 'bad', type: 'x' }] } }
    expect(writeErrorOf(error)).toEqual({ status: 422, code: 'request_validation' })
  })

  it('never exposes raw text: an unknown failure has no code', () => {
    expect(writeErrorOf({ statusCode: 500, data: { message: 'Traceback (most recent call last)' } }))
      .toEqual({ status: 500, code: null })
    expect(writeErrorOf(new Error('boom'))).toEqual({ status: null, code: null })
    expect(writeErrorOf(null)).toEqual({ status: null, code: null })
  })
})

describe('error messages', () => {
  it.each([
    'prescriber_not_eligible',
    'prescriber_professional_id_required',
    'patient_date_of_birth_required',
    'patient_date_of_birth_invalid',
    'clinic_timezone_invalid',
    'valid_until_before_issue_date',
    'patient_not_found',
    'request_validation'
  ])('issuing: %s has its own message', (code) => {
    expect(createErrorKey({ status: 422, code })).toBe(code)
  })

  it.each([
    'void_not_allowed',
    'prescription_state_conflict',
    'void_reason_required',
    'prescription_not_found',
    'request_validation'
  ])('voiding: %s has its own message', (code) => {
    expect(voidErrorKey({ status: 409, code })).toBe(code)
  })

  it('anything else is generic, never the server\'s text', () => {
    expect(createErrorKey({ status: 500, code: null })).toBe('generic')
    expect(createErrorKey({ status: 500, code: 'something_new' })).toBe('generic')
    expect(voidErrorKey({ status: 500, code: 'something_new' })).toBe('generic')
    // a code of the other operation is not borrowed
    expect(voidErrorKey({ status: 403, code: 'prescriber_not_eligible' })).toBe('generic')
    expect(createErrorKey({ status: 409, code: 'prescription_state_conflict' })).toBe('generic')
  })
})
