/**
 * NTS-05C — the finding editor's behaviour: mutations, conflicts and resets.
 *
 * The rules used here are synthetic on purpose (see `ntsFindingModel.spec.ts`)
 * so a passing test cannot be explained by the code recognising a rule id.
 *
 * Module-layer files are imported by relative path: `frontend/module_layers`
 * does not resolve on this Windows host.
 */

import { mockNuxtImport, mountSuspended } from '@nuxt/test-utils/runtime'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { defineComponent, h, nextTick, ref } from 'vue'

import type { NtsFinding, NtsRecord, NtsRule } from '../../../backend/app/modules/odontogram/frontend/types/nts'
import { useNtsFindingEditor } from '../../../backend/app/modules/odontogram/frontend/composables/useNtsFindingEditor'
import { buildTargets } from '../../../backend/app/modules/odontogram/frontend/utils/ntsFindingModel'

const state = vi.hoisted(() => ({ get: vi.fn(), post: vi.fn(), put: vi.fn() }))

mockNuxtImport('useApi', () => () => ({ get: state.get, post: state.post, put: state.put }))
mockNuxtImport('useClinicState', () => () => ({
  currentClinic: { get value() { return { id: 'clinic-a' } } }
}))

async function runInSetup<T>(fn: () => T): Promise<T> {
  let captured!: T
  await mountSuspended(defineComponent({
    setup() {
      captured = fn()
      return () => h('div')
    }
  }))
  return captured
}

// ---------------------------------------------------------------------------
// fixtures
// ---------------------------------------------------------------------------

function makeRule(overrides: Partial<NtsRule> = {}): NtsRule {
  return {
    rule_id: 'X.1',
    ordinal: 1,
    official_name: 'Synthetic tooth rule',
    scope: 'tooth',
    target_identity: 'numbered',
    anchor: null,
    arch_cardinality: null,
    range_grouping: null,
    attributes: [],
    target_roles: [],
    specification_requirement: null,
    status: 'verified',
    ...overrides
  }
}

const TOOTH_RULE = makeRule()
const ARCH_RULE = makeRule({ rule_id: 'X.2', scope: 'arch', arch_cardinality: 'one' })
const RANGE_RULE = makeRule({ rule_id: 'X.3', scope: 'range', range_grouping: 'single_segment' })
const ENUM_RULE = makeRule({
  rule_id: 'X.4',
  attributes: [{
    name: 'kind',
    kind: 'enum',
    required: true,
    is_sigla: false,
    status: 'verified',
    notes: null,
    values: [{ code: 'A', name: 'Alpha', status: 'verified', notes: null, specification_requirement: null }]
  }]
})

const RULES = [TOOTH_RULE, ARCH_RULE, RANGE_RULE, ENUM_RULE]
const UPPER_ROW = [18, 17, 16, 15, 14, 13, 12, 11, 21, 22, 23, 24, 25, 26, 27, 28]

function makeFinding(overrides: Partial<NtsFinding> = {}): NtsFinding {
  return {
    id: 'f1',
    record_id: 'rec-1',
    norm_version: 'pe_nts_188_2022',
    rule_id: 'X.1',
    attributes: {},
    provenance: 'observed',
    source_finding_id: null,
    sequence: 1,
    created_at: '2026-01-02T10:00:00Z',
    created_by: 'u1',
    targets: [{
      id: 't1',
      group_index: 0,
      position: 0,
      participation: 'subject',
      role: null,
      target_kind: 'fdi_tooth',
      tooth_number: 16,
      arch: null,
      local_ordinal: null,
      geometry: null
    }],
    ...overrides
  }
}

function makeRecord(overrides: Partial<NtsRecord> = {}): NtsRecord {
  return {
    id: 'rec-1',
    clinic_id: 'clinic-a',
    patient_id: 'p1',
    norm_version: 'pe_nts_188_2022',
    stage: 'diagnosis',
    stage_label: null,
    status: 'draft',
    version: 3,
    observations: null,
    recorded_at: '2026-01-02T10:00:00Z',
    recorded_by: 'u1',
    finalized_at: null,
    finalized_by: null,
    discarded_at: null,
    discarded_by: null,
    discard_reason: null,
    recorded_by_name: null,
    recorded_by_role: null,
    recorded_by_professional_id: null,
    supersedes_record_id: null,
    supersession_reason: null,
    content_hash: null,
    hash_algorithm: null,
    canonicalization_version: null,
    created_at: '2026-01-02T10:00:00Z',
    updated_at: '2026-01-02T10:00:00Z',
    findings: [],
    specifications: [],
    ...overrides
  }
}

function apiError(status: number, code: string, errors: string[] = []) {
  return { statusCode: status, data: { message: errors[0] ?? code, code, errors } }
}

