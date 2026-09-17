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
 * One normative rule. Typed loosely on purpose: the renderer tickets read
 * these fields, 05A only needs identity and the norm label, and narrowing
 * them here would start duplicating the catalog's own schema.
 */
export interface NtsRule {
  rule_id: string
  ordinal: number
  official_name: string
  scope: string
  target_identity: string
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
