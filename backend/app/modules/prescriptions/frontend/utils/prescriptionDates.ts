/**
 * Dates on a prescription.
 *
 * A calendar date (`2026-10-03`) is a day, not a moment. `new Date('2026-10-03')`
 * reads it as midnight UTC, which in Lima (UTC-5) is the evening of the 2nd:
 * formatting that `Date` in the browser's zone prints `02/10/2026`, one day
 * off, on a legal document. So a date-only value is never handed to `Date` as
 * a string here. It is split into year, month and day, built at UTC noon
 * and formatted **in UTC**, which prints the same calendar day whatever zone the
 * browser is in.
 *
 * Timestamps (`issued_at`, `voided_at`) are real instants and are formatted in
 * the user's own zone.
 */

const DATE_ONLY = /^(\d{4})-(\d{2})-(\d{2})$/

/**
 * `YYYY-MM-DD` as a calendar date in `locale`, with no change of day.
 *
 * Anything that is not a valid calendar date is returned as it came, never as
 * `Invalid Date`.
 */
export function formatDateOnly(value: string | null | undefined, locale: string): string {
  if (!value) return ''
  const match = DATE_ONLY.exec(value)
  if (!match) return value

  const year = Number(match[1])
  const month = Number(match[2])
  const day = Number(match[3])
  const moment = new Date(Date.UTC(year, month - 1, day, 12))
  // 31 February rolls over to March: that is not the date that was sent.
  if (
    moment.getUTCFullYear() !== year
    || moment.getUTCMonth() !== month - 1
    || moment.getUTCDate() !== day
  ) {
    return value
  }

  try {
    return new Intl.DateTimeFormat(locale, {
      day: '2-digit',
      month: '2-digit',
      year: 'numeric',
      timeZone: 'UTC'
    }).format(moment)
  } catch {
    return value
  }
}

/** An instant, in the user's own timezone. */
export function formatDateTime(value: string | null | undefined, locale: string): string {
  if (!value) return ''
  const moment = new Date(value)
  if (Number.isNaN(moment.getTime())) return value
  try {
    return new Intl.DateTimeFormat(locale, { dateStyle: 'medium', timeStyle: 'short' }).format(moment)
  } catch {
    return value
  }
}
