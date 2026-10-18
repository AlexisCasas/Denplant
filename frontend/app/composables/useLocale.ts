import { STORAGE_KEYS } from '~/constants/storage'
import type { CodeLang } from '~/types'
import { LOCALE_COOKIE_KEY, isSupportedLocale } from '~/utils/localePersistence'

export function useLocale() {
  const { locale, setLocale, locales } = useI18n()

  const availableLocales = computed(() =>
    (locales.value as Array<{ code: CodeLang, name: string }>).map(l => ({
      code: l.code,
      name: l.name
    }))
  )

  async function changeLocale(code: CodeLang): Promise<void> {
    if (!isSupportedLocale(code)) return

    const localeCookie = useCookie<CodeLang | null>(LOCALE_COOKIE_KEY, {
      path: '/',
      sameSite: 'lax'
    })
    localeCookie.value = code

    if (import.meta.client) {
      localStorage.setItem(STORAGE_KEYS.LOCALE, code)
    }
    await setLocale(code)
  }

  return {
    locale,
    currentLocale: computed(() => locale.value),
    availableLocales,
    changeLocale
  }
}
