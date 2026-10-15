import { describe, expect, it } from 'vitest'
import { parseListFilters, serializeListFilter } from '../../app/composables/useListQuery'

const defaults = {
  q: '',
  status: ['active'],
  city: '',
  do_not_contact: null as boolean | null
}

describe('useListQuery status URL synchronization', () => {
  it('uses active as the default when status is omitted or empty', () => {
    expect(parseListFilters(defaults, {}).status).toEqual(['active'])
    expect(parseListFilters(defaults, { status: '' }).status).toEqual(['active'])
  })

  it('rehydrates archived and combined selections from the URL', () => {
    expect(parseListFilters(defaults, { status: 'archived' }).status).toEqual(['archived'])
    expect(parseListFilters(defaults, { status: 'active,archived' }).status).toEqual([
      'active',
      'archived'
    ])
  })

  it('omits a cleared status from the URL so a reload restores the active default', () => {
    const serialized = serializeListFilter([])
    expect(serialized).toBeNull()
    expect(parseListFilters(defaults, serialized === null ? {} : { status: serialized }).status).toEqual([
      'active'
    ])
  })

  it('keeps selected filters serializable for browser history navigation', () => {
    expect(serializeListFilter(['archived'])).toBe('archived')
    expect(serializeListFilter(['active', 'archived'])).toBe('active,archived')
  })
})
