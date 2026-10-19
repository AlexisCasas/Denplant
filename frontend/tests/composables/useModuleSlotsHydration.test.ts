import { describe, expect, it, beforeEach } from 'vitest'
import { defineComponent, h, nextTick, computed } from 'vue'
import { clearNuxtState } from '#app'
import { mountSuspended } from '@nuxt/test-utils/runtime'

// DP-08.C2.A-R9A — the slot registry is filled by `*.client.ts` plugins,
// so SSR renders with an empty registry while the first client render
// would see entries. `resolveSlot` must therefore return [] until the
// `modules:slots:ready` barrier (flipped on `app:suspense:resolve`) is raised.

const Demo = (name: string) => defineComponent({ name, render: () => h('span', name) })

async function api() {
  return await import('~/composables/useModuleSlots')
}

describe('slots hydration barrier', () => {
  beforeEach(async () => {
    const { clearSlots, useSlotsReady } = await api()
    clearSlots()
    useSlotsReady().value = false
  })

  it('SSR: nothing registered and not ready resolves to an empty list', async () => {
    const { resolveSlot, useSlotsReady } = await api()
    expect(useSlotsReady().value).toBe(false)
    expect(resolveSlot('dashboard.hero', {}, { can: () => true })).toEqual([])
  })

  it('first hydration: client registrations already present stay hidden until ready', async () => {
    const { registerSlot, resolveSlot } = await api()
    registerSlot('dashboard.hero', { id: 'a', component: Demo('A') })
    // Same structure the SSR HTML had (nothing), despite the registry being filled.
    expect(resolveSlot('dashboard.hero', {}, { can: () => true })).toEqual([])
  })

  it('activates after mount and stays reactive', async () => {
    const { registerSlot, resolveSlot, useSlotsReady } = await api()
    registerSlot('s', { id: 'a', component: Demo('A') })
    const seen = computed(() => resolveSlot('s', {}, { can: () => true }).map(e => e.id))
    expect(seen.value).toEqual([])
    useSlotsReady().value = true
    expect(seen.value).toEqual(['a'])
    registerSlot('s', { id: 'b', component: Demo('B'), order: -5 })
    expect(seen.value).toEqual(['b', 'a'])
  })

  it('keeps permissions, conditions and order once ready', async () => {
    const { registerSlot, resolveSlot, useSlotsReady } = await api()
    useSlotsReady().value = true
    registerSlot('s', { id: 'late', component: Demo('L'), order: 30 })
    registerSlot('s', { id: 'gated', component: Demo('G'), order: 10, permission: 'x.y' })
    registerSlot('s', { id: 'cond', component: Demo('C'), order: 20, condition: (c: { ok: boolean }) => c.ok })
    expect(resolveSlot('s', { ok: true }, { can: () => true }).map(e => e.id)).toEqual(['gated', 'cond', 'late'])
    expect(resolveSlot('s', { ok: false }, { can: () => false }).map(e => e.id)).toEqual(['late'])
  })

  it('register/unregister/clear keep working after activation', async () => {
    const { registerSlot, unregisterSlot, clearSlots, resolveSlot, useSlotsReady } = await api()
    useSlotsReady().value = true
    registerSlot('s', { id: 'a', component: Demo('A') })
    registerSlot('s', { id: 'b', component: Demo('B') })
    unregisterSlot('s', 'a')
    expect(resolveSlot('s', {}, { can: () => true }).map(e => e.id)).toEqual(['b'])
    clearSlots('s')
    expect(resolveSlot('s', {}, { can: () => true })).toEqual([])
  })

  it('SPA navigation: ready is not reset by remounting consumers', async () => {
    const { registerSlot, useModuleSlots, useSlotsReady } = await api()
    registerSlot('nav', { id: 'a', component: Demo('A') })
    const Consumer = defineComponent({
      setup() {
        const { resolve } = useModuleSlots()
        return () => h('div', { 'data-n': resolve('nav', {}).length })
      }
    })
    const first = await mountSuspended(Consumer)
    expect(first.attributes('data-n')).toBe('0')
    useSlotsReady().value = true
    await nextTick()
    expect(first.attributes('data-n')).toBe('1')
    first.unmount()
    const second = await mountSuspended(Consumer)
    expect(second.attributes('data-n')).toBe('1')
  })

  it('request isolation: the flag is per-app useState, not module-global', async () => {
    const { useSlotsReady } = await api()
    useSlotsReady().value = true
    // A new request/app starts from a cleared state tree.
    clearNuxtState('modules:slots:ready')
    expect(useSlotsReady().value).toBe(false)
  })

  it('exposes `ready` through useModuleSlots for waiting-state consumers', async () => {
    const { useModuleSlots, useSlotsReady } = await api()
    const { ready } = useModuleSlots()
    expect(ready.value).toBe(false)
    useSlotsReady().value = true
    expect(ready.value).toBe(true)
  })
})