/** A harness whose record and rules the test controls. */
async function makeEditor(options: {
  record?: NtsRecord | null
  rules?: NtsRule[]
} = {}) {
  // `??` would turn an explicit null into a record, which is exactly the
  // case the gating tests need.
  const record = ref<NtsRecord | null>('record' in options ? options.record! : makeRecord())
  const rules = ref<NtsRule[]>(options.rules ?? RULES)
  const reload = vi.fn(async () => {})
  const onConflict = vi.fn(async () => {})

  const editor = await runInSetup(() =>
    useNtsFindingEditor({
      record: () => record.value,
      rules: () => rules.value,
      reload,
      onConflict
    })
  )
  return { editor, record, rules, reload, onConflict }
}

beforeEach(() => {
  state.get.mockReset()
  state.post.mockReset()
  state.put.mockReset()
})

// ---------------------------------------------------------------------------
// create
// ---------------------------------------------------------------------------

describe('creating a finding', () => {
  it('sends the rule, attributes and targets as one request', async () => {
    state.post.mockResolvedValue({ data: { record_version: 4, finding: makeFinding() } })
    const { editor, reload } = await makeEditor()

    editor.startCreate()
    editor.selectRule(TOOTH_RULE)
    editor.pickTooth(16, UPPER_ROW)
    expect(editor.canSave.value).toBe(true)

    expect(await editor.createFinding()).toBe(true)

    expect(state.post).toHaveBeenCalledTimes(1)
    const [url, body] = state.post.mock.calls[0]!
    expect(url).toBe('/api/v1/odontogram/nts/records/rec-1/findings')
    expect(body).toEqual({
      expected_version: 3,
      rule_id: 'X.1',
      attributes: {},
      targets: [{
        participation: 'subject',
        target_kind: 'fdi_tooth',
        tooth_number: 16,
        role: null,
        group_index: 0,
        position: 0
      }]
    })
    // Authoritative state comes from a refetch, never from arithmetic.
    expect(reload).toHaveBeenCalledTimes(1)
    expect(editor.isOpen.value).toBe(false)
  })

  it('uses the draft version as expected_version, never version + 1', async () => {
    state.post.mockResolvedValue({ data: { record_version: 8, finding: makeFinding() } })
    const { editor } = await makeEditor({ record: makeRecord({ version: 7 }) })

    editor.startCreate()
    editor.selectRule(TOOTH_RULE)
    editor.pickTooth(16, UPPER_ROW)
    await editor.createFinding()

    expect(state.post.mock.calls[0]![1].expected_version).toBe(7)
  })

  it('will not save while a required attribute is empty', async () => {
    const { editor } = await makeEditor()

    editor.startCreate()
    editor.selectRule(ENUM_RULE)
    editor.pickTooth(16, UPPER_ROW)
    expect(editor.missingAttributes.value.map(a => a.name)).toEqual(['kind'])
    expect(editor.canSave.value).toBe(false)
    expect(await editor.createFinding()).toBe(false)
    expect(state.post).not.toHaveBeenCalled()

    editor.attributes.value = { kind: 'A' }
    await nextTick()
    expect(editor.canSave.value).toBe(true)
  })

  it('will not save while the target selection is incomplete', async () => {
    const { editor } = await makeEditor()

    editor.startCreate()
    editor.selectRule(TOOTH_RULE)
    expect(editor.problems.value.map(p => p.key)).toEqual(['subjectCount'])
    expect(editor.canSave.value).toBe(false)
    expect(state.post).not.toHaveBeenCalled()
  })

  it('an arch rule needs the arch selector, not a range of teeth', async () => {
    state.post.mockResolvedValue({ data: { record_version: 4, finding: makeFinding() } })
    const { editor } = await makeEditor()

    editor.startCreate()
    editor.selectRule(ARCH_RULE)
    // Nothing on the chart is selectable for it.
    expect(editor.pickMode.value).toBe('none')

    editor.toggleArch('upper')
    expect(editor.canSave.value).toBe(true)
    await editor.createFinding()

    expect(state.post.mock.calls[0]![1].targets).toEqual([
      { participation: 'subject', target_kind: 'arch', arch: 'upper', group_index: 0, position: 0 }
    ])
  })

  it('a range is two clicks and one aggregate, not one finding per tooth', async () => {
    state.post.mockResolvedValue({ data: { record_version: 4, finding: makeFinding() } })
    const { editor } = await makeEditor()

    editor.startCreate()
    editor.selectRule(RANGE_RULE)
    editor.pickTooth(16, UPPER_ROW)
    expect(editor.selection.value.teeth).toEqual([16])
    editor.pickTooth(13, UPPER_ROW)
    expect(editor.selection.value.teeth).toEqual([16, 15, 14, 13])

    await editor.createFinding()
    expect(state.post).toHaveBeenCalledTimes(1)
    expect(state.post.mock.calls[0]![1].targets).toHaveLength(4)
  })
})

// ---------------------------------------------------------------------------
// edit
// ---------------------------------------------------------------------------

