/**
 * The clinic logo's client-side rules (mirror of the server's limits).
 */

import { describe, expect, it } from 'vitest'

import {
  LOGO_ACCEPTED_TYPES,
  LOGO_MAX_BYTES,
  LOGO_MAX_DIMENSION,
  LOGO_RECOMMENDED,
  logoErrorKey,
  logoFileProblem
} from '../../app/utils/clinicLogo'

describe('logoFileProblem', () => {
  it.each(['image/png', 'image/jpeg', 'image/webp'])('accepts %s', (type) => {
    expect(logoFileProblem({ type, size: 1000 })).toBeNull()
  })

  it.each(['image/svg+xml', 'image/gif', 'application/pdf', 'text/plain', ''])('refuses %s', (type) => {
    expect(logoFileProblem({ type, size: 1000 })).toBe('type')
  })

  it('refuses a file over one megabyte, and accepts exactly one', () => {
    expect(logoFileProblem({ type: 'image/png', size: LOGO_MAX_BYTES })).toBeNull()
    expect(logoFileProblem({ type: 'image/png', size: LOGO_MAX_BYTES + 1 })).toBe('size')
  })

  it('refuses an empty file', () => {
    expect(logoFileProblem({ type: 'image/png', size: 0 })).toBe('empty')
  })

  it('states the agreed limits and recommendation', () => {
    expect(LOGO_MAX_BYTES).toBe(1024 * 1024)
    expect(LOGO_MAX_DIMENSION).toBe(2000)
    expect([...LOGO_ACCEPTED_TYPES]).toEqual(['image/png', 'image/jpeg', 'image/webp'])
    expect(LOGO_RECOMMENDED).toEqual({ width: 600, height: 240 })
    expect(LOGO_RECOMMENDED.width / LOGO_RECOMMENDED.height).toBe(2.5)
  })
})

describe('logoErrorKey', () => {
  it('maps every server code to a message, and unknown ones to "unreadable"', () => {
    expect(logoErrorKey('too_large')).toBe('size')
    expect(logoErrorKey('unsupported_type')).toBe('type')
    expect(logoErrorKey('dimensions')).toBe('dimensions')
    expect(logoErrorKey('animated')).toBe('animated')
    expect(logoErrorKey('unreadable')).toBe('unreadable')
    expect(logoErrorKey(undefined)).toBe('unreadable')
    expect(logoErrorKey('something_new')).toBe('unreadable')
  })
})
