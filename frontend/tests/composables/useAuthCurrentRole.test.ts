/**
 * `useAuth().currentRole`: the role of the current clinic membership.
 *
 * It comes from `/auth/me` -> `clinics[0].role` and from nowhere else (the
 * backend acts on the first membership when no clinic is named). It is not
 * `user.role`, which the API never sends, and it is never derived from
 * permissions, a wildcard or a professional id.
 */

import { mockNuxtImport } from '@nuxt/test-utils/runtime'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ref } from 'vue'

import { useAuth } from '../../app/composables/useAuth'

const fetchMock = vi.fn()

// A real cookie is written asynchronously; plain refs keep the tests about the role.
const cookies = vi.hoisted(() => ({} as Record<string, { value: string | null }>))
mockNuxtImport('useCookie', () => (name: string) => {
  cookies[name] ??= ref<string | null>(null) as { value: string | null }
  return cookies[name]
})

const me = (clinics: Array<{ id: string, name: string, role: string }>, permissions = ['patients.read']) => ({
  data: {
    user: { id: 'u1', email: 'a@b.c', first_name: 'A', last_name: 'B', is_active: true },
    clinics,
    permissions
  }
})
const clinic = (role: string) => ({ id: 'c1', name: 'Clinic', role })
const tokens = (role = 'dentist') => ({
  access_token: 'acc-2',
  refresh_token: 'ref-2',
  token_type: 'bearer',
  user: me([clinic(role)]).data.user,
  clinics: [clinic(role)]
})

const cookie = (name: string) => useCookie(name) as { value: string | null }

function reset() {
  useState('auth:user').value = null
  useState('auth:permissions').value = []
  useState('auth:currentRole').value = null
  for (const name of Object.keys(cookies)) cookies[name]!.value = null
}

beforeEach(() => {
  reset()
  fetchMock.mockReset()
  vi.stubGlobal('$fetch', fetchMock)
})

afterEach(() => {
  reset()
  vi.unstubAllGlobals()
})

describe('useAuth().currentRole', () => {
  it('is null before anyone is signed in', () => {
    expect(useAuth().currentRole.value).toBeNull()
  })

  it('fetchUser takes the role of the first membership', async () => {
    cookie('access_token').value = 'acc'
    fetchMock.mockResolvedValue(me([clinic('dentist')]))
    const auth = useAuth()

    await auth.fetchUser()

    expect(auth.currentRole.value).toBe('dentist')
  })

  it.each(['admin', 'dentist', 'hygienist', 'assistant', 'receptionist'])('keeps %s', async (role) => {
    cookie('access_token').value = 'acc'
    fetchMock.mockResolvedValue(me([clinic(role)]))
    const auth = useAuth()

    await auth.fetchUser()

    expect(auth.currentRole.value).toBe(role)
  })

  it('uses the first membership, the one the backend acts on', async () => {
    cookie('access_token').value = 'acc'
    fetchMock.mockResolvedValue(me([clinic('hygienist'), clinic('admin')]))
    const auth = useAuth()

    await auth.fetchUser()

    expect(auth.currentRole.value).toBe('hygienist')
  })

  it('is null when there are no memberships', async () => {
    cookie('access_token').value = 'acc'
    fetchMock.mockResolvedValue(me([]))
    const auth = useAuth()

    await auth.fetchUser()

    expect(auth.currentRole.value).toBeNull()
  })

  it('is null for a role it does not know', async () => {
    cookie('access_token').value = 'acc'
    fetchMock.mockResolvedValue(me([clinic('superuser')]))
    const auth = useAuth()

    await auth.fetchUser()

    expect(auth.currentRole.value).toBeNull()
  })

  it('is never inferred from permissions: an admin wildcard says nothing about a dentist', async () => {
    cookie('access_token').value = 'acc'
    fetchMock.mockResolvedValue(me([clinic('receptionist')], ['*', 'prescriptions.prescribe']))
    const auth = useAuth()

    await auth.fetchUser()

    expect(auth.currentRole.value).toBe('receptionist')
  })

  it('does not touch what User.role means: the user object is left as the API sent it', async () => {
    cookie('access_token').value = 'acc'
    fetchMock.mockResolvedValue(me([clinic('dentist')]))
    const auth = useAuth()

    await auth.fetchUser()

    expect(auth.user.value).not.toHaveProperty('role')
  })

  it('login ends with the role, through applyTokens -> fetchUser', async () => {
    fetchMock
      .mockResolvedValueOnce({ access_token: 'a', refresh_token: 'r', token_type: 'bearer' })
      .mockResolvedValueOnce(me([clinic('dentist')]))
    const auth = useAuth()

    await auth.login({ email: 'a@b.c', password: 'x' })

    expect(auth.currentRole.value).toBe('dentist')
    expect(fetchMock.mock.calls[1]![0]).toBe('/api/v1/auth/me')
  })

  it('refresh updates it from the /me it already makes', async () => {
    cookie('refresh_token').value = 'ref'
    useState('auth:currentRole').value = 'dentist'
    fetchMock
      .mockResolvedValueOnce(tokens('admin'))
      .mockResolvedValueOnce(me([clinic('admin')]))
    const auth = useAuth()

    expect(await auth.refresh()).toBe(true)

    expect(auth.currentRole.value).toBe('admin')
  })

  it('a failed refresh logs out and clears it', async () => {
    cookie('refresh_token').value = 'ref'
    useState('auth:currentRole').value = 'dentist'
    fetchMock.mockRejectedValue(new Error('expired'))
    const auth = useAuth()

    expect(await auth.refresh()).toBe(false)

    expect(auth.currentRole.value).toBeNull()
  })

  it('logout clears it', async () => {
    useState('auth:currentRole').value = 'admin'
    const auth = useAuth()

    await auth.logout()

    expect(auth.currentRole.value).toBeNull()
  })

  it('init failure clears it', async () => {
    cookie('access_token').value = 'acc'
    useState('auth:currentRole').value = 'dentist'
    fetchMock.mockRejectedValue({ statusCode: 500 })
    const auth = useAuth()

    await auth.init()

    expect(auth.currentRole.value).toBeNull()
  })

  it('is shared state, so a hydrated value is visible to every caller', () => {
    useState('auth:currentRole').value = 'dentist'

    expect(useAuth().currentRole.value).toBe('dentist')
    expect(useAuth().currentRole.value).toBe('dentist')
  })

  it('is exposed read-only', () => {
    const auth = useAuth()
    const attempt = () => {
      ;(auth.currentRole as { value: unknown }).value = 'admin'
    }

    attempt()

    expect(auth.currentRole.value).toBeNull()
  })
})