describe('editing a finding', () => {
  it('opens pre-filled from what the server stored', async () => {
    const finding = makeFinding({ attributes: { kind: 'A' }, rule_id: 'X.4' })
    const { editor } = await makeEditor({ record: makeRecord({ findings: [finding] }) })

    editor.startEdit(finding)

    expect(editor.isCreating.value).toBe(false)
    expect(editor.rule.value?.rule_id).toBe('X.4')
    expect(editor.attributes.value).toEqual({ kind: 'A' })
    expect(editor.selection.value.teeth).toEqual([16])
  })

  it('changing only attributes does not rewrite the target set', async () => {
    const finding = makeFinding({ attributes: { kind: 'A' }, rule_id: 'X.4' })
    state.put.mockResolvedValue({ data: { record_version: 4, finding } })
    const { editor } = await makeEditor({ record: makeRecord({ findings: [finding] }) })

    editor.startEdit(finding)
    editor.attributes.value = { kind: 'A', extra: undefined }
    editor.attributes.value = { kind: 'A' }
    await editor.saveFinding(finding)

    expect(state.put).toHaveBeenCalledTimes(1)
    expect(state.put.mock.calls[0]![0]).toBe('/api/v1/odontogram/nts/records/rec-1/findings/f1')
  })

  it('changing targets replaces the whole set, with the version the first call reported', async () => {
    const finding = makeFinding()
    state.put
      .mockResolvedValueOnce({ data: { record_version: 4, finding } })
      .mockResolvedValueOnce({ data: { record_version: 5, finding } })
    const { editor } = await makeEditor({ record: makeRecord({ findings: [finding] }) })

    editor.startEdit(finding)
    editor.setPickMode('subject')
    editor.pickTooth(16, UPPER_ROW) // deselect
    editor.pickTooth(21, UPPER_ROW)
    await editor.saveFinding(finding)

    expect(state.put).toHaveBeenCalledTimes(2)
    const [attrUrl, attrBody] = state.put.mock.calls[0]!
    const [targetUrl, targetBody] = state.put.mock.calls[1]!

    expect(attrUrl).toBe('/api/v1/odontogram/nts/records/rec-1/findings/f1')
    expect(attrBody.expected_version).toBe(3)
    expect(targetUrl).toBe('/api/v1/odontogram/nts/records/rec-1/findings/f1/targets')
    // The second call uses what the first reported, not the opening version.
    expect(targetBody.expected_version).toBe(4)
    expect(targetBody.targets.map((t: { tooth_number: number }) => t.tooth_number)).toEqual([21])
  })
})

// ---------------------------------------------------------------------------
// a two-step edit whose second step fails
// ---------------------------------------------------------------------------

/**
 * Editing attributes and editing targets are separate endpoints, each costing
 * its own version bump, so the first can land and the second fail. There is no
 * undo endpoint, and inventing one would write a second clinical change to
 * paper over the first. What the client owes is the truth: refetch, and say
 * which half landed.
 */
