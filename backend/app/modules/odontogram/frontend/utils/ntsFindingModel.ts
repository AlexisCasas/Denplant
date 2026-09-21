/**
 * NTS finding model — what a rule needs, derived from the catalog (NTS-05C).
 *
 * Every function here answers a question about *a rule the catalog served*,
 * never about a rule id. There is deliberately no `switch (rule.rule_id)`, no
 * table of the 38 findings and no clinical knowledge: scope, cardinality,
 * roles, anchors and required attributes all come out of the metadata the
 * backend already validates against, so the editor and the service can never
 * disagree about what the norm says.
 *
 * This mirrors `nts/validation.py`. Its checks exist to keep the clinician
 * from sending something the server will reject, not to decide anything: the
 * server stays the authority and its 422 is always shown in full.
 */

import type {
  NtsFinding,
  NtsFindingTarget,
  NtsRule,
  NtsRuleAttribute,
  NtsScope,
  NtsTargetPayload
} from '../types/nts'

/** The arches a target may name. Matches the persistence vocabulary. */
export type NtsArchCode = 'upper' | 'lower'

/**
 * What the user has picked so far. One shape for every scope, because the
 * scope decides which parts are meaningful rather than which type is used.
 */
export interface NtsTargetSelection {
  /** Subject teeth, in click order. Used by tooth / pair / range. */
  teeth: number[]
  /** Subject arches. Used by arch-scoped rules. */
  arches: NtsArchCode[]
  /** Anchor teeth, for rules that declare an anchor. */
  anchors: number[]
  /** Role assigned per subject tooth, when the rule declares roles. */
  roles: Record<number, string>
}

export function emptySelection(): NtsTargetSelection {
  return { teeth: [], arches: [], anchors: [], roles: {} }
}

/**
 * How many subject teeth a scope takes.
 *
 * `null` means "no fixed count" — a range has no stated minimum span and the
 * norm names none, so none is invented.
 */
export function subjectToothCount(rule: NtsRule): number | null {
  switch (rule.scope) {
    case 'tooth':
    case 'surface':
      return 1
    case 'pair':
      return 2
    default:
      return null
  }
}

/**
 * Whether the subject is a tooth the chart can number.
 *
 * A supernumerary tooth exists but has no FDI cell, so it is selected by its
 * neighbours (the rule's anchors) rather than by clicking it.
 */
export function hasNumberedSubject(rule: NtsRule): boolean {
  return rule.target_identity !== 'unnumbered'
}

/** Whether picking teeth on the chart is what this rule's subject needs. */
export function usesToothSelection(rule: NtsRule): boolean {
  if (rule.scope === 'arch') return false
  return hasNumberedSubject(rule)
}

/** How many anchor teeth the rule declares, or 0 when it declares none. */
export function anchorCount(rule: NtsRule): number {
  return rule.anchor ? rule.anchor.cardinality : 0
}

/** Roles a *subject* target may carry, as the catalog declares them. */
export function subjectRoles(rule: NtsRule) {
  return rule.target_roles.filter(role => role.applies_to === 'subject')
}

// ---------------------------------------------------------------------------
// range
// ---------------------------------------------------------------------------

/**
 * The teeth a range covers, given the two clicked endpoints.
 *
 * `order` is the row exactly as the chart draws it, so a range is the slice
 * between the endpoints in *layout* order rather than in numeric FDI order —
 * 18 → 28 crosses the midline and its numbers are not monotonic. Clicking the
 * endpoints in either order yields the same span.
 */
export function expandRange(order: readonly number[], from: number, to: number): number[] {
  const a = order.indexOf(from)
  const b = order.indexOf(to)
  if (a === -1 || b === -1) return []
  const [start, end] = a <= b ? [a, b] : [b, a]
  return order.slice(start, end + 1)
}

// ---------------------------------------------------------------------------
// attributes
// ---------------------------------------------------------------------------

/**
 * Attributes the clinician actually chooses.
 *
 * A `fixed` attribute is a constant the rule already carries (its sigla), so
 * it is filled in rather than asked for.
 */
export function editableAttributes(rule: NtsRule): NtsRuleAttribute[] {
  return rule.attributes.filter(attribute => attribute.kind !== 'fixed')
}

/** Initial values: every `fixed` attribute pre-filled, nothing else guessed. */
export function initialAttributes(rule: NtsRule): Record<string, unknown> {
  const values: Record<string, unknown> = {}
  for (const attribute of rule.attributes) {
    if (attribute.kind === 'fixed' && attribute.values.length === 1) {
      values[attribute.name] = attribute.values[0]!.code
    }
    if (attribute.kind === 'enum_multi') values[attribute.name] = []
  }
  return values
}

function isBlank(value: unknown): boolean {
  if (value === null || value === undefined) return true
  if (typeof value === 'string') return value.trim() === ''
  if (Array.isArray(value)) return value.length === 0
  return false
}

