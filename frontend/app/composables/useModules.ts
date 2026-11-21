/**
 * Backend-driven module + navigation registry.
 *
 * Fetches ``GET /api/v1/modules/-/active`` once per session and caches
 * the result in :func:`useState`. The sidebar consumes
 * ``navigationItems`` — entries are permission-filtered on the server
 * and re-translated client-side via i18n. ``ensureLoaded`` is
 * idempotent so guards / layouts can call it without coordinating.
 *
 * If the fetch fails the sidebar shows only the host shell entries
 * (dashboard + settings); module-owned items are gated on the backend
 * response.
 */

import type { ActiveModule, ApiResponse, NavigationItem } from '~/types'

// Host shell nav: dashboard + settings belong to the host app, not to
// any module. Always rendered, even when the modules endpoint fails.
const HOST_NAV: NavigationItem[] = [
  {
    label: 'nav.panel',
    icon: 'i-lucide-home',
    to: '/dashboard',
    order: 0
  },
  {
    label: 'nav.settings',
    icon: 'i-lucide-settings',
    to: '/settings',
    order: 900
  }
]

interface InFlightModuleLoad {
  token: string
  promise: Promise<void>
}

interface ModuleLoadContext {
  inFlight?: InFlightModuleLoad
  loadedToken?: string
}

// Nuxt creates an app instance per SSR request, while the browser keeps one
// instance for its session. A WeakMap therefore deduplicates callers within
// one request/session without serializing a Promise into `useState` or
// sharing module data across SSR requests.
const moduleLoadContexts = new WeakMap<object, ModuleLoadContext>()

function moduleLoadContextFor(nuxtApp: object): ModuleLoadContext {
  let context = moduleLoadContexts.get(nuxtApp)
  if (!context) {
    context = {}
    moduleLoadContexts.set(nuxtApp, context)
  }
  return context
}

/** Context-free read of the active-module list (only ``useState``). */
export function useActiveModulesState() {
  return useState<ActiveModule[] | null>('modules:active', () => null)
}

export function useModules() {
  const { t } = useI18n()
  const { can } = usePermissions()
  const auth = useAuth()
  const api = useApi()

  const active = useActiveModulesState()
  const loading = useState<boolean>('modules:active:loading', () => false)
  const error = useState<string | null>('modules:active:error', () => null)
  const lastLoadedAt = useState<number>('modules:active:at', () => 0)

  async function ensureLoaded(force = false): Promise<void> {
    const token = auth.accessToken.value
    if (!token) return
    const sessionGeneration = auth.sessionGeneration.value

    // `useApi` may replace an expired access token after a 401 and retry the
    // same request. The generation changes for logout/login (including the
    // same account) but not for an in-session refresh.
    const belongsToCurrentSession = () =>
      auth.sessionGeneration.value === sessionGeneration

    const context = moduleLoadContextFor(useNuxtApp())
    if (context.inFlight?.token === token) {
      return context.inFlight.promise
    }

    const age = Date.now() - lastLoadedAt.value
    const FRESH_MS = 60_000 // 1 min — cheap enough to refetch often
    if (!force && active.value !== null && age < FRESH_MS) {
      // Hydrated SSR state has no client-side context yet. It belongs to the
      // current token; later token changes are compared against this value.
      context.loadedToken ??= token
      if (context.loadedToken === token) return
    }

    const run = (async () => {
      loading.value = true
      error.value = null
      try {
        const response = await api.get<ApiResponse<ActiveModule[]>>(
          '/api/v1/modules/-/active'
        )

        // Accept a token refresh for the same user, but never let a previous
        // user's response replace data after logout/login in this browser.
        if (belongsToCurrentSession()) {
          active.value = response.data
          lastLoadedAt.value = Date.now()
          context.loadedToken = token
        }
      } catch (err) {
        if (belongsToCurrentSession()) {
          error.value = err instanceof Error ? err.message : 'Failed to load modules'
          console.warn('useModules: backend fetch failed —', error.value)
          active.value = null
        }
      } finally {
        if (context.inFlight?.promise === run) {
          context.inFlight = undefined
          loading.value = false
        }
      }
    })()

    context.inFlight = { token, promise: run }
    return run
  }

  const modules = computed(() => {
    if (!active.value) return []
    return active.value.map(m => ({
      name: m.name,
      label: m.name,
      icon: '',
      navigation: m.navigation
    }))
  })

  const navigationItems = computed<NavigationItem[]>(() => {
    // Hold off filtering until auth has hydrated. Without this, an early
    // evaluation with empty permissions strips every nav entry that
    // declares a permission, leaving the sidebar at just "Inicio".
    if (!auth.user.value) return []

    const moduleNav = active.value
      ? active.value.flatMap(m => m.navigation)
      : []

    return [...HOST_NAV, ...moduleNav]
      .filter(item => !item.permission || can(item.permission))
      .slice()
      .sort((a, b) => (a.order ?? 999) - (b.order ?? 999))
      .map(item => ({ ...item, label: t(item.label) }))
  })

  return {
    modules,
    navigationItems,
    active,
    loading,
    error,
    ensureLoaded
  }
}