describe('attributes saved, targets rejected', () => {
  /**
   * Sets up the one scenario all three failures share: a draft at v3, an edit
   * that changes both halves, the attributes PUT succeeding and moving the
   * record to v4, and the targets PUT failing however the test says.
   */
  async function editBothHalves(targetsFailure: unknown) {
    const finding = makeFinding({ attributes: { kind: 'A' }, rule_id: 'X.4' })
    state.put
      .mockResolvedValueOnce({ data: { record_version: 4, finding } })
      .mockRejectedValueOnce(targetsFailure)

    const harness = await makeEditor({ record: makeRecord({ version: 3, findings: [finding] }) })
    const { editor } = harness

    editor.startEdit(finding)
    editor.attributes.value = { kind: 'A', changed: true }
    editor.setPickMode('subject')
    editor.pickTooth(16, UPPER_ROW) // deselect the stored tooth
    editor.pickTooth(21, UPPER_ROW) // pick a different one

    const ok = await editor.saveFinding(finding)
    return { ...harness, finding, ok }
  }

  /** Both calls went out exactly once, in order, with the right versions. */
  function expectTwoCallsNoRetry() {
    expect(state.put).toHaveBeenCalledTimes(2)
    const [attrUrl, attrBody] = state.put.mock.calls[0]!
    const [targetUrl, targetBody] = state.put.mock.calls[1]!

    expect(attrUrl).toBe('/api/v1/odontogram/nts/records/rec-1/findings/f1')
    expect(attrBody.expected_version).toBe(3)
    expect(targetUrl).toBe('/api/v1/odontogram/nts/records/rec-1/findings/f1/targets')
    // The second call uses what the first reported, not the opening version.
    expect(targetBody.expected_version).toBe(4)
  }

  /** Nothing was sent to undo the half that landed. */
  function expectNoInverseMutation() {
    expect(state.post).not.toHaveBeenCalled()
    expect(state.put).toHaveBeenCalledTimes(2)
    const urls = state.put.mock.calls.map(([url]) => String(url))
    expect(urls.filter(u => u.endsWith('/findings/f1'))).toHaveLength(1)
  }

  it('A — a 422 refetches, reports the problems and says the edit landed half-way', async () => {
    const problems = ['X.4: a finding needs at least one subject target']
    const { editor, ok, reload } = await editBothHalves(
      apiError(422, 'nts_clinical_validation', problems)
    )

    expect(ok).toBe(false)
    expectTwoCallsNoRetry()
    expectNoInverseMutation()

    // The record moved, so the screen must not keep showing the old draft.
    expect(reload).toHaveBeenCalledTimes(1)
    // Not "saved successfully": the state is named for what it is.
    expect(editor.partialUpdate.value).toEqual({ findingId: 'f1' })
    expect(editor.clinicalErrors.value).toEqual(problems)
  })

  it('B — a 409 follows the conflict policy and still reports the partial edit', async () => {
    const { editor, ok, onConflict, reload } = await editBothHalves(
      apiError(409, 'nts_version_conflict')
    )

    expect(ok).toBe(false)
    expectTwoCallsNoRetry()
    expectNoInverseMutation()

    // The conflict policy owns the refetch, so there is no second one here.
    expect(onConflict).toHaveBeenCalledTimes(1)
    expect(onConflict).toHaveBeenCalledWith('version')
    expect(reload).not.toHaveBeenCalled()

    // The editor closes — its version is stale — but the notice survives it.
    expect(editor.isOpen.value).toBe(false)
    expect(editor.partialUpdate.value).toEqual({ findingId: 'f1' })
  })

  it('C — a transport failure refetches and reports it too', async () => {
    const { editor, ok, reload } = await editBothHalves(new Error('offline'))

    expect(ok).toBe(false)
    expectTwoCallsNoRetry()
    expectNoInverseMutation()

    expect(reload).toHaveBeenCalledTimes(1)
    expect(editor.partialUpdate.value).toEqual({ findingId: 'f1' })
    expect(editor.error.value?.message).toBe('offline')
    expect(editor.clinicalErrors.value).toEqual([])
  })

  it('a failure before anything landed reports no partial update', async () => {
    // Attributes rejected outright: nothing reached the server, so there is
    // no half-applied edit to warn about.
    const finding = makeFinding({ attributes: { kind: 'A' }, rule_id: 'X.4' })
    state.put.mockRejectedValue(apiError(422, 'nts_clinical_validation', ['nope']))
    const { editor, reload } = await makeEditor({
      record: makeRecord({ version: 3, findings: [finding] })
    })

    editor.startEdit(finding)
    editor.attributes.value = { kind: 'A', changed: true }
    expect(await editor.saveFinding(finding)).toBe(false)

    expect(state.put).toHaveBeenCalledTimes(1)
    expect(editor.partialUpdate.value).toBeNull()
    expect(reload).not.toHaveBeenCalled()
  })

  it('the notice clears when the next save starts, and can be dismissed', async () => {
    const { editor } = await editBothHalves(new Error('offline'))
    expect(editor.partialUpdate.value).not.toBeNull()

    editor.dismissPartialUpdate()
    expect(editor.partialUpdate.value).toBeNull()
  })

  it('a successful two-step edit reports no partial update', async () => {
    const finding = makeFinding({ attributes: { kind: 'A' }, rule_id: 'X.4' })
    state.put
      .mockResolvedValueOnce({ data: { record_version: 4, finding } })
      .mockResolvedValueOnce({ data: { record_version: 5, finding } })
    const { editor, reload } = await makeEditor({
      record: makeRecord({ version: 3, findings: [finding] })
    })

    editor.startEdit(finding)
    editor.attributes.value = { kind: 'A', changed: true }
    editor.setPickMode('subject')
    editor.pickTooth(16, UPPER_ROW)
    editor.pickTooth(21, UPPER_ROW)

    expect(await editor.saveFinding(finding)).toBe(true)
    expect(editor.partialUpdate.value).toBeNull()
    expect(reload).toHaveBeenCalledTimes(1)
    expect(editor.isOpen.value).toBe(false)
  })
})

// ---------------------------------------------------------------------------
// retargeting an existing finding (MANUAL-QA-05C)
// ---------------------------------------------------------------------------

/**
 * Manual QA on the migrated dev database found that an existing finding's
 * target could not be changed at all: `startEdit` leaves `pickMode` at
 * `'none'`, the chart is only selectable while it is not `'none'`, and the
 * only control that could change it was rendered solely for rules declaring
 * anchors — which is one rule in the whole norm.
 *
 * The chart staying inert on open is deliberate and kept: a finding already
 * recorded must not move to another tooth because of a stray click. What was
 * missing is the explicit way out, which these tests pin down.
 */
