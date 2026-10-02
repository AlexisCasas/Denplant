/**
 * Clinic logo: what the upload accepts, checked before the file leaves the
 * browser so a wrong file fails at once with a clear message.
 *
 * The server decodes and re-validates every upload (the extension and the
 * declared type are not trusted there either); this is only the fast path, and
 * it mirrors the server's limits (`backend/app/core/clinic_branding.py`).
 */

export const LOGO_MAX_BYTES = 1024 * 1024
export const LOGO_MAX_DIMENSION = 2000
export const LOGO_ACCEPTED_TYPES = ['image/png', 'image/jpeg', 'image/webp'] as const

/** What the form recommends: the PDF draws the logo in a 50 × 20 mm box. */
export const LOGO_RECOMMENDED = { width: 600, height: 240 } as const

export type LogoProblem = 'type' | 'size' | 'empty'

/** `null` when the file may be sent; otherwise why not. SVG is deliberately not accepted. */
export function logoFileProblem(file: Pick<File, 'type' | 'size'>): LogoProblem | null {
  if (!(LOGO_ACCEPTED_TYPES as readonly string[]).includes(file.type)) return 'type'
  if (file.size === 0) return 'empty'
  if (file.size > LOGO_MAX_BYTES) return 'size'
  return null
}

/** The `code` a rejected upload carries, mapped to the message key shown. */
export function logoErrorKey(code: string | undefined): string {
  switch (code) {
    case 'too_large': return 'size'
    case 'unsupported_type': return 'type'
    case 'dimensions': return 'dimensions'
    case 'animated': return 'animated'
    case 'empty': return 'empty'
    default: return 'unreadable'
  }
}
