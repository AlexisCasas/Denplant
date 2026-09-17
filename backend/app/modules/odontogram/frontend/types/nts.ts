/**
 * NTS clinical record — HTTP contract types (NTS-05A).
 *
 * These mirror `backend/app/modules/odontogram/nts/schemas.py` and nothing
 * else. The *normative* content — the 38 rules, siglas, crown types, caries
 * types, roles, specification requirements, colours, scopes — is never
 * declared here: it arrives from `GET /nts/catalogs/{norm_version}` and the
 * catalog stays its single source. Any `const NTS_RULES = [...]` in this
 * layer would be a second hand-maintained copy of a legal norm.
 */

/** A record's lifecycle state. Terminal states are never edited. */
export type NtsRecordStatus = 'draft' | 'discarded' | 'finalized'

/** How a new draft is populated. 05A only offers `empty`. */
export type NtsDraftSeed = 'empty' | 'carry_forward'

/** Whether a finding was observed now or carried from an earlier record. */
export type NtsFindingProvenance = 'observed' | 'carried_forward'

// ---------------------------------------------------------------------------
// catalog
// ---------------------------------------------------------------------------

export interface NtsRuleAttributeValue {
  code: string
  name: string
  status: string
  notes: string | null
  specification_requirement: NtsSpecificationRequirement | null
}

export interface NtsSpecificationRequirement {
  code: string
  label: string
  required: boolean
  status: string
  notes: string | null
}

export interface NtsRuleAttribute {
  name: string
  kind: string
  required: boolean
  is_sigla: boolean
  values: NtsRuleAttributeValue[]
  status: string
  notes: string | null
}

export interface NtsRoleDef {
  code: string
  name: string
  applies_to: string
  min_count: number | null
  max_count: number | null
  status: string
  notes: string | null
}

/**
 * Clinical reach of a rule. The platform vocabulary; NTS N.° 188 uses every
 * member except `mouth`, which is why the editor builds no UI for it.
 */
export type NtsScope = 'tooth' | 'surface' | 'pair' | 'range' | 'arch' | 'mouth'

/** Whether the clinical subject carries an FDI number. A supernumerary
 * tooth does not: it exists, but the chart has no cell for it. */
export type NtsTargetIdentity = 'numbered' | 'unnumbered'

/** A spatial reference that positions a mark and asserts nothing clinical. */
export interface NtsAnchorDef {
  kind: string
  cardinality: number
  role: string
}

/**
 * One normative rule.
 *
 * These fields are what the editor reads to build itself; the index
 * signature keeps the rest of the catalog reachable without this file
 * becoming a second copy of the catalog's schema. Nothing here is a value
 * *of* the norm — only the shape the catalog serves.
 */
export interface NtsRule {
  rule_id: string
  ordinal: number
  official_name: string
  scope: NtsScope
  target_identity: NtsTargetIdentity
  anchor: NtsAnchorDef | null
  arch_cardinality: 'one' | 'one_or_both' | null
  range_grouping: 'single_segment' | 'multi_segment' | null
  attributes: NtsRuleAttribute[]
  target_roles: NtsRoleDef[]
  specification_requirement: NtsSpecificationRequirement | null
  status: string
  [key: string]: unknown
}

export interface NtsCatalog {
  norm_version: string
  norm_label: string
  country: string
  expected_rule_count: number
  rules: NtsRule[]
  pending_decisions: string[]
  [key: string]: unknown
}

export interface NtsCatalogVersions {
  norm_versions: string[]
}

// ---------------------------------------------------------------------------
// clinical record
// ---------------------------------------------------------------------------

export interface NtsFindingTarget {
  id: string
  group_index: number
  position: number
  participation: string
  role: string | null
  target_kind: string
  tooth_number: number | null
  arch: string | null
  local_ordinal: number | null
  /** Reserved. GEOMETRY CONTRACT PENDING — always null in this version. */
  geometry: Record<string, unknown> | null
}

export interface NtsFinding {
  id: string
  record_id: string
  norm_version: string
  rule_id: string
  attributes: Record<string, unknown>
  provenance: NtsFindingProvenance
  source_finding_id: string | null
  sequence: number
  created_at: string
  created_by: string
  targets: NtsFindingTarget[]
}

