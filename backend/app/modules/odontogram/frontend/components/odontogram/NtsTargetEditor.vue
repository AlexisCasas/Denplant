<script setup lang="ts">
/**
 * NtsTargetEditor — what a rule's scope needs picked, and how it is picked.
 *
 * One component for all five scopes the norm uses. The difference between a
 * tooth, a pair, a range and an arch is entirely in the catalog metadata, so
 * it is read rather than branched on: an arch-scoped rule shows an arch
 * selector because its `scope` is `arch`, not because of its rule id. That is
 * why the removable-appliance rule gets an arch selector here while the
 * updated visual reference treats it as a range — the catalog and the norm
 * both say arch.
 *
 * Teeth are picked on the chart itself; this panel states what is needed,
 * shows what is picked, and owns the controls the chart cannot provide (arch
 * buttons, role assignment, subject/anchor switching).
 */

import type { NtsRule } from '../../types/nts'
import type { NtsArchCode, NtsSelectionProblem, NtsTargetSelection } from '../../utils/ntsFindingModel'
import type { NtsPickMode } from '../../composables/useNtsFindingEditor'
import {
  anchorCount,
  hasNumberedSubject,
  subjectRoles,
  subjectToothCount
} from '../../utils/ntsFindingModel'

const props = defineProps<{
  rule: NtsRule
  selection: NtsTargetSelection
  pickMode: NtsPickMode
  problems: NtsSelectionProblem[]
}>()

const emit = defineEmits<{
  pickMode: [mode: NtsPickMode]
  toggleArch: [arch: NtsArchCode]
  setRole: [tooth: number, role: string | null]
}>()

const { t } = useI18n()

const ARCHES: NtsArchCode[] = ['upper', 'lower']

const needsTeeth = computed(() => props.rule.scope !== 'arch' && hasNumberedSubject(props.rule))
const needsArch = computed(() => props.rule.scope === 'arch')
const anchors = computed(() => anchorCount(props.rule))
const roles = computed(() => subjectRoles(props.rule))
const unnumbered = computed(() => !hasNumberedSubject(props.rule))

/** What the clinician is being asked for, in the scope's own terms. */
const instruction = computed(() => {
  if (needsArch.value) {
    return props.rule.arch_cardinality === 'one_or_both'
      ? t('odontogram.nts.editor.pick.archOneOrBoth')
      : t('odontogram.nts.editor.pick.archOne')
  }
  if (unnumbered.value) return t('odontogram.nts.editor.pick.unnumbered', { count: anchors.value })
  if (props.rule.scope === 'range') return t('odontogram.nts.editor.pick.range')
  if (props.rule.scope === 'pair') return t('odontogram.nts.editor.pick.pair')
  if (props.rule.scope === 'surface') return t('odontogram.nts.editor.pick.surface')
  const expected = subjectToothCount(props.rule)
  return t('odontogram.nts.editor.pick.tooth', { count: expected ?? 1 })
})

function roleOptions(tooth: number) {
  return [
    { label: t('odontogram.nts.editor.noRole'), value: '' },
    ...roles.value.map(role => ({ label: role.name, value: role.code }))
  ].map(option => ({ ...option, tooth }))
}
</script>

