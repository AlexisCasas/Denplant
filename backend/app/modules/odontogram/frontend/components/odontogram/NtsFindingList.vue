<script setup lang="ts">
/**
 * NtsFindingList — the findings a record holds, in words.
 *
 * Not the normative renderer: nothing here draws a sigla, a symbol or a
 * coloured mark on the chart, and the red/blue the norm reserves for what a
 * finding *means* is not spent on this list. It exists so a clinician can see
 * and correct what has been captured before the renderer arrives.
 *
 * Labels are resolved through the catalog by `rule_id` rather than stored
 * alongside the finding, so a record never carries a stale copy of a rule's
 * name. A rule this build cannot interpret degrades to its id with a notice.
 */

import type { NtsFinding, NtsRule } from '../../types/nts'
import {
  describeAttributes,
  describeTargets,
  formatTargetSummary,
  isPendingReview,
  ruleFor
} from '../../utils/ntsFindingModel'

const props = withDefaults(
  defineProps<{
    findings: readonly NtsFinding[]
    rules: readonly NtsRule[]
    /** A finalized record is a locked document: no action is offered. */
    readonly?: boolean
    busyId?: string | null
    /**
     * A write is in flight somewhere on this record.
     *
     * Every action here bumps the same version as the record's text edits do,
     * so while one of those is running these must not be offered — the click
     * would be refused by the shared lock and read as a dead button.
     */
    writing?: boolean
  }>(),
  { readonly: false, busyId: null, writing: false }
)

const emit = defineEmits<{
  edit: [finding: NtsFinding]
  confirm: [finding: NtsFinding]
  remove: [finding: NtsFinding]
}>()

const { t } = useI18n()

interface Row {
  finding: NtsFinding
  rule: NtsRule | null
  label: string
  attributes: Array<{ name: string, label: string, value: string }>
  targets: ReturnType<typeof describeTargets>
  pending: boolean
}

const rows = computed<Row[]>(() =>
  props.findings.map((finding) => {
    const rule = ruleFor(props.rules, finding)
    return {
      finding,
      rule,
      label: rule?.official_name ?? finding.rule_id,
      attributes: describeAttributes(rule, finding.attributes),
      targets: describeTargets(rule, finding.targets),
      pending: isPendingReview(finding)
    }
  })
)

/**
 * Structured target data rendered as text; nothing is read off the drawing.
 *
 * The formatting itself moved to `ntsFindingModel` when the printed document
 * needed the same sentence: one description of a target, used by both.
 */
function targetText(row: Row): string {
  return formatTargetSummary(row.targets, t)
}

function roleText(row: Row): string {
  return row.targets.roles
    .map(({ tooth, role }) => {
      const name = row.rule?.target_roles.find(r => r.code === role)?.name ?? role
      return `${tooth} (${name})`
    })
    .join(' · ')
}
</script>

<template>
  <UCard data-testid="nts-finding-list">
    <template #header>
      <div class="flex items-center gap-2">
        <UIcon
          name="i-lucide-list"
          class="w-5 h-5 text-primary-accent"
        />
        <span class="font-medium">{{ t('odontogram.nts.editor.findings') }}</span>
        <UBadge
          color="neutral"
          variant="subtle"
          size="sm"
        >
          {{ findings.length }}
        </UBadge>
      </div>
    </template>

    <p
      v-if="rows.length === 0"
      class="text-sm text-subtle"
      data-testid="nts-finding-list-empty"
    >
      {{ t('odontogram.nts.editor.noFindings') }}
    </p>

    <ul
      v-else
      class="divide-y divide-default"
    >
      <li
        v-for="row in rows"
        :key="row.finding.id"
        class="py-3 first:pt-0 last:pb-0"
        :data-testid="`nts-finding-${row.finding.id}`"
        :data-rule="row.finding.rule_id"
        :data-provenance="row.finding.provenance"
      >
        <div class="flex items-start justify-between gap-3 flex-wrap">
          <div class="min-w-0 space-y-1">
            <div class="flex items-center gap-2 flex-wrap">
              <span class="font-medium text-sm">{{ row.label }}</span>
              <UBadge
                v-if="!row.rule"
                color="warning"
                variant="subtle"
                size="sm"
                data-testid="nts-finding-unknown-rule"
              >
                {{ t('odontogram.nts.editor.unknownRuleShort') }}
              </UBadge>
              <UBadge
                v-if="row.pending"
                color="warning"
                variant="subtle"
                size="sm"
                data-testid="nts-finding-pending"
              >
                {{ t('odontogram.nts.editor.pendingReview') }}
              </UBadge>
            </div>

            <p class="text-caption text-subtle">
              {{ t('odontogram.nts.editor.targets') }}: {{ targetText(row) }}
              <template v-if="row.targets.roles.length > 0">
                — {{ roleText(row) }}
              </template>
            </p>

            <p
              v-if="row.attributes.length > 0"
              class="text-caption text-subtle"
            >
              <span
                v-for="(attribute, index) in row.attributes"
                :key="attribute.name"
              >
                <template v-if="index > 0"> · </template>{{ attribute.label }}: {{ attribute.value }}
              </span>
            </p>
          </div>

          <div
            v-if="!readonly"
            class="flex items-center gap-1 shrink-0"
          >
            <UButton
              v-if="row.pending"
              size="xs"
              :disabled="writing"
              :loading="busyId === row.finding.id"
              :data-testid="`nts-confirm-${row.finding.id}`"
              @click="emit('confirm', row.finding)"
            >
              {{ t('odontogram.nts.editor.confirmFinding') }}
            </UButton>
            <UButton
              size="xs"
              color="neutral"
              variant="ghost"
              :disabled="!row.rule || writing"
              :data-testid="`nts-edit-${row.finding.id}`"
              @click="emit('edit', row.finding)"
            >
              {{ t('odontogram.nts.editor.edit') }}
            </UButton>
            <UButton
              size="xs"
              color="neutral"
              variant="ghost"
              :disabled="writing"
              :loading="busyId === row.finding.id"
              :data-testid="`nts-remove-${row.finding.id}`"
              @click="emit('remove', row.finding)"
            >
              {{ t('odontogram.nts.editor.removeFinding') }}
            </UButton>
          </div>
        </div>
      </li>
    </ul>
  </UCard>
</template>
