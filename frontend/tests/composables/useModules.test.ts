import { mockNuxtImport } from '@nuxt/test-utils/runtime'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const apiGet = vi.hoisted(() => vi.fn())
const auth = vi.hoisted(() => ({
  accessToken: { value: 'session-token' },
  sessionGeneration: { value: 1 },
  user: { value: { id: 'user-1' } }
}))

mockNuxtImport('useApi', () => () => ({ get: apiGet }))
mockNuxtImport('useAuth', () => () => auth)
mockNuxtImport('usePermissions', () => () => ({ can: () => true }))
mockNuxtImport('useI18n', () => () => ({ t: (key: string) => key }))

function resetState() {
  useState('modules:active').value = null
  useState('modules:active:loading').value = false
  useState('modules:active:error').value = null
  useState('modules:active:at').value = 0
}

beforeEach(() => {
  resetState()
  apiGet.mockReset()
  auth.accessToken.value = 'session-token'
  auth.sessionGeneration.value = 1
  auth.user.value = { id: 'user-1' }
})

afterEach(() => {
  resetState()
})

describe('useModules().ensureLoaded', () => {
  it('waits for an already-running module request instead of resolving with null', async () => {
    let resolveRequest!: (value: { data: Array<{ name: string, navigation: never[], permissions: never[], version: string, category: 'official', summary: string }> }) => void
    apiGet.mockReturnValue(new Promise((resolve) => {
      resolveRequest = resolve
    }))

    const first = (await import('~/composables/useModules')).useModules().ensureLoaded()
    const second = (await import('~/composables/useModules')).useModules().ensureLoaded()

    expect(apiGet).toHaveBeenCalledTimes(1)

    // This assertion reproduces the landing-page race: before the fix,
    // awaiting the second caller leaves `active` at null.
    let secondResolved = false
    second.then(() => {
      secondResolved = true
    })
    await Promise.resolve()
    expect(secondResolved).toBe(false)

    resolveRequest({
      data: [{
        name: 'agenda',
        navigation: [],
        permissions: [],
        version: '1.0.0',
        category: 'official',
        summary: 'Agenda'
      }]
    })

    await Promise.all([first, second])
    expect(useActiveModulesState().value?.map(module => module.name)).toEqual(['agenda'])
  })

  it('does not apply a stale response after the session token changes', async () => {
    type ModuleResponse = {
      data: Array<{ name: string, navigation: never[], permissions: never[], version: string, category: 'official', summary: string }>
    }
    let resolvePrevious!: (value: ModuleResponse) => void
    let resolveCurrent!: (value: ModuleResponse) => void
    apiGet
      .mockImplementationOnce(() => new Promise<ModuleResponse>((resolve) => {
        resolvePrevious = resolve
      }))
      .mockImplementationOnce(() => new Promise<ModuleResponse>((resolve) => {
        resolveCurrent = resolve
      }))

    const { useModules } = await import('~/composables/useModules')
    const previousLoad = useModules().ensureLoaded()
    auth.accessToken.value = null
    auth.sessionGeneration.value += 1
    auth.accessToken.value = 'new-session-token'
    auth.user.value = { id: 'user-2' }
    const currentLoad = useModules().ensureLoaded(true)

    expect(apiGet).toHaveBeenCalledTimes(2)

    resolvePrevious({
      data: [{ name: 'agenda', navigation: [], permissions: [], version: '1.0.0', category: 'official', summary: 'Old session' }]
    })
    await previousLoad
    expect(useActiveModulesState().value).toBeNull()

    resolveCurrent({
      data: [{ name: 'patients', navigation: [], permissions: [], version: '1.0.0', category: 'official', summary: 'Current session' }]
    })
    await currentLoad
    expect(useActiveModulesState().value?.map(module => module.name)).toEqual(['patients'])
  })

  it('does not apply a stale response after logout/login with the same account', async () => {
    type ModuleResponse = {
      data: Array<{ name: string, navigation: never[], permissions: never[], version: string, category: 'official', summary: string }>
    }
    let resolvePrevious!: (value: ModuleResponse) => void
    let resolveCurrent!: (value: ModuleResponse) => void
    apiGet
      .mockImplementationOnce(() => new Promise<ModuleResponse>((resolve) => {
        resolvePrevious = resolve
      }))
      .mockImplementationOnce(() => new Promise<ModuleResponse>((resolve) => {
        resolveCurrent = resolve
      }))

    const { useModules } = await import('~/composables/useModules')
    const previousLoad = useModules().ensureLoaded()
    auth.accessToken.value = null
    auth.sessionGeneration.value += 1
    auth.accessToken.value = 'new-session-token'
    const currentLoad = useModules().ensureLoaded(true)

    resolvePrevious({
      data: [{ name: 'agenda', navigation: [], permissions: [], version: '1.0.0', category: 'official', summary: 'Previous login' }]
    })
    await previousLoad
    expect(useActiveModulesState().value).toBeNull()

    resolveCurrent({
      data: [{ name: 'patients', navigation: [], permissions: [], version: '1.0.0', category: 'official', summary: 'Current login' }]
    })
    await currentLoad
    expect(useActiveModulesState().value?.map(module => module.name)).toEqual(['patients'])
  })

  it('applies the module response retried after useApi refreshes the current user token', async () => {
    // Models useApi's 401 flow: it refreshes token A to token B, retries the
    // same request and returns the successful module payload to this caller.
    apiGet.mockImplementation(async () => {
      auth.accessToken.value = 'refreshed-session-token'
      return {
        data: [{ name: 'agenda', navigation: [], permissions: [], version: '1.0.0', category: 'official', summary: 'Agenda' }]
      }
    })
    const { useModules } = await import('~/composables/useModules')
    const { resolveDefaultLanding } = await import('~/utils/defaultLanding')

    await useModules().ensureLoaded()

    expect(useActiveModulesState().value?.map(module => module.name)).toEqual(['agenda'])
    expect(resolveDefaultLanding({
      activeModules: useActiveModulesState().value,
      permissions: ['agenda.appointments.read']
    })).toBe('/appointments')
  })

  it('settles on a failed request so the landing resolver can use its dashboard fallback', async () => {
    apiGet.mockRejectedValue(new Error('offline'))
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined)
    const { useModules } = await import('~/composables/useModules')
    const { resolveDefaultLanding } = await import('~/utils/defaultLanding')

    await useModules().ensureLoaded()

    expect(useActiveModulesState().value).toBeNull()
    expect(resolveDefaultLanding({
      activeModules: useActiveModulesState().value,
      permissions: ['agenda.appointments.read']
    })).toBe('/dashboard')
    warn.mockRestore()
  })
})