export interface NtsSpecification {
  id: string
  record_id: string
  finding_id: string | null
  text: string
  sequence: number
}

export interface NtsRecord {
  id: string
  clinic_id: string
  patient_id: string
  norm_version: string
  stage: string
  stage_label: string | null
  status: NtsRecordStatus
  /** The next `expected_version` a mutation must send. */
  version: number
  observations: string | null

  recorded_at: string
  recorded_by: string
  finalized_at: string | null
  finalized_by: string | null
  discarded_at: string | null
  discarded_by: string | null
  discard_reason: string | null

  recorded_by_name: string | null
  recorded_by_role: string | null
  recorded_by_professional_id: string | null

  supersedes_record_id: string | null
  supersession_reason: string | null

  /**
   * Attests the content has not changed since it was finalized. It is not a
   * digital signature and implies no compliance claim.
   */
  content_hash: string | null
  hash_algorithm: string | null
  canonicalization_version: number | null

  created_at: string
  updated_at: string

  findings: NtsFinding[]
  specifications: NtsSpecification[]
}

export interface NtsRecordSummary {
  id: string
  patient_id: string
  norm_version: string
  stage: string
  stage_label: string | null
  status: NtsRecordStatus
  version: number
  recorded_at: string
  finalized_at: string | null
  discarded_at: string | null
  supersedes_record_id: string | null
  content_hash: string | null
  /** Derived server-side: a finalized record supersedes this one. */
  is_superseded: boolean
}

// ---------------------------------------------------------------------------
// requests
// ---------------------------------------------------------------------------

export interface NtsDraftCreatePayload {
  norm_version: string
  stage: string
  stage_label?: string | null
  observations?: string | null
  seed?: NtsDraftSeed
  supersedes_record_id?: string | null
  supersession_reason?: string | null
}

export interface NtsDiscardPayload {
  expected_version: number
  reason: string
}

// --- findings ---------------------------------------------------------------

/** Whether a target carries the finding or merely positions it. */
export type NtsTargetParticipation = 'subject' | 'anchor'

/** What kind of entity a target is. There are deliberately no fake FDIs. */
export type NtsTargetKind = 'fdi_tooth' | 'unnumbered_tooth' | 'arch'

/** One target, exactly as `NtsTargetInput` declares it. */
export interface NtsTargetPayload {
  participation: NtsTargetParticipation
  target_kind: NtsTargetKind
  tooth_number?: number | null
  arch?: string | null
  local_ordinal?: number | null
  role?: string | null
  group_index?: number
  position?: number
}

/** A finding and its targets, created as one aggregate in one request. */
export interface NtsFindingCreatePayload {
  expected_version: number
  rule_id: string
  attributes: Record<string, unknown>
  targets: NtsTargetPayload[]
}

export interface NtsAttributesReplacePayload {
  expected_version: number
  attributes: Record<string, unknown>
}

export interface NtsTargetsReplacePayload {
  expected_version: number
  targets: NtsTargetPayload[]
}

/**
 * Every finding mutation answers with the version the record actually
 * reached, so no client ever infers `expected_version + 1`.
 */
export interface NtsFindingMutationResult {
  record_version: number
  finding: NtsFinding
}

export interface NtsVersionMutationResult {
  record_version: number
}

export interface NtsExpectedVersionPayload {
  expected_version: number
}

// ---------------------------------------------------------------------------
// errors
// ---------------------------------------------------------------------------

/** Machine-readable codes the NTS API returns. */
export type NtsErrorCode =
  | 'nts_record_not_found'
  | 'nts_version_conflict'
  | 'nts_state_conflict'
  | 'nts_draft_conflict'
  | 'nts_clinical_validation'
  | 'nts_norm_version_unknown'

/** A normalised API failure, whatever shape the transport delivered. */
export interface NtsApiError {
  status: number | null
  code: NtsErrorCode | null
  message: string
  /**
   * Every problem the server reported, never just the first: a clinician
   * should fix one form, not N.
   */
  errors: string[]
}