describe('changing the targets of an existing finding', () => {
  const PAIR_RULE = makeRule({ rule_id: 'X.5', scope: 'pair' })
  const SURFACE_RULE = makeRule({
    rule_id: 'X.6',
    scope: 'surface',
    attributes: [{
      name: 'surfaces',
      kind: 'enum_multi',
      required: true,
      is_sigla: false,
      status: 'verified',
      notes: null,
      values: [
        { code: 'M', name: 'Mesial', status: 'verified', notes: null, specification_requirement: null },
        { code: 'O', name: 'Oclusal/Incisal', status: 'verified', notes: null, specification_requirement: null }
      ]
    }]
  })
  const ROLE_RULE = makeRule({
    rule_id: 'X.7',
    scope: 'range',
    range_grouping: 'single_segment',
    target_roles: [{
      code: 'pilar', name: 'Pilar', applies_to: 'subject',
      min_count: null, max_count: null, status: 'needs_clinical_review', notes: null
    }]
  })
  const ANCHOR_RULE = makeRule({
    rule_id: 'X.8',
    target_identity: 'unnumbered',
    anchor: { kind: 'interproximal', cardinality: 2, role: 'spatial_reference_only' }
  })

  const ALL_RULES = [...RULES, PAIR_RULE, SURFACE_RULE, ROLE_RULE, ANCHOR_RULE]

  /** A finding whose subject targets are the given teeth, in order. */
  function findingOn(ruleId: string, teeth: number[], roles: Record<number, string> = {}) {
    return makeFinding({
      rule_id: ruleId,
      targets: teeth.map((tooth, index) => ({
        id: `t${index}`,
        group_index: 0,
        position: index,
        participation: 'subject' as const,
        role: roles[tooth] ?? null,
        target_kind: 'fdi_tooth' as const,
        tooth_number: tooth,
        arch: null,
        local_ordinal: null,
        geometry: null
      }))
    })
  }

  async function openEdit(finding: NtsFinding) {
    const harness = await makeEditor({
      record: makeRecord({ version: 3, findings: [finding] }),
      rules: ALL_RULES
    })
    harness.editor.startEdit(finding)
    return harness
  }

  it('A — opening an edit leaves the chart inert with the stored targets shown', async () => {
    const finding = findingOn('X.1', [16])
    const { editor } = await openEdit(finding)

    expect(editor.isOpen.value).toBe(true)
    expect(editor.selection.value.teeth).toEqual([16])
    // Inert: a click on the chart cannot move a recorded finding.
    expect(editor.pickMode.value).toBe('none')
  })

  it('B — "change selection" is what activates the chart', async () => {
    const { editor } = await openEdit(findingOn('X.1', [16]))

    editor.startRetargetSubject()

    expect(editor.pickMode.value).toBe('subject')
    // The old subject is cleared, so the next click cannot land beside it.
    expect(editor.selection.value.teeth).toEqual([])
  })

  it('C — a tooth finding is replaced, never accumulated', async () => {
    const { editor } = await openEdit(findingOn('X.1', [16]))

    editor.startRetargetSubject()
    editor.pickTooth(26, UPPER_ROW)

    expect(editor.selection.value.teeth).toEqual([26])
    expect(editor.selection.value.teeth).not.toContain(16)
  })

  it('D — a range is re-drawn from its new endpoints', async () => {
    const LOWER_ROW = [48, 47, 46, 45, 44, 43, 42, 41, 31, 32, 33, 34, 35, 36, 37, 38]
    const finding = findingOn('X.3', [48, 47, 46, 45, 44, 43])
    const { editor } = await openEdit(finding)

    expect(editor.selection.value.teeth).toEqual([48, 47, 46, 45, 44, 43])

    editor.startRetargetSubject()
    editor.pickTooth(46, LOWER_ROW) // new start
    expect(editor.selection.value.teeth).toEqual([46])
    editor.pickTooth(42, LOWER_ROW) // new end

    // The new span only, never the old one blended into it.
    expect(editor.selection.value.teeth).toEqual([46, 45, 44, 43, 42])
  })

  it('E — a pair is replaced as a pair, with no leftover from the old one', async () => {
    const { editor } = await openEdit(findingOn('X.5', [11, 21]))

    editor.startRetargetSubject()
    editor.pickTooth(12, UPPER_ROW)
    editor.pickTooth(22, UPPER_ROW)

    expect(editor.selection.value.teeth).toEqual([12, 22])
    expect(editor.problems.value).toEqual([])
  })

  it('F — a surface finding changes its tooth and its surfaces independently', async () => {
    const finding = makeFinding({
      rule_id: 'X.6',
      attributes: { surfaces: ['M', 'O'] },
      targets: [{
        id: 't0', group_index: 0, position: 0, participation: 'subject', role: null,
        target_kind: 'fdi_tooth', tooth_number: 16, arch: null, local_ordinal: null, geometry: null
      }]
    })
    const { editor } = await openEdit(finding)

    // Surfaces alone: the tooth is untouched.
    editor.attributes.value = { surfaces: ['M'] }
    expect(editor.selection.value.teeth).toEqual([16])

    // Tooth alone: the surfaces survive it.
    editor.startRetargetSubject()
    editor.pickTooth(26, UPPER_ROW)
    expect(editor.selection.value.teeth).toEqual([26])
    expect(editor.attributes.value).toEqual({ surfaces: ['M'] })
  })

  it('G — cancelling after local target changes sends nothing', async () => {
    const { editor } = await openEdit(findingOn('X.1', [16]))

    editor.startRetargetSubject()
    editor.pickTooth(26, UPPER_ROW)
    editor.close()

    expect(state.put).not.toHaveBeenCalled()
    expect(state.post).not.toHaveBeenCalled()
    expect(editor.isOpen.value).toBe(false)
  })

  it('H — saving an unchanged target sends no targets PUT', async () => {
    const finding = findingOn('X.1', [16])
    state.put.mockResolvedValue({ data: { record_version: 4, finding } })
    const { editor } = await openEdit(finding)

    // Retarget mode entered, then the same tooth picked again.
    editor.startRetargetSubject()
    editor.pickTooth(16, UPPER_ROW)
    expect(await editor.saveFinding(finding)).toBe(true)

    expect(state.put).toHaveBeenCalledTimes(1)
    expect(state.put.mock.calls[0]![0]).toBe('/api/v1/odontogram/nts/records/rec-1/findings/f1')
  })

  it('I — saving a changed target sends exactly one full-replacement PUT', async () => {
    const finding = findingOn('X.1', [16])
    state.put
      .mockResolvedValueOnce({ data: { record_version: 4, finding } })
      .mockResolvedValueOnce({ data: { record_version: 5, finding } })
    const { editor } = await openEdit(finding)

    editor.startRetargetSubject()
    editor.pickTooth(26, UPPER_ROW)
    expect(await editor.saveFinding(finding)).toBe(true)

    expect(state.put).toHaveBeenCalledTimes(2)
    const [url, body] = state.put.mock.calls[1]!
    expect(url).toBe('/api/v1/odontogram/nts/records/rec-1/findings/f1/targets')
    expect(body.expected_version).toBe(4)
    // Full replacement: the whole set, not a patch.
    expect(body.targets).toHaveLength(1)
    expect(body.targets[0].tooth_number).toBe(26)
  })

  it('J — a role the norm gives no bounds never blocks saving', async () => {
    const LOWER_ROW = [48, 47, 46, 45, 44, 43, 42, 41, 31, 32, 33, 34, 35, 36, 37, 38]
    const { editor } = await openEdit(findingOn('X.7', [46, 45, 44]))

    expect(editor.rule.value?.target_roles[0]?.min_count).toBeNull()
    expect(editor.rule.value?.target_roles[0]?.max_count).toBeNull()
    // No role assigned at all, and the selection is still valid.
    expect(editor.selection.value.roles).toEqual({})
    expect(editor.problems.value).toEqual([])

    editor.startRetargetSubject()
    editor.pickTooth(46, LOWER_ROW)
    editor.pickTooth(44, LOWER_ROW)
    expect(editor.problems.value).toEqual([])
  })

  it('K — a role survives while its tooth stays selected', async () => {
    const { editor } = await openEdit(findingOn('X.7', [46, 45, 44], { 46: 'pilar' }))

    expect(editor.selection.value.roles).toEqual({ 46: 'pilar' })

    editor.setRole(45, 'pilar')
    expect(editor.selection.value.roles).toEqual({ 46: 'pilar', 45: 'pilar' })
  })

  it('L — a role is dropped when its tooth leaves the selection', async () => {
    const PAIR_WITH_ROLE = makeRule({
      rule_id: 'X.9',
      scope: 'pair',
      target_roles: [{
        code: 'pilar', name: 'Pilar', applies_to: 'subject',
        min_count: null, max_count: null, status: 'verified', notes: null
      }]
    })
    const finding = findingOn('X.9', [11, 21], { 11: 'pilar' })
    const harness = await makeEditor({
      record: makeRecord({ version: 3, findings: [finding] }),
      rules: [...ALL_RULES, PAIR_WITH_ROLE]
    })
    const { editor } = harness
    editor.startEdit(finding)
    expect(editor.selection.value.roles).toEqual({ 11: 'pilar' })

    // A third pick pushes 11 out of a two-subject rule; its role goes with it.
    editor.setPickMode('subject')
    editor.pickTooth(12, UPPER_ROW)

    expect(editor.selection.value.teeth).toEqual([21, 12])
    expect(editor.selection.value.roles).toEqual({})

    // And nothing is sent for a tooth that is no longer part of the finding.
    const targets = buildTargets(editor.rule.value!, editor.selection.value)
    expect(targets.every(target => target.role === null)).toBe(true)
  })

  it('M — an arch finding still edits through its own selector', async () => {
    const finding = makeFinding({
      rule_id: 'X.2',
      targets: [{
        id: 't0', group_index: 0, position: 0, participation: 'subject', role: null,
        target_kind: 'arch', tooth_number: null, arch: 'upper', local_ordinal: null, geometry: null
      }]
    })
    state.put
      .mockResolvedValueOnce({ data: { record_version: 4, finding } })
      .mockResolvedValueOnce({ data: { record_version: 5, finding } })
    const { editor } = await openEdit(finding)

    expect(editor.selection.value.arches).toEqual(['upper'])
    // No tooth selection is ever offered for an arch-scoped rule.
    expect(editor.pickMode.value).toBe('none')

    editor.toggleArch('upper')
    editor.toggleArch('lower')
    expect(editor.selection.value.arches).toEqual(['lower'])
    expect(await editor.saveFinding(finding)).toBe(true)

    const [url, body] = state.put.mock.calls[1]!
    expect(url).toBe('/api/v1/odontogram/nts/records/rec-1/findings/f1/targets')
    expect(body.targets).toEqual([
      { participation: 'subject', target_kind: 'arch', arch: 'lower', group_index: 0, position: 0 }
    ])
  })

  it('anchors and subject are replaced independently', async () => {
    const finding = makeFinding({
      rule_id: 'X.8',
      targets: [
        { id: 's0', group_index: 0, position: 0, participation: 'subject', role: null, target_kind: 'unnumbered_tooth', tooth_number: null, arch: null, local_ordinal: null, geometry: null },
        { id: 'a0', group_index: 0, position: 1, participation: 'anchor', role: null, target_kind: 'fdi_tooth', tooth_number: 11, arch: null, local_ordinal: null, geometry: null },
        { id: 'a1', group_index: 0, position: 2, participation: 'anchor', role: null, target_kind: 'fdi_tooth', tooth_number: 12, arch: null, local_ordinal: null, geometry: null }
      ]
    })
    const { editor } = await openEdit(finding)

    expect(editor.selection.value.anchors).toEqual([11, 12])

    editor.startRetargetAnchors()
    expect(editor.pickMode.value).toBe('anchor')
    expect(editor.selection.value.anchors).toEqual([])

    editor.pickTooth(21, UPPER_ROW)
    editor.pickTooth(22, UPPER_ROW)
    expect(editor.selection.value.anchors).toEqual([21, 22])
    expect(editor.problems.value).toEqual([])
  })
})

