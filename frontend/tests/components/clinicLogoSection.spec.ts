/**
 * "Identidad visual" in the clinic settings: preview, upload, replace, remove.
 *
 * The composable is replaced (it talks to the server); what is checked is what
 * the section shows and which actions it offers to whom.
 */

import { mockNuxtImport, mountSuspended } from '@nuxt/test-utils/runtime'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { computed, ref } from 'vue'

import ClinicLogoSection from '../../app/components/settings/ClinicLogoSection.vue'

const state = vi.hoisted(() => ({
  permissions: new Set<string>(),
  logo: { value: null as null | { width: number, height: number } },
  previewUrl: { value: null as string | null },
  errorKey: { value: null as string | null },
  upload: vi.fn(),
  remove: vi.fn(),
  loadPreview: vi.fn()
}))

mockNuxtImport('usePermissions', () => () => ({
  can: (permission: string) => state.permissions.has(permission)
}))

mockNuxtImport('useClinicLogo', () => () => ({
  logo: computed(() => state.logo.value),
  previewUrl: computed(() => state.previewUrl.value),
  loading: ref(false),
  saving: ref(false),
  errorKey: computed(() => state.errorKey.value),
  loadPreview: state.loadPreview,
  releasePreview: vi.fn(),
  upload: state.upload,
  remove: state.remove
}))

const WRITE = 'admin.clinic.write'

beforeEach(() => {
  state.permissions = new Set([WRITE])
  state.logo.value = null
  state.previewUrl.value = null
  state.errorKey.value = null
  state.upload.mockReset()
  state.remove.mockReset()
  state.loadPreview.mockReset()
})

async function mountSection() {
  return mountSuspended(ClinicLogoSection)
}

describe('ClinicLogoSection', () => {
  it('without a logo: says so, offers Upload and no Remove', async () => {
    const wrapper = await mountSection()

    expect(wrapper.find('[data-testid="clinic-logo-empty"]').exists()).toBe(true)
    expect(wrapper.find('[data-testid="clinic-logo-image"]').exists()).toBe(false)
    expect(wrapper.find('[data-testid="clinic-logo-upload"]').exists()).toBe(true)
    expect(wrapper.find('[data-testid="clinic-logo-remove"]').exists()).toBe(false)
  })

  it('communicates the recommended size, the limits and that SVG is out', async () => {
    const text = (await mountSection()).text()
    expect(text).toContain('600')
    expect(text).toContain('240')
    expect(text).toContain('2000')
    expect(text).toMatch(/PNG/)
    expect(text).toMatch(/JPEG/)
    expect(text).toMatch(/WebP/)
    expect(text).toMatch(/SVG/)
    expect(text).toContain('50')
    expect(text).toContain('20')
  })

  it('the file picker accepts exactly the three image types', async () => {
    const wrapper = await mountSection()
    expect(wrapper.find('[data-testid="clinic-logo-input"]').attributes('accept'))
      .toBe('image/png,image/jpeg,image/webp')
  })

  it('previews the current logo and shows its size', async () => {
    state.logo.value = { width: 600, height: 240 }
    state.previewUrl.value = 'blob:logo'
    const wrapper = await mountSection()

    expect(wrapper.find('[data-testid="clinic-logo-image"]').attributes('src')).toBe('blob:logo')
    expect(wrapper.find('[data-testid="clinic-logo-meta"]').text()).toContain('600 × 240')
    expect(wrapper.find('[data-testid="clinic-logo-remove"]').exists()).toBe(true)
  })

  it('loads the preview when it mounts', async () => {
    await mountSection()
    expect(state.loadPreview).toHaveBeenCalledTimes(1)
  })

  it('choosing a file uploads it', async () => {
    const wrapper = await mountSection()
    const file = new File([new Uint8Array([1, 2, 3])], 'logo.png', { type: 'image/png' })
    const input = wrapper.find('[data-testid="clinic-logo-input"]')
    Object.defineProperty(input.element, 'files', { value: [file], configurable: true })
    await input.trigger('change')

    expect(state.upload).toHaveBeenCalledTimes(1)
    expect(state.upload).toHaveBeenCalledWith(file)
  })

  it('removing asks first, and only then removes', async () => {
    state.logo.value = { width: 600, height: 240 }
    const wrapper = await mountSection()

    await wrapper.find('[data-testid="clinic-logo-remove"]').trigger('click')
    expect(state.remove).not.toHaveBeenCalled()

    await wrapper.find('[data-testid="clinic-logo-remove-confirm"]').trigger('click')
    expect(state.remove).toHaveBeenCalledTimes(1)
  })

  it('shows why an upload failed', async () => {
    state.errorKey.value = 'size'
    const wrapper = await mountSection()
    expect(wrapper.find('[data-testid="clinic-logo-error"]').exists()).toBe(true)
  })

  it('says already-signed budgets keep their logo', async () => {
    expect((await mountSection()).text()).toMatch(/firmad|signed/i)
  })

  it('without write access it previews but offers no change', async () => {
    state.permissions = new Set()
    state.logo.value = { width: 600, height: 240 }
    state.previewUrl.value = 'blob:logo'
    const wrapper = await mountSection()

    expect(wrapper.find('[data-testid="clinic-logo-image"]').exists()).toBe(true)
    expect(wrapper.find('[data-testid="clinic-logo-upload"]').exists()).toBe(false)
    expect(wrapper.find('[data-testid="clinic-logo-remove"]').exists()).toBe(false)
    expect(wrapper.find('[data-testid="clinic-logo-input"]').exists()).toBe(false)
  })
})
