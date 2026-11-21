import { describe, expect, it } from 'vitest'
import {
  contrastRatio,
  labelTextColor,
  missingSuggestedLabels,
  SUGGESTED_APPOINTMENT_LABELS
} from '../../../backend/app/modules/agenda/frontend/utils/appointmentLabels'

describe('suggested appointment labels', () => {
  it('contains the approved eight names and editable initial colours', () => {
    expect(SUGGESTED_APPOINTMENT_LABELS).toEqual([
      { name: 'Agendado', color: '#9CA3AF' },
      { name: 'Confirmado', color: '#2563EB' },
      { name: 'En sala de espera', color: '#FACC15' },
      { name: 'En atención', color: '#F97316' },
      { name: 'Atendido', color: '#22C55E' },
      { name: 'Cancelado', color: '#111827' },
      { name: 'No asistió', color: '#EF4444' },
      { name: 'Reprogramado', color: '#7C3AED' }
    ])
  })

  it.each(SUGGESTED_APPOINTMENT_LABELS)('selects WCAG-readable text for $name', ({ color }) => {
    expect(contrastRatio(labelTextColor(color), color)).toBeGreaterThanOrEqual(4.5)
  })

  it('is idempotent and preserves existing names case-insensitively', () => {
    expect(missingSuggestedLabels(['agendado', 'CONFIRMADO'])).toHaveLength(6)
    expect(missingSuggestedLabels(SUGGESTED_APPOINTMENT_LABELS.map(label => label.name))).toEqual([])
  })
})
