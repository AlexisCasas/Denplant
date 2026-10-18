import type { Composer } from 'vue-i18n'
import { LOCALE_COOKIE_KEY, isSupportedLocale, localeOrDefault } from '~/utils/localePersistence'

/**
 * Makes the interface locale available to both SSR and the first client render.
 * The cookie intentionally remains separate from clinical communication settings.
 */
export default defineNuxtPlugin(async (nuxtApp) => {
  const localeCookie = useCookie<string | null>(LOCALE_COOKIE_KEY, {
    path: '/',
    sameSite: 'lax'
  })
  const locale = localeOrDefault(localeCookie.value)

  // Replace an invalid value with the deterministic fallback. An absent cookie
  // stays absent so the client can migrate the former localStorage preference.
  if (localeCookie.value !== null && localeCookie.value !== undefined && !isSupportedLocale(localeCookie.value)) {
    localeCookie.value = locale
  }

  const i18n = nuxtApp.$i18n as Composer
  if (locale !== i18n.locale.value) {
    await i18n.setLocale(locale)
  }
})
