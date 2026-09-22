<script setup lang="ts">
/**
 * NtsRecordHistory — the patient's odontograms, and a way into them.
 *
 * NTS §5.10 lists four occasions for a new odontogram and §5.11 adds
 * re-entry after a completed plan, so a patient accumulates records by
 * design. This turns the read-only list 05A shipped into a selector that
 * opens one, read-only.
 *
 * Every record listed here may have been written under a different norm
 * version, and each carries its own. That is why the version is shown when
 * it differs: two odontograms of the same patient can legitimately be drawn
 * under different rules, and the reader should be able to see which.
 *
 * It only says what `NtsRecordSummary` actually contains. There are no actor
 * names in a summary, so no column promises one.
 */

import type { NtsRecordSummary } from '../../types/nts'

const props = defineProps<{
  records: readonly NtsRecordSummary[]
  /** The record currently open from the history, if any. */
  openId: string | null
  /**
   * The record the lifecycle considers current — the open draft, else the one
   * in force. Distinct from `openId`: "the current odontogram" and "the one on
   * screen" are different facts and are named differently.
   */
  currentId: string | null
  /** True while a record is being fetched. */
  loading: boolean
  /** The norm the active profile would create a new record under. */
  profileNormVersion: string
}>()

const emit = defineEmits<{ open: [recordId: string], returnToCurrent: [] }>()

const { t, locale } = useI18n()

const STAGES = ['diagnosis', 'evolution', 'discharge', 'other'] as const

function stageLabel(stage: string, label: string | null): string {
  const known = (STAGES as readonly string[]).includes(stage)
  const base = known ? t(`odontogram.nts.stage.${stage}`) : stage
  return label ? `${base} — ${label}` : base
}

function formatDate(value: string | null): string {
  if (!value) return '—'
  return new Date(value).toLocaleString(locale.value, {
    dateStyle: 'medium',
    timeStyle: 'short'
  })
}

/** The date that matters for this row: when it was closed, else when opened. */
function primaryDate(row: NtsRecordSummary): string {
  return formatDate(row.finalized_at ?? row.discarded_at ?? row.recorded_at)
}

function statusColor(status: string): 'success' | 'warning' | 'neutral' {
  if (status === 'finalized') return 'success'
  if (status === 'draft') return 'warning'
  return 'neutral'
}

/**
 * Shown only when it differs from what the profile would create.
 *
 * Printing the version on every row would be noise; printing it on the rows
 * that will be read under different rules is the whole point.
 */
function foreignNorm(row: NtsRecordSummary): string | null {
  return row.norm_version === props.profileNormVersion ? null : row.norm_version
}
</script>

<template>
  <UCard data-testid="nts-history">
    <template #header>
      <div class="flex items-center justify-between gap-3 flex-wrap">
        <div class="flex items-center gap-2">
          <UIcon
            name="i-lucide-history"
            class="w-5 h-5"
          />
          <h3 class="font-medium">
            {{ t('odontogram.nts.history.title') }}
          </h3>
          <UBadge
            color="neutral"
            variant="subtle"
          >
            {{ records.length }}
          </UBadge>
        </div>

        <!--
          Only offered while a historical record is open, so the control that
          leaves the history cannot be mistaken for one that creates something.
        -->
        <UButton
          v-if="openId"
          size="sm"
          color="neutral"
          variant="subtle"
          icon="i-lucide-corner-up-left"
          data-testid="nts-history-return"
          @click="emit('returnToCurrent')"
        >
          {{ t('odontogram.nts.history.returnToCurrent') }}
        </UButton>
      </div>
    </template>

    <!--
      A plain list of buttons, not a listbox.

      05E.3 marked this up as `listbox`/`option` with a button inside each
      option, which is invalid — an option may not contain a focusable control
      — and it promised an arrow-key model that did not exist. The real
      interaction is "activate one of several controls", which is what native
      buttons and Tab already are. `aria-current` names the one on screen.

      Rows stay clickable while one is loading. Disabling them would make a
      slow record block the selector, and switching away from it impossible —
      the very case the record and catalog generation tokens exist to make
      safe. A later click supersedes an earlier one; the earlier answer is
      dropped.
    -->
    <ul
      class="divide-y divide-default"
      :aria-label="t('odontogram.nts.history.title')"
      data-testid="nts-history-list"
    >
      <li
        v-for="(row, index) in records"
        :key="row.id"
      >
        <button
          type="button"
          class="w-full text-left py-2 px-1 flex items-center justify-between gap-3
                 flex-wrap rounded-token-xs transition-colors hover:bg-elevated
                 disabled:opacity-60"
          :class="row.id === openId ? 'bg-elevated' : ''"
          :aria-current="row.id === openId ? 'true' : undefined"
          :data-testid="`nts-history-open-${index}`"
          :data-record="row.id"
          @click="emit('open', row.id)"
        >
          <span class="min-w-0">
            <span class="block text-sm">{{ stageLabel(row.stage, row.stage_label) }}</span>
            <span class="block text-caption text-subtle">{{ primaryDate(row) }}</span>
          </span>

          <span class="flex items-center gap-2 flex-wrap shrink-0">
            <!-- Written under another norm: say so rather than surprise the reader. -->
            <UBadge
              v-if="foreignNorm(row)"
              color="neutral"
              variant="outline"
              size="sm"
              :data-testid="`nts-history-norm-${index}`"
            >
              {{ foreignNorm(row) }}
            </UBadge>

            <!--
              A superseded record is still clinical history. It is marked, and
              never hidden.
            -->
            <UBadge
              v-if="row.is_superseded"
              color="neutral"
              variant="subtle"
              size="sm"
              :data-testid="`nts-history-superseded-${index}`"
            >
              {{ t('odontogram.nts.history.superseded') }}
            </UBadge>

            <UBadge
              :color="statusColor(row.status)"
              variant="subtle"
              size="sm"
              :data-testid="`nts-history-status-${index}`"
            >
              {{ t(`odontogram.nts.status.${row.status}`) }}
            </UBadge>

            <!--
              Two different facts, two different words: this row is the
              odontogram in force, and this row is the one being looked at.
            -->
            <UBadge
              v-if="row.id === currentId"
              color="primary"
              variant="subtle"
              size="sm"
              :data-testid="`nts-history-current-${index}`"
            >
              {{ t('odontogram.nts.history.isCurrent') }}
            </UBadge>

            <UIcon
              v-if="loading && row.id === openId"
              name="i-lucide-loader-2"
              class="w-4 h-4 animate-spin text-subtle"
              :data-testid="`nts-history-loading-${index}`"
            />

            <!-- Text, not only the highlight, so the state survives a screen reader. -->
            <span
              v-else-if="row.id === openId"
              class="text-caption text-subtle"
              :data-testid="`nts-history-open-marker-${index}`"
            >
              {{ t('odontogram.nts.history.viewing') }}
            </span>
          </span>
        </button>
      </li>
    </ul>

    <p
      v-if="records.length === 0"
      class="text-caption text-subtle"
      data-testid="nts-history-empty"
    >
      {{ t('odontogram.nts.history.empty') }}
    </p>
  </UCard>
</template>