// ---------------------------------------------------------------------------
// carried forward
// ---------------------------------------------------------------------------

describe('carried-forward findings are confirmed one at a time', () => {
  it('confirm hits the individual endpoint with the current version', async () => {
    const carried = makeFinding({ id: 'cf1', provenance: 'carried_forward' })
    state.post.mockResolvedValue({ data: { record_version: 4, finding: carried } })
    const { editor, reload } = await makeEditor({
      record: makeRecord({ version: 3, findings: [carried] })
    })

    expect(await editor.confirmFinding(carried)).toBe(true)

    expect(state.post).toHaveBeenCalledTimes(1)
    expect(state.post).toHaveBeenCalledWith(
      '/api/v1/odontogram/nts/records/rec-1/findings/cf1/confirm',
      { expected_version: 3 }
    )
    expect(reload).toHaveBeenCalledTimes(1)
  })

  it('there is no bulk confirmation anywhere in the editor', async () => {
    const { editor } = await makeEditor()
    expect(Object.keys(editor)).not.toContain('confirmAll')
    expect(JSON.stringify(Object.keys(editor))).not.toMatch(/confirmAll|confirm_all|confirm-all/)
  })
})

// ---------------------------------------------------------------------------
// remove
// ---------------------------------------------------------------------------

describe('removing a finding', () => {
  it('posts to remove, never DELETE, and carries no invented reason', async () => {
    const finding = makeFinding()
    state.post.mockResolvedValue({ data: { record_version: 4 } })
    const { editor, reload } = await makeEditor({ record: makeRecord({ findings: [finding] }) })

    expect(await editor.removeFinding(finding)).toBe(true)

    expect(state.post).toHaveBeenCalledWith(
      '/api/v1/odontogram/nts/records/rec-1/findings/f1/remove',
      { expected_version: 3 }
    )
    expect(state.post.mock.calls[0]![1]).not.toHaveProperty('reason')
    expect(reload).toHaveBeenCalledTimes(1)
  })
})

