import { SUPPORTED_LOCALES } from '~/constants/languages'
import type { CodeLang } from '~/types'

export const LOCALE_COOKIE_KEY = 'dentalpin_locale'

export function isSupportedLocale(value: unknown): value is CodeLang {
  return typeof value === 'string' && SUPPORTED_LOCALES.includes(value as CodeLang)
}

export function localeOrDefault(value: unknown): CodeLang {
  return isSupportedLocale(value) ? value : 'en'
}
