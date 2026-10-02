<script setup lang="ts">
/**
 * ClinicLogoSection — "Identidad visual": the clinic's logo.
 *
 * Upload, preview, replace and remove. The logo belongs to the clinic, not to a
 * document: it is what budgets print today and what any later document can
 * reuse. Changing it affects documents made from now on; a budget that was
 * already signed keeps the file it was signed with.
 */
import { PERMISSIONS } from '~/config/permissions'
import {
  LOGO_ACCEPTED_TYPES,
  LOGO_MAX_BYTES,
  LOGO_MAX_DIMENSION,
  LOGO_RECOMMENDED
} from '~/utils/clinicLogo'

const { t } = useI18n()
const { can } = usePermissions()
const canEdit = computed(() => can(PERMISSIONS.admin.clinicWrite))

const { logo, previewUrl, loading, saving, errorKey, loadPreview, releasePreview, upload, remove } = useClinicLogo()

const input = ref<HTMLInputElement | null>(null)
const confirmingRemove = ref(false)

const accept = LOGO_ACCEPTED_TYPES.join(',')
const maxMb = LOGO_MAX_BYTES / (1024 * 1024)

function choose() {
  input.value?.click()
}

async function onFile(event: Event) {
  const target = event.target as HTMLInputElement
  const file = target.files?.[0]
  target.value = ''
  if (file) await upload(file)
}

async function confirmRemove() {
  confirmingRemove.value = false
  await remove()
}

onMounted(loadPreview)
onBeforeUnmount(releasePreview)
</script>

<template>
  <section
    class="mt-8 pt-6 border-t border-default space-y-4"
    data-testid="clinic-logo-section"
  >
    <div>
      <h3 class="text-sm font-semibold text-default">
        {{ t('settings.logo.title') }}
      </h3>
      <p class="text-caption text-subtle mt-1">
        {{ t('settings.logo.description') }}
      </p>
    </div>

    <div class="flex flex-col sm:flex-row gap-4 sm:items-start">
      <!-- Preview: the same proportions the PDF gives the logo (50 × 20 mm). -->
      <div
        class="flex items-center justify-center rounded-md border border-default bg-surface-muted overflow-hidden shrink-0"
        style="width: 250px; height: 100px"
        data-testid="clinic-logo-preview"
      >
        <USkeleton
          v-if="loading"
          class="h-full w-full"
        />
        <img
          v-else-if="previewUrl"
          :src="previewUrl"
          :alt="t('settings.logo.alt')"
          class="max-w-full max-h-full object-contain"
          data-testid="clinic-logo-image"
        >
        <span
          v-else
          class="text-caption text-subtle px-3 text-center"
          data-testid="clinic-logo-empty"
        >
          {{ t('settings.logo.none') }}
        </span>
      </div>

      <div class="space-y-3 min-w-0">
        <ul class="text-caption text-subtle space-y-1">
          <li>
            {{ t('settings.logo.recommended', { width: LOGO_RECOMMENDED.width, height: LOGO_RECOMMENDED.height }) }}
          </li>
          <li>{{ t('settings.logo.formats', { mb: maxMb, max: LOGO_MAX_DIMENSION }) }}</li>
          <li>{{ t('settings.logo.pdfBox') }}</li>
        </ul>

        <p
          v-if="logo"
          class="text-caption text-muted"
          data-testid="clinic-logo-meta"
        >
          {{ logo.width }} × {{ logo.height }} px
        </p>

        <div
          v-if="canEdit"
          class="flex flex-wrap gap-2"
        >
          <input
            ref="input"
            type="file"
            class="hidden"
            :accept="accept"
            data-testid="clinic-logo-input"
            @change="onFile"
          >
          <UButton
            icon="i-lucide-upload"
            size="sm"
            :loading="saving"
            data-testid="clinic-logo-upload"
            @click="choose"
          >
            {{ logo ? t('settings.logo.replace') : t('settings.logo.upload') }}
          </UButton>
          <UButton
            v-if="logo && !confirmingRemove"
            icon="i-lucide-trash-2"
            size="sm"
            variant="outline"
            color="error"
            :disabled="saving"
            data-testid="clinic-logo-remove"
            @click="confirmingRemove = true"
          >
            {{ t('settings.logo.remove') }}
          </UButton>
          <template v-if="confirmingRemove">
            <UButton
              size="sm"
              color="error"
              :loading="saving"
              data-testid="clinic-logo-remove-confirm"
              @click="confirmRemove"
            >
              {{ t('settings.logo.confirmRemove') }}
            </UButton>
            <UButton
              size="sm"
              variant="ghost"
              @click="confirmingRemove = false"
            >
              {{ t('common.cancel') }}
            </UButton>
          </template>
        </div>

        <p
          v-if="errorKey"
          class="text-sm text-error"
          role="alert"
          data-testid="clinic-logo-error"
        >
          {{ t(`settings.logo.errors.${errorKey}`, { mb: maxMb, max: LOGO_MAX_DIMENSION }) }}
        </p>

        <p class="text-caption text-subtle">
          {{ t('settings.logo.signedNote') }}
        </p>
      </div>
    </div>
  </section>
</template>