<template>
  <div
    class="space-y-3"
    data-testid="nts-target-editor"
    :data-scope="rule.scope"
  >
    <p class="text-sm text-muted">
      {{ instruction }}
    </p>

    <!-- Arch-scoped rules never become a range: the norm marks the whole
         arch under treatment, not a stretch of it. -->
    <div
      v-if="needsArch"
      class="flex gap-2"
      data-testid="nts-arch-selector"
    >
      <UButton
        v-for="arch in ARCHES"
        :key="arch"
        size="sm"
        :color="selection.arches.includes(arch) ? 'primary' : 'neutral'"
        :variant="selection.arches.includes(arch) ? 'solid' : 'outline'"
        :aria-pressed="selection.arches.includes(arch)"
        :data-testid="`nts-arch-${arch}`"
        @click="emit('toggleArch', arch)"
      >
        {{ t(`odontogram.nts.chart.${arch}`) }}
      </UButton>
    </div>

    <!-- A subject with no FDI cell: it is located by its anchors,
         so there is nothing on the chart to click for it. -->
    <p
      v-if="unnumbered"
      class="text-caption text-subtle"
      data-testid="nts-unnumbered-subject"
    >
      {{ t('odontogram.nts.editor.unnumberedSubject') }}
    </p>

    <!-- Subject / anchor switch, shown only when the rule declares anchors. -->
    <div
      v-if="anchors > 0 && needsTeeth"
      class="flex gap-2"
      data-testid="nts-pick-mode"
    >
      <UButton
        size="xs"
        :variant="pickMode === 'subject' ? 'solid' : 'outline'"
        color="neutral"
        :aria-pressed="pickMode === 'subject'"
        @click="emit('pickMode', 'subject')"
      >
        {{ t('odontogram.nts.editor.pickSubject') }}
      </UButton>
      <UButton
        size="xs"
        :variant="pickMode === 'anchor' ? 'solid' : 'outline'"
        color="neutral"
        :aria-pressed="pickMode === 'anchor'"
        @click="emit('pickMode', 'anchor')"
      >
        {{ t('odontogram.nts.editor.pickAnchor') }}
      </UButton>
    </div>

    <dl class="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-sm">
      <template v-if="needsTeeth">
        <dt class="text-subtle">
          {{ t('odontogram.nts.editor.selectedTeeth') }}
        </dt>
        <dd data-testid="nts-selected-teeth">
          {{ selection.teeth.length ? selection.teeth.join(' · ') : '—' }}
        </dd>
      </template>

      <template v-if="rule.scope === 'range' && selection.teeth.length > 1">
        <dt class="text-subtle">
          {{ t('odontogram.nts.editor.rangeSpan') }}
        </dt>
        <dd data-testid="nts-range-span">
          {{ selection.teeth[0] }} → {{ selection.teeth[selection.teeth.length - 1] }}
          ({{ t('odontogram.nts.editor.toothCount', { count: selection.teeth.length }) }})
        </dd>
      </template>

      <template v-if="anchors > 0">
        <dt class="text-subtle">
          {{ t('odontogram.nts.editor.anchors') }}
        </dt>
        <dd data-testid="nts-selected-anchors">
          {{ selection.anchors.length ? selection.anchors.join(' · ') : '—' }}
        </dd>
      </template>

      <template v-if="needsArch">
        <dt class="text-subtle">
          {{ t('odontogram.nts.editor.selectedArches') }}
        </dt>
        <dd data-testid="nts-selected-arches">
          {{ selection.arches.length
            ? selection.arches.map(a => t(`odontogram.nts.chart.${a}`)).join(' · ')
            : '—' }}
        </dd>
      </template>
    </dl>

    <!-- Roles belong to a target, never to the finding's attributes. A role
         the norm gives no cardinality is offered, never demanded. -->
    <div
      v-if="roles.length > 0 && selection.teeth.length > 0"
      class="space-y-2"
      data-testid="nts-role-editor"
    >
      <p class="text-caption text-subtle">
        {{ t('odontogram.nts.editor.roles') }}
      </p>
      <div
        v-for="tooth in selection.teeth"
        :key="tooth"
        class="flex items-center gap-2"
      >
        <span class="text-sm tabular-nums w-8">{{ tooth }}</span>
        <USelectMenu
          :model-value="selection.roles[tooth] ?? ''"
          :items="roleOptions(tooth)"
          value-key="value"
          size="xs"
          class="w-48"
          :data-testid="`nts-role-${tooth}`"
          @update:model-value="emit('setRole', tooth, $event || null)"
        />
      </div>
    </div>

    <ul
      v-if="problems.length > 0"
      class="text-caption text-warning space-y-1"
      data-testid="nts-target-problems"
    >
      <li
        v-for="problem in problems"
        :key="problem.key"
      >
        {{ t(`odontogram.nts.editor.problem.${problem.key}`, problem.params ?? {}) }}
      </li>
    </ul>
  </div>
</template>
