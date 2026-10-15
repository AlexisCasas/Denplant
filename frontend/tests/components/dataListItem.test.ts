import { mountSuspended } from '@nuxt/test-utils/runtime'
import { describe, expect, it, vi } from 'vitest'
import { defineComponent, h } from 'vue'

import DataListItem from '../../app/components/shared/DataListItem.vue'

const navigation = vi.fn()
const NuxtLinkStub = defineComponent({
  name: 'NuxtLink',
  props: { to: { type: String, required: true } },
  setup(props, { slots }) {
    return () => h('a', { href: props.to, onClick: navigation }, slots.default?.())
  }
})

describe('DataListItem contextual actions', () => {
  it('renders an action as a sibling of the row link with an accessible name', async () => {
    const archive = vi.fn()
    const wrapper = await mountSuspended(DataListItem, {
      props: { to: '/patients/patient-1' },
      slots: {
        row: () => h('span', 'Paciente activo'),
        card: () => h('span', 'Paciente activo móvil'),
        actions: () => h('button', { 'aria-label': 'Archivar Paciente activo', 'onClick': archive }, 'Archivar')
      },
      global: { components: { NuxtLink: NuxtLinkStub } }
    })

    const link = wrapper.find('a[href="/patients/patient-1"]')
    const action = wrapper.find('button[aria-label="Archivar Paciente activo"]')
    expect(link.exists()).toBe(true)
    expect(action.exists()).toBe(true)
    expect(wrapper.find('a button').exists()).toBe(false)

    await action.trigger('click')
    expect(archive).toHaveBeenCalledOnce()
    expect(navigation).not.toHaveBeenCalled()
  })

  it('keeps the original linked-row structure when no contextual action exists', async () => {
    const wrapper = await mountSuspended(DataListItem, {
      props: { to: '/patients/patient-1' },
      slots: { row: () => h('span', 'Paciente activo') },
      global: { components: { NuxtLink: NuxtLinkStub } }
    })

    expect(wrapper.element.tagName).toBe('A')
    expect(wrapper.find('button').exists()).toBe(false)
  })
})