/**
 * Missing required attributes.
 *
 * `required` is read off the catalog and never inferred from an attribute's
 * name — the backend's own default is `required = true`, so an attribute the
 * norm states is mandatory unless the catalog says otherwise.
 */
export function missingRequiredAttributes(
  rule: NtsRule,
  attributes: Record<string, unknown>
): NtsRuleAttribute[] {
  return rule.attributes.filter(
    attribute => attribute.required && isBlank(attributes[attribute.name])
  )
}

/**
 * Specification requirements this finding activates, rule-level plus the one
 * each selected variant carries.
 *
 * Mirrors `NtsRule.active_specification_requirements`. A requirement with
 * `required = false` is surfaced but never treated as blocking: NTS-03.1
 * flagged `crown_metal_colour` as *no normative evidence for an automatic
 * block*, which is not the same as the norm making the datum optional.
 */
export function activeSpecificationRequirements(
  rule: NtsRule,
  attributes: Record<string, unknown>
) {
  const active = rule.specification_requirement ? [rule.specification_requirement] : []

  for (const attribute of rule.attributes) {
    const selected = attributes[attribute.name]
    const codes = Array.isArray(selected) ? selected : [selected]
    for (const value of attribute.values) {
      if (value.specification_requirement && codes.includes(value.code)) {
        active.push(value.specification_requirement)
      }
    }
  }
  return active
}

// ---------------------------------------------------------------------------
// targets
// ---------------------------------------------------------------------------

/**
 * Build the target payload for a selection.
 *
 * `group_index` stays 0 for every subject: the norm's one multi-segment rule
 * needs a grouping model the catalog itself lists as an open decision, so this
 * editor produces one segment and lets the server reject anything else rather
 * than inventing the grouping here.
 */
export function buildTargets(rule: NtsRule, selection: NtsTargetSelection): NtsTargetPayload[] {
  const targets: NtsTargetPayload[] = []
  let position = 0

  if (rule.scope === 'arch') {
    for (const arch of selection.arches) {
      targets.push({
        participation: 'subject',
        target_kind: 'arch',
        arch,
        group_index: 0,
        position: position++
      })
    }
  } else if (!hasNumberedSubject(rule)) {
    // The subject has no FDI cell; it is located by its anchors.
    targets.push({
      participation: 'subject',
      target_kind: 'unnumbered_tooth',
      tooth_number: null,
      group_index: 0,
      position: position++
    })
  } else {
    for (const tooth of selection.teeth) {
      targets.push({
        participation: 'subject',
        target_kind: 'fdi_tooth',
        tooth_number: tooth,
        role: selection.roles[tooth] ?? null,
        group_index: 0,
        position: position++
      })
    }
  }

  for (const tooth of selection.anchors) {
    targets.push({
      participation: 'anchor',
      target_kind: 'fdi_tooth',
      tooth_number: tooth,
      group_index: 0,
      position: position++
    })
  }

  return targets
}

/** Turn a stored finding back into a selection, so an edit opens pre-filled. */
export function selectionFromTargets(targets: readonly NtsFindingTarget[]): NtsTargetSelection {
  const selection = emptySelection()

  for (const target of targets) {
    if (target.participation === 'anchor') {
      if (target.tooth_number !== null) selection.anchors.push(target.tooth_number)
      continue
    }
    if (target.target_kind === 'arch' && target.arch) {
      selection.arches.push(target.arch as NtsArchCode)
      continue
    }
    if (target.tooth_number !== null) {
      selection.teeth.push(target.tooth_number)
      if (target.role) selection.roles[target.tooth_number] = target.role
    }
  }
  return selection
}

// ---------------------------------------------------------------------------
// pre-flight validation
// ---------------------------------------------------------------------------

/**
 * Reasons this selection cannot be saved yet, as i18n keys plus params.
 *
 * Only what the catalog states is checked. A cardinality the norm leaves
 * silent — `min_count`/`max_count` of `null` — is never turned into a
 * requirement, so a rule whose only role has no bounds never makes that role
 * mandatory.
 */
export interface NtsSelectionProblem {
  key: string
  params?: Record<string, string | number>
}

