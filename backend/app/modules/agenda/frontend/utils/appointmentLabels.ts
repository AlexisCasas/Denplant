export const SUGGESTED_APPOINTMENT_LABELS = [
  { name: 'Agendado', color: '#9CA3AF' },
  { name: 'Confirmado', color: '#2563EB' },
  { name: 'En sala de espera', color: '#FACC15' },
  { name: 'En atención', color: '#F97316' },
  { name: 'Atendido', color: '#22C55E' },
  { name: 'Cancelado', color: '#111827' },
  { name: 'No asistió', color: '#EF4444' },
  { name: 'Reprogramado', color: '#7C3AED' }
] as const

export function missingSuggestedLabels(existingNames: Iterable<string>) {
  const normalized = new Set(Array.from(existingNames, name => name.trim().toLocaleLowerCase()))
  return SUGGESTED_APPOINTMENT_LABELS.filter(label => !normalized.has(label.name.toLocaleLowerCase()))
}

function relativeLuminance(hex: string): number {
  const values = [1, 3, 5].map(index => parseInt(hex.slice(index, index + 2), 16) / 255)
  return values
    .map(value => value <= 0.03928 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4)
    .reduce((sum, value, index) => sum + value * [0.2126, 0.7152, 0.0722][index]!, 0)
}

export function contrastRatio(foreground: string, background: string): number {
  const [light, dark] = [relativeLuminance(foreground), relativeLuminance(background)].sort((a, b) => b - a)
  return (light + 0.05) / (dark + 0.05)
}

/** Returns the more legible WCAG candidate for a label background. */
export function labelTextColor(background: string): '#111827' | '#FFFFFF' {
  const dark = contrastRatio('#111827', background)
  const light = contrastRatio('#FFFFFF', background)
  return dark >= light ? '#111827' : '#FFFFFF'
}