// ---------------------------------------------------------------------------
// conflicts and validation
// ---------------------------------------------------------------------------

describe('a 409 is reported, never retried', () => {
  it.each([
    ['nts_version_conflict', 'version'],
    ['nts_state_conflict', 'state'],
    ['nts_draft_conflict', 'draft']
  ])('%s closes the editor and recovers once', async (code, kind) => {
    state.post.mockRejectedValue(apiError(409, code))
    const { editor, onConflict, reload } = await makeEditor()

    editor.startCreate()
    editor.selectRule(TOOTH_RULE)
    editor.pickTooth(16, UPPER_ROW)
    expect(await editor.createFinding()).toBe(false)

    // Exactly one attempt: no silent re-send with a bumped version.
    expect(state.post).toHaveBeenCalledTimes(1)
    expect(onConflict).toHaveBeenCalledWith(kind)
    expect(reload).not.toHaveBeenCalled()
    // The editor's expected_version is stale, so the form does not stay open
    // inviting the clinician to press save again.
    expect(editor.isOpen.value).toBe(false)
  })
})

describe('a 422 shows every problem', () => {
  it('keeps the whole errors list and leaves the editor open', async () => {
    const problems = ['X.1: attribute kind is required', 'X.1: a finding needs at least one target']
    state.post.mockRejectedValue(apiError(422, 'nts_clinical_validation', problems))
    const { editor } = await makeEditor()

    editor.startCreate()
    editor.selectRule(TOOTH_RULE)
    editor.pickTooth(16, UPPER_ROW)
    expect(await editor.createFinding()).toBe(false)

    expect(editor.clinicalErrors.value).toEqual(problems)
    expect(editor.error.value).toBeNull()
    // Still open: the clinician has to fix something the server named.
    expect(editor.isOpen.value).toBe(true)
  })

  it('a transport failure is not mistaken for a clinical problem', async () => {
    state.post.mockRejectedValue(new Error('offline'))
    const { editor } = await makeEditor()

    editor.startCreate()
    editor.selectRule(TOOTH_RULE)
    editor.pickTooth(16, UPPER_ROW)
    await editor.createFinding()

    expect(editor.error.value?.message).toBe('offline')
    expect(editor.clinicalErrors.value).toEqual([])
  })
})

