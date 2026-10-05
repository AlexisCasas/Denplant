/**
 * Dates on a prescription: a calendar date is a day, never a moment.
 *
 * `issue_date`, `valid_until` and the date of birth are `YYYY-MM-DD`. Reading one
 * with `new Date('2026-10-03')` gives midnight UTC, which is the evening of the
 * 2nd in Lima. These tests pin that the helper never lets that happen, whatever
 * the browser's timezone.
 */

import { afterEach, describe, expect, it } from 'vitest'

import {
  formatDateOnly,
  formatDateTime
} from '../../../backend/app/modules/prescriptions/frontend/utils/prescriptionDates'

const ORIGINAL_TZ = process.env.TZ

afterEach(() => {
  if (ORIGINAL_TZ === undefined) delete process.env.TZ
  else process.env.TZ = ORIGINAL_TZ
})

describe('formatDateOnly', () => {
  it('writes the day it was given, in the locale\'s order', () => {
    expect(formatDateOnly('2026-10-03', 'es')).toBe('03/10/2026')
    expect(formatDateOnly('2026-10-03', 'fr')).toBe('03/10/2026')
    expect(formatDateOnly('2026-10-03', 'pt')).toBe('03/10/2026')
    expect(formatDateOnly('2026-10-03', 'en')).toBe('10/03/2026')
  })

  it.each([
    'America/Lima', // UTC-5: the zone that made 2026-10-03 look like the 2nd
    'America/Los_Angeles',
    'UTC',
    'Europe/Madrid',
    'Asia/Kolkata',
    'Pacific/Auckland',
    'Pacific/Kiritimati', // UTC+14
    'Pacific/Pago_Pago' // UTC-11
  ])('never changes the day, whatever the browser zone (%s)', (zone) => {
    process.env.TZ = zone
    for (const day of ['2026-10-03', '2026-01-01', '2026-12-31', '2024-02-29', '1945-11-19']) {
      const [year, month, date] = day.split('-')
      expect(formatDateOnly(day, 'es')).toBe(`${date}/${month}/${year}`)
    }
  })

  it('is exactly what a naive Date would get wrong in Lima', () => {
    process.env.TZ = 'America/Lima'
    // The bug being avoided: a date-only string parsed as UTC, shown in local time.
    expect(new Date('2026-10-03').toLocaleDateString('es', { day: '2-digit', month: '2-digit', year: 'numeric' }))
      .toBe('02/10/2026')
    expect(formatDateOnly('2026-10-03', 'es')).toBe('03/10/2026')
  })

  it('leaves what is not a valid calendar date as it came, never "Invalid Date"', () => {
    expect(formatDateOnly('2026-02-31', 'es')).toBe('2026-02-31')
    expect(formatDateOnly('2026-13-01', 'es')).toBe('2026-13-01')
    expect(formatDateOnly('not a date', 'es')).toBe('not a date')
    expect(formatDateOnly('2026-10-03T22:33:18Z', 'es')).toBe('2026-10-03T22:33:18Z')
  })

  it('writes nothing for nothing', () => {
    expect(formatDateOnly(null, 'es')).toBe('')
    expect(formatDateOnly(undefined, 'es')).toBe('')
    expect(formatDateOnly('', 'es')).toBe('')
  })

  it('a leap day is a leap day', () => {
    expect(formatDateOnly('2024-02-29', 'es')).toBe('29/02/2024')
    expect(formatDateOnly('2025-02-29', 'es')).toBe('2025-02-29')
  })
})

describe('formatDateTime', () => {
  it('formats an instant in the user\'s own zone', () => {
    process.env.TZ = 'America/Lima'
    const lima = formatDateTime('2026-10-03T22:33:18Z', 'en')
    process.env.TZ = 'UTC'
    const utc = formatDateTime('2026-10-03T22:33:18Z', 'en')
    expect(lima).toContain('5:33')
    expect(utc).toContain('10:33')
  })

  it('writes nothing for nothing and leaves garbage as it came', () => {
    expect(formatDateTime(null, 'es')).toBe('')
    expect(formatDateTime('nonsense', 'es')).toBe('nonsense')
  })
})
