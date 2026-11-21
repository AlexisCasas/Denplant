/**
 * Which rules the "click a tooth, then pick a finding" shortcut may offer.
 *
 * The shortcut means *record a finding ON this tooth*, so a rule qualifies only
 * when a clicked, numbered tooth can be its clinical subject **and** the
 * editor can build the whole target set from tooth clicks alone. Everything is
 * read from catalog metadata — never from a rule id.
 *
 * Rules left out are not lost: "+ Agregar hallazgo" still offers the whole
 * catalog.
 */

import type { NtsRule } from '../types/nts'
import { usesToothSelection } from './ntsFindingModel'

/**
 * Whether the contextual shortcut can seed this rule.
 *
 * - `usesToothSelection` already excludes arch-scoped rules and rules whose
 *   subject has no FDI number (those are located by their anchors, and
 *   turning a clicked tooth into an anchor would change what the click means).
 * - A `multi_segment` range may span several disjoint stretches of the arch
 *   (`range_grouping`), but the editor builds exactly one segment, so it
 *   cannot represent such a rule. `single_segment` and `null` (every
 *   non-range rule) are fully representable.
 */
export function isContextualRuleSupported(rule: NtsRule): boolean {
  if (!usesToothSelection(rule)) return false
  return rule.range_grouping !== 'multi_segment'
}
