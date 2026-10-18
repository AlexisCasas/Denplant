import { describe, expect, it } from 'vitest'
import { LOCALE_COOKIE_KEY, isSupportedLocale, localeOrDefault } from '../../app/utils/localePersistence'

describe('locale persistence contract', () => {
  it.each(['en', 'es', 'fr', 'pt', 'ta'])('accepts supported locale %s', (locale) => {
    expect(isSupportedLocale(locale)).toBe(true)
    expect(localeOrDefault(locale)).toBe(locale)
  })

  it.each([undefined, null, '', 'de', 'ES', {}, 1])('falls back deterministically for %j', (locale) => {
    expect(isSupportedLocale(locale)).toBe(false)
    expect(localeOrDefault(locale)).toBe('en')
  })

  it('uses a dedicated UI cookie key', () => {
    expect(LOCALE_COOKIE_KEY).toBe('dentalpin_locale')
  })
})
