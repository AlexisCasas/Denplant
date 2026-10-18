import { STORAGE_KEYS } from '~/constants/storage'
import type { Composer } from 'vue-i18n'
import { LOCALE_COOKIE_KEY, isSupportedLocale } from '~/utils/localePersistence'

/**
 * One-time compatibility bridge for locales saved before the SSR cookie existed.
 * It deliberately runs after hydration, so a legacy localStorage value cannot
 * change the client's initial tree away from the HTML sent by the server.
 */
export default defineNuxtPlugin((nuxtApp) => {
  nuxtApp.hook('app:mounted', async () => {
    const localeCookie = useCookie<string | null>(LOCALE_COOKIE_KEY, {
      path: '/',
      sameSite: 'lax'
    })

    if (isSupportedLocale(localeCookie.value)) return

    const legacyLocale = localStorage.getItem(STORAGE_KEYS.LOCALE)
    if (!isSupportedLocale(legacyLocale)) return

    localeCookie.value = legacyLocale
    const i18n = nuxtApp.$i18n as Composer
    if (legacyLocale !== i18n.locale.value) {
      await i18n.setLocale(legacyLocale)
    }
  })
})
