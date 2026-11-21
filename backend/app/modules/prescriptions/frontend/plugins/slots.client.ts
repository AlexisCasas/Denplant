import { defineAsyncComponent } from 'vue'
import { registerSlot } from '~~/app/composables/useModuleSlots'

/**
 * Slot registrations for the prescriptions module.
 *
 * `patients` exposes the stable slot name and never imports this module: the
 * slot registry is the only contract.
 */
export default defineNuxtPlugin(() => {
  // Clinical tab -> Recetas: the patient's prescriptions, read-only.
  // The entry only renders for users who may read prescriptions.
  registerSlot('patient.clinical.prescriptions', {
    id: 'prescriptions.patient.clinical.prescriptions',
    component: defineAsyncComponent(
      () => import('../components/PrescriptionsView.vue')
    ),
    order: 10,
    permission: 'prescriptions.read'
  })
})
