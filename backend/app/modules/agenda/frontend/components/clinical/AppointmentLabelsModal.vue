<script setup lang="ts">
import type { AppointmentLabel } from '~~/app/types'
import { PERMISSIONS } from '~~/app/config/permissions'
import { errorMessage } from '~~/app/utils/error'

const props = defineProps<{ open: boolean }>()
const emit = defineEmits<{ 'update:open': [value: boolean] }>()
const { t } = useI18n()
const toast = useToast()
const { can } = usePermissions()
const { labels, fetchLabels, saveLabel, deactivateLabel } = useAppointmentLabels()
const editing = ref<AppointmentLabel | null>(null)
const form = reactive({ name: '', color: '#3B82F6' })
const saving = ref(false)

const canWrite = computed(() => can(PERMISSIONS.appointments.write))
const title = computed(() => editing.value ? t('appointments.labels.edit') : t('appointments.labels.new'))

watch(() => props.open, async (open) => {
  if (open) await fetchLabels()
})

function begin(label?: AppointmentLabel) {
  editing.value = label ?? null
  form.name = label?.name ?? ''
  form.color = label?.color ?? '#3B82F6'
}
function reset() {
  begin()
}
function textColor(hex: string): string {
  const rgb = [1, 3, 5].map(index => parseInt(hex.slice(index, index + 2), 16) / 255)
  const l = rgb.map(value => value <= 0.03928 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4).reduce((sum, value, index) => sum + value * [0.2126, 0.7152, 0.0722][index]!, 0)
  return l > 0.45 ? '#111827' : '#FFFFFF'
}

async function save() {
  if (!canWrite.value) return
  saving.value = true
  try {
    await saveLabel({ name: form.name, color: form.color }, editing.value?.id)
    toast.add({ title: t('common.success'), description: t('appointments.labels.saved'), color: 'success' })
    reset()
  } catch (error) {
    toast.add({ title: t('common.error'), description: errorMessage(error, t('appointments.labels.saveError')), color: 'error' })
  } finally { saving.value = false }
}
async function deactivate(label: AppointmentLabel) {
  if (!canWrite.value) return
  try {
    await deactivateLabel(label.id)
    toast.add({ title: t('common.success'), description: t('appointments.labels.deactivated'), color: 'success' })
  } catch (error) {
    toast.add({ title: t('common.error'), description: errorMessage(error, t('appointments.labels.saveError')), color: 'error' })
  }
}
</script>

<template>
  <UModal
    :open="open"
    @update:open="emit('update:open', $event)"
  >
    <template #content>
      <UCard class="sm:max-w-lg">
        <template #header>
          <h2 class="text-h2">
            {{ t('appointments.labels.title') }}
          </h2>
        </template>
        <div class="space-y-4">
          <div
            v-if="canWrite"
            class="space-y-3 rounded-token-md border border-default p-3"
          >
            <p class="text-sm font-medium">
              {{ title }}
            </p>
            <UFormField :label="t('appointments.labels.name')">
              <UInput
                v-model="form.name"
                :maxlength="40"
              />
            </UFormField>
            <UFormField :label="t('appointments.labels.color')">
              <div class="flex items-center gap-2">
                <input
                  v-model="form.color"
                  type="color"
                  class="h-9 w-12 rounded border border-default"
                ><UInput
                  v-model="form.color"
                  class="flex-1"
                />
              </div>
            </UFormField>
            <div class="flex items-center justify-between gap-3">
              <UBadge
                :label="form.name || t('appointments.labels.preview')"
                :style="{ backgroundColor: form.color, color: textColor(form.color) }"
              /><div class="flex gap-2">
                <UButton
                  v-if="editing"
                  variant="ghost"
                  @click="reset"
                >
                  {{ t('common.cancel') }}
                </UButton><UButton
                  :loading="saving"
                  @click="save"
                >
                  {{ t('common.save') }}
                </UButton>
              </div>
            </div>
          </div>
          <div class="space-y-2">
            <p
              v-if="!labels.length"
              class="text-sm text-muted"
            >
              {{ t('appointments.labels.empty') }}
            </p>
            <div
              v-for="label in labels"
              :key="label.id"
              class="flex items-center gap-3 rounded-token-md border border-default p-2"
              :class="!label.is_active && 'opacity-60'"
            >
              <span
                class="h-4 w-4 rounded-full shrink-0"
                :style="{ backgroundColor: label.color }"
              />
              <span class="min-w-0 flex-1 truncate">{{ label.name }}</span>
              <UBadge
                v-if="!label.is_active"
                :label="t('appointments.labels.inactive')"
                size="xs"
              />
              <template v-if="canWrite && label.is_active">
                <UButton
                  size="xs"
                  variant="ghost"
                  icon="i-lucide-pencil"
                  :aria-label="t('common.edit')"
                  @click="begin(label)"
                /><UButton
                  size="xs"
                  variant="ghost"
                  color="error"
                  icon="i-lucide-archive"
                  :aria-label="t('appointments.labels.deactivate')"
                  @click="deactivate(label)"
                />
              </template>
            </div>
          </div>
        </div>
      </UCard>
    </template>
  </UModal>
</template>
