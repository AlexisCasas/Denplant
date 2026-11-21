import { mockNuxtImport, mountSuspended } from '@nuxt/test-utils/runtime'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { defineComponent, h, nextTick, ref } from 'vue'

import UsersPage from '~/components/settings/pages/UsersPage.vue'
import UserCreateModal from '~/components/settings/users/UserCreateModal.vue'

const state = vi.hoisted(() => ({
  createUser: vi.fn(),
  updateUser: vi.fn(),
  fetchUsers: vi.fn(),
  createInviteLink: vi.fn(),
  deleteUser: vi.fn(),
  users: null as unknown,
  t: (key: string) => key
}))

mockNuxtImport('useI18n', () => () => ({ t: state.t, locale: ref('es') }))
mockNuxtImport('useToast', () => () => ({ add: vi.fn() }))
mockNuxtImport('useAuth', () => () => ({ user: ref({ id: 'admin-1' }) }))
mockNuxtImport('usePermissions', () => () => ({ isAdmin: ref(true) }))
mockNuxtImport('useUsers', () => () => ({
  users: state.users,
  isLoading: ref(false),
  availableRoles: [{ value: 'dentist', label: 'dentist' }],
  fetchUsers: state.fetchUsers,
  createUser: state.createUser,
  updateUser: state.updateUser,
  createInviteLink: state.createInviteLink,
  deleteUser: state.deleteUser
}))

state.users = ref([{
  id: 'dentist-1', email: 'ada@example.test', first_name: 'Ada', last_name: 'Dentist',
  professional_id: 'COL-100', is_active: true, role: 'dentist', is_professional: true,
  created_at: '2026-01-01T00:00:00Z'
}])

const FormField = defineComponent({
  props: { label: { type: String, default: '' }, help: { type: String, default: '' } },
  setup(props, { slots }) {
    return () => h('label', [props.label, slots.default?.(), props.help ? h('small', props.help) : null])
  }
})
const Input = defineComponent({
  inheritAttrs: false,
  props: { modelValue: { type: String, default: '' } },
  emits: ['update:modelValue'],
  setup(props, { attrs, emit }) {
    return () => h('input', {
      ...attrs,
      value: props.modelValue,
      onInput: (event: Event) => emit('update:modelValue', (event.target as HTMLInputElement).value)
    })
  }
})
const Button = defineComponent({
  inheritAttrs: false,
  props: { type: { type: String, default: 'button' } },
  emits: ['click'],
  setup(props, { attrs, emit, slots }) {
    return () => h('button', { ...attrs, type: props.type, onClick: () => emit('click') }, slots.default?.())
  }
})
const Modal = defineComponent({
  setup(_, { slots }) {
    return () => h('div', slots.content?.() ?? slots.default?.())
  }
})
const Card = defineComponent({
  setup(_, { slots }) {
    return () => h('section', [slots.header?.(), slots.default?.()])
  }
})
const Select = defineComponent({
  props: { modelValue: { type: String, default: '' } },
  setup() {
    return () => h('select')
  }
})
const Switch = defineComponent({
  setup() {
    return () => h('input', { type: 'checkbox' })
  }
})

const stubs = {
  UFormField: FormField,
  UInput: Input,
  UButton: Button,
  UModal: Modal,
  UCard: Card,
  USelect: Select,
  USwitch: Switch,
  UAvatar: true,
  UBadge: true,
  UIcon: true,
  UserCreateModal: true
}

async function settle() {
  await nextTick()
  await nextTick()
}

beforeEach(() => {
  state.createUser.mockReset()
  state.updateUser.mockReset()
  state.fetchUsers.mockReset()
  state.createInviteLink.mockReset()
  state.deleteUser.mockReset()
  state.createUser.mockResolvedValue({ id: 'new-user' })
  state.updateUser.mockResolvedValue({ id: 'dentist-1' })
})

afterEach(() => vi.clearAllMocks())

describe('professional registration in user management', () => {
  it('renders the optional creation field and sends its value', async () => {
    const wrapper = await mountSuspended(UserCreateModal, {
      props: { open: true },
      global: { stubs }
    })
    const registration = wrapper.get('input[maxlength="50"]')

    expect(wrapper.text()).toContain('settings.professionalRegistration')
    await registration.setValue(' COL-200 ')
    await wrapper.get('form').trigger('submit')
    await settle()

    expect(state.createUser).toHaveBeenCalledWith(expect.objectContaining({ professional_id: ' COL-200 ' }))
  })

  it('preloads the registration in edit mode and allows it to be cleared', async () => {
    const wrapper = await mountSuspended(UsersPage, { global: { stubs } })
    await settle()
    await wrapper.get('[aria-label="settings.editUser"]').trigger('click')
    await settle()

    const registration = wrapper.get('input[maxlength="50"]')
    expect((registration.element as HTMLInputElement).value).toBe('COL-100')
    await registration.setValue('')
    await wrapper.get('form').trigger('submit')
    await settle()

    expect(state.updateUser).toHaveBeenCalledWith(
      'dentist-1',
      expect.objectContaining({ professional_id: '' })
    )
  })
})
