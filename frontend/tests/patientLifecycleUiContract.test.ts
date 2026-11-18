import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

const page = readFileSync(
  resolve(process.cwd(), 'module_layers/patients/frontend/pages/patients/[id].vue'),
  'utf8',
)
const header = readFileSync(
  resolve(process.cwd(), 'module_layers/patients/frontend/components/patient/PatientStickyHeader.vue'),
  'utf8',
)

describe('DP-33 patient lifecycle UI contract', () => {
  it('renders archive versus restore actions by patient status', () => {
    expect(header).toContain("props.patient.status === 'archived'")
    expect(header).toContain("label: 'Desarchivar paciente'")
    expect(header).toContain("t('patients.archive')")
  })

  it('gates permanent deletion by permission and exact confirmation', () => {
    expect(page).toContain('canPermanentlyDelete')
    expect(page).toContain("permanentConfirmation.value !== 'ELIMINAR'")
    expect(page).toContain(":disabled=\"permanentConfirmation !== 'ELIMINAR'\"")
  })

  it('uses the permanent endpoint and returns to the patient list on success', () => {
    expect(page).toContain('/permanent')
    expect(page).toContain("confirmation: 'ELIMINAR'")
    expect(page).toContain("router.push('/patients')")
  })
})
