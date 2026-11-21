/** Presentation-only dentition choice. FDI data remains unchanged. */
export type DentitionMode = 'permanent' | 'deciduous'

export interface DentitionSuggestion {
  mode: DentitionMode
  isMixedDentitionAge: boolean
}

export function computeAge(dateOfBirth: string | null | undefined, today = new Date()): number | null {
  if (!dateOfBirth) return null
  const birth = new Date(dateOfBirth)
  if (Number.isNaN(birth.getTime())) return null
  let years = today.getFullYear() - birth.getFullYear()
  const month = today.getMonth() - birth.getMonth()
  if (month < 0 || (month === 0 && today.getDate() < birth.getDate())) years--
  return years
}

export function suggestDentitionByAge(dateOfBirth: string | null | undefined): DentitionSuggestion {
  const age = computeAge(dateOfBirth)
  if (age === null || age >= 12) return { mode: 'permanent', isMixedDentitionAge: false }
  return { mode: 'deciduous', isMixedDentitionAge: age >= 6 }
}