export function selectionProblems(
  rule: NtsRule,
  selection: NtsTargetSelection
): NtsSelectionProblem[] {
  const problems: NtsSelectionProblem[] = []

  if (rule.scope === 'arch') {
    const count = selection.arches.length
    if (rule.arch_cardinality === 'one' && count !== 1) {
      problems.push({ key: 'archExactlyOne' })
    } else if (rule.arch_cardinality === 'one_or_both' && (count < 1 || count > 2)) {
      problems.push({ key: 'archOneOrBoth' })
    } else if (count === 0) {
      problems.push({ key: 'archRequired' })
    }
  } else if (hasNumberedSubject(rule)) {
    const expected = subjectToothCount(rule)
    const count = selection.teeth.length
    if (expected !== null && count !== expected) {
      problems.push({ key: 'subjectCount', params: { expected, count } })
    }
    if (expected === null && count === 0) {
      problems.push({ key: 'rangeRequired' })
    }
    if (new Set(selection.teeth).size !== count) {
      problems.push({ key: 'duplicateTooth' })
    }
  }

  const anchors = anchorCount(rule)
  if (anchors > 0) {
    if (selection.anchors.length !== anchors) {
      problems.push({ key: 'anchorCount', params: { expected: anchors, count: selection.anchors.length } })
    }
    if (new Set(selection.anchors).size !== selection.anchors.length) {
      problems.push({ key: 'anchorDistinct' })
    }
  }

  for (const role of rule.target_roles) {
    const used = Object.values(selection.roles).filter(code => code === role.code).length
    if (role.min_count !== null && used < role.min_count) {
      problems.push({ key: 'roleMin', params: { role: role.name, min: role.min_count } })
    }
    if (role.max_count !== null && used > role.max_count) {
      problems.push({ key: 'roleMax', params: { role: role.name, max: role.max_count } })
    }
  }

  return problems
}

// ---------------------------------------------------------------------------
// summaries
// ---------------------------------------------------------------------------

/** The rule a finding cites, or `null` when this build cannot interpret it. */
export function ruleFor(rules: readonly NtsRule[], finding: NtsFinding): NtsRule | null {
  return rules.find(rule => rule.rule_id === finding.rule_id) ?? null
}

/**
 * A generic, human-readable rendering of a finding's attributes.
 *
 * Built from the attribute definitions plus the stored values — never from a
 * per-rule formatter, which would be the 38 rules leaking into the frontend
 * one helper at a time. An enum shows the catalog's own label for the code.
 */
export function describeAttributes(
  rule: NtsRule | null,
  attributes: Record<string, unknown>
): Array<{ name: string, label: string, value: string }> {
  const definitions = new Map(rule?.attributes.map(a => [a.name, a]) ?? [])

  return Object.entries(attributes).map(([name, raw]) => {
    const definition = definitions.get(name)
    const codes = Array.isArray(raw) ? raw : [raw]
    const rendered = codes
      .map(code => definition?.values.find(v => v.code === code)?.name ?? String(code))
      .join(', ')
    return { name, label: definition?.name ?? name, value: rendered }
  })
}

/**
 * Structured pieces of a target summary.
 *
 * Returned as data rather than a string so the component renders it through
 * i18n; nothing is inferred from the drawing.
 */
export interface NtsTargetSummary {
  scope: NtsScope
  teeth: number[]
  arches: string[]
  anchors: number[]
  roles: Array<{ tooth: number, role: string }>
  unnumberedSubject: boolean
}

export function describeTargets(
  rule: NtsRule | null,
  targets: readonly NtsFindingTarget[]
): NtsTargetSummary {
  const subjects = targets.filter(t => t.participation === 'subject')
  return {
    scope: (rule?.scope ?? 'tooth') as NtsScope,
    teeth: subjects.filter(t => t.tooth_number !== null).map(t => t.tooth_number!),
    arches: subjects.filter(t => t.arch !== null).map(t => t.arch!),
    anchors: targets
      .filter(t => t.participation === 'anchor' && t.tooth_number !== null)
      .map(t => t.tooth_number!),
    roles: subjects
      .filter(t => t.role !== null && t.tooth_number !== null)
      .map(t => ({ tooth: t.tooth_number!, role: t.role! })),
    unnumberedSubject: subjects.some(t => t.target_kind === 'unnumbered_tooth')
  }
}

/** The narrow slice of `useI18n().t` this module needs. */
export type NtsTranslate = (key: string, named?: Record<string, unknown>) => string

/**
 * A target summary as one line of text.
 *
 * Lives here, rather than in the component that first needed it, because the
 * finding list and the printed document describe the same target and must
 * describe it the same way. Two copies of this would drift, and a printed
 * sheet that names a different tooth than the screen is the worst kind of
 * bug this module can have.
 *
 * Still no clinical inference: every branch reads the structured summary and
 * renders it through i18n. Nothing is read off the drawing.
 */
export function formatTargetSummary(summary: NtsTargetSummary, t: NtsTranslate): string {
  if (summary.arches.length > 0) {
    return summary.arches.map(arch => t(`odontogram.nts.chart.${arch}`)).join(' · ')
  }
  if (summary.unnumberedSubject) {
    return t('odontogram.nts.editor.unnumberedBetween', { teeth: summary.anchors.join(' / ') })
  }
  if (summary.scope === 'range' && summary.teeth.length > 1) {
    return `${summary.teeth[0]} → ${summary.teeth[summary.teeth.length - 1]}`
      + ` (${t('odontogram.nts.editor.toothCount', { count: summary.teeth.length })})`
  }
  if (summary.scope === 'pair') return summary.teeth.join(' + ')
  return summary.teeth.join(' · ') || '—'
}

/** A carried-forward finding nobody has reviewed yet. */
export function isPendingReview(finding: NtsFinding): boolean {
  return finding.provenance === 'carried_forward'
}