// ---------------------------------------------------------------------------
// resets
// ---------------------------------------------------------------------------

describe('unsaved state never crosses a boundary', () => {
  it('switching rule drops attributes, targets and roles', async () => {
    const { editor } = await makeEditor()

    editor.startCreate()
    editor.selectRule(ENUM_RULE)
    editor.attributes.value = { kind: 'A' }
    editor.pickTooth(16, UPPER_ROW)

    editor.selectRule(ARCH_RULE)

    expect(editor.attributes.value).toEqual({})
    expect(editor.selection.value).toEqual({ teeth: [], arches: [], anchors: [], roles: {} })
    expect(editor.pickMode.value).toBe('none')
  })

  it('switching patient closes the editor and keeps nothing from the old one', async () => {
    const { editor, record } = await makeEditor()

    editor.startCreate()
    editor.selectRule(ENUM_RULE)
    editor.attributes.value = { kind: 'A' }
    editor.pickTooth(16, UPPER_ROW)
    expect(editor.isOpen.value).toBe(true)

    // A different patient means a different record id.
    record.value = makeRecord({ id: 'rec-b', patient_id: 'patient-b', version: 1 })
    await nextTick()

    expect(editor.isOpen.value).toBe(false)
    expect(editor.editing.value).toBeNull()
    expect(editor.rule.value).toBeNull()
    expect(editor.attributes.value).toEqual({})
    expect(editor.selection.value.teeth).toEqual([])
  })

  it('nothing clinical is written to browser storage', () => {
    // Asserted against the source: the app itself uses localStorage for
    // unrelated preferences, so an empty-store check would prove nothing.
    for (const relative of [
      '../backend/app/modules/odontogram/frontend/composables/useNtsFindingEditor.ts',
      '../backend/app/modules/odontogram/frontend/utils/ntsFindingModel.ts',
      '../backend/app/modules/odontogram/frontend/components/odontogram/NtsFindingEditor.vue',
      '../backend/app/modules/odontogram/frontend/components/odontogram/NtsTargetEditor.vue',
      '../backend/app/modules/odontogram/frontend/components/odontogram/NtsAttributeEditor.vue',
      '../backend/app/modules/odontogram/frontend/components/odontogram/NtsFindingPicker.vue',
      '../backend/app/modules/odontogram/frontend/components/odontogram/NtsFindingList.vue'
    ]) {
      const source = readFileSync(resolve(process.cwd(), relative), 'utf8')
      expect(source).not.toMatch(/\b(?:localStorage|sessionStorage|indexedDB)\s*[.[]/)
    }
  })
})

// ---------------------------------------------------------------------------
// gating
// ---------------------------------------------------------------------------

describe('when the editor may open at all', () => {
  it('is available over a draft', async () => {
    const { editor } = await makeEditor()
    expect(editor.canEdit.value).toBe(true)
  })

  it('is unavailable with no record', async () => {
    const { editor } = await makeEditor({ record: null })
    expect(editor.canEdit.value).toBe(false)
    expect(await editor.createFinding()).toBe(false)
    expect(state.post).not.toHaveBeenCalled()
  })

  it('is unavailable over a finalized record', async () => {
    const { editor } = await makeEditor({ record: makeRecord({ status: 'finalized' }) })
    expect(editor.canEdit.value).toBe(false)
  })

  it('is unavailable without a catalog, and never falls back to a built-in list', async () => {
    const { editor } = await makeEditor({ rules: [] })
    expect(editor.canEdit.value).toBe(false)
    expect(state.post).not.toHaveBeenCalled()
    expect(state.put).not.toHaveBeenCalled()
  })

  it('a draft with no findings can still take the first one', async () => {
    state.post.mockResolvedValue({ data: { record_version: 4, finding: makeFinding() } })
    const { editor } = await makeEditor({ record: makeRecord({ findings: [] }) })

    editor.startCreate()
    editor.selectRule(TOOTH_RULE)
    editor.pickTooth(16, UPPER_ROW)
    expect(await editor.createFinding()).toBe(true)
  })
})
