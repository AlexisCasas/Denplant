# NTS record persistence model

Design reference for the clinical records produced under an NTS odontogram
profile. Written for engineers implementing NTS-04B, and for anyone who
later has to verify a finalized record's integrity.

**Status: design only.** Nothing described here is implemented. There are
no tables, no models, no migrations, no endpoints and no services yet.

Companion documents:

- [`nts-188-catalog.md`](./nts-188-catalog.md) — the normative catalog
  (NTS-03): 38 rules, scopes, attributes, render vocabulary, geometry modes.
- [ADR 0021](../../adr/0021-nts-record-persistence-model.md) — why this
  table shape.
- [ADR 0022](../../adr/0022-nts-lifecycle-auditability-concurrency.md) —
  lifecycle, auditability, concurrency. **This is the one a legal or
  clinical reviewer should read.**

---

## 1. Scope and non-goals

The catalog says what a norm *requires*. This model says what a clinic
*recorded*. The two never merge: a record cites `norm_version + rule_id`
and the catalog interprets it.

| Not in this model | Where it lives |
|---|---|
| Normative rule definitions | the catalog (NTS-03), immutable and versioned |
| `ToothRecord`, `Treatment`, `TreatmentTooth`, `OdontogramHistory` | the Original profile, untouched (§13) |
| Colour values | derived from `render.color_semantics` + attributes |
| Digital signature, PKI, SIHCE accreditation | later workstream (§12) |
| Freehand geometry capture | pending the coordinate contract (§11) |

---

## 2. The five tables

```
nts_odontogram_records ─┬─ N nts_findings ──── N nts_finding_targets
                        ├─ N nts_record_specifications
                        └─ N nts_record_audit_events   (append-only)
```

### 2.1 `nts_odontogram_records`

**Purpose.** One clinical odontogram document: a dated, authored snapshot
of what was observed, under one norm version.

| Conceptual field | Notes |
|---|---|
| `id` | UUID PK |
| `clinic_id`, `patient_id` | live FKs, both indexed (multi-tenancy is mandatory) |
| `norm_version` | frozen at creation; never recalculated against a later catalog |
| `stage` | `diagnosis \| evolution \| discharge \| other` — **metadata, not a slot** |
| `stage_label` | free label; required when `stage = 'other'` |
| `status` | `draft \| discarded \| finalized` (§3) |
| `version` | optimistic-locking counter, `>= 1` (§5) |
| `observations` | Text. NTS §5.15: findings outside the nomenclature |
| `recorded_at`, `recorded_by` | when/who opened the record |
| `finalized_at`, `finalized_by` | set together with `status='finalized'` |
| `discarded_at`, `discarded_by`, `discard_reason` | set together with `status='discarded'` |
| `recorded_by_name`, `recorded_by_role`, `recorded_by_professional_id` | authorship snapshot frozen at finalize (§9) |
| `supersedes_record_id` | self-FK, nullable — the record this one corrects |
| `supersession_reason` | required exactly when `supersedes_record_id` is set |
| `content_hash`, `hash_algorithm`, `canonicalization_version` | integrity (§10); NULL unless finalized |
| `created_at`, `updated_at` | `TimestampMixin` |

There is deliberately **no `profile` column**: for an NTS record the
profile *is* the `norm_version`.

**Cardinalities.** 1 → N findings, 1 → N specifications, 1 → N audit
events, 0..1 → 1 supersession predecessor.

**PostgreSQL enforces:** value domains for `status` and `stage`; the
coherence triples of §3.3; `version >= 1`; the one-draft partial unique
index (§6); the linear-chain partial unique index (§7); `supersedes_record_id
IS DISTINCT FROM id`.

**Service + catalog enforce:** that `norm_version` names a bundled catalog;
that a supersession target exists, is `finalized`, and shares
`clinic_id + patient_id + norm_version`; every finalize gate (§8, §10).

### 2.2 `nts_findings`

**Purpose.** One observed clinical finding, citing one catalog rule.

| Conceptual field | Notes |
|---|---|
| `id` | UUID PK |
| `record_id` | FK → records, `ON DELETE CASCADE` |
| `norm_version` | present for indexing; see the composite FK below |
| `rule_id` | e.g. `6.1.16` — first-class query axis, a real column |
| `attributes` | JSONB, validated against the catalog (§4) |
| `provenance` | `observed \| carried_forward` (§8) |
| `source_finding_id` | nullable; the finding this was carried from |
| `sequence` | int, unique per record — deterministic render/print order |
| `created_at`, `created_by` | who added this finding, and when |

**Composite FK, and only that one.** `nts_findings (record_id,
norm_version)` references `nts_odontogram_records (id, norm_version)`, which
carries a matching `UNIQUE (id, norm_version)`. The finding physically
carries `norm_version` — indexable, no join — and divergence from its record
is impossible by construction rather than by convention.

There is deliberately **no separate FK on `record_id` alone**. Both columns
are `NOT NULL`, so MATCH SIMPLE never short-circuits and the composite
constraint already guarantees parent existence, version equality and the
`ON DELETE CASCADE`. A second constraint would only duplicate the check,
split the ORM join into two paths and widen the migration surface.

**Not stored, deliberately:**

- **Colour.** A pure function of the rule's `color_semantics` and the
  `condition_state` attribute. Persisting it would duplicate the catalog
  and let a record drift from the norm.
- **Free `notes`.** The norm routes prose to *Especificaciones* (§5.14) or
  *Observaciones* (§5.15). A third prose channel on the finding would break
  the normative format. Per-finding prose goes to a specification row (§7.2
  below, `nts_record_specifications`).
- **Any link to `Treatment`.** A finding is not a procedure (NTS §5.8). No
  `odontogram.treatment.*` event is published, so budget, treatment_plan
  and agenda see nothing — which is correct at this stage.

**PostgreSQL enforces:** `jsonb_typeof(attributes) = 'object'`;
`provenance` domain; `UNIQUE (record_id, sequence)`; the composite FK;
cascade from the record.

**Service + catalog enforce:** that `rule_id` exists in that
`norm_version`; that `attributes` match the rule's `AttributeDef` set
(required keys, enum membership, `enum_multi` subset, `fixed` value,
integer kind); that `surfaces` ⊆ the codes the rule declares.

### 2.3 `nts_finding_targets`

**Purpose.** What a finding is about, and what merely positions it.

| Conceptual field | Notes |
|---|---|
| `id` | UUID PK |
| `finding_id` | FK → findings, `ON DELETE CASCADE` |
| `group_index` | int — segments of one finding (§3 below) |
| `position` | int — order within a group |
| `participation` | `subject \| anchor` |
| `role` | nullable normative role, e.g. `pilar` |
| `target_kind` | `fdi_tooth \| unnumbered_tooth \| arch` |
| `tooth_number` | FDI; NULL unless `target_kind='fdi_tooth'` |
| `arch` | `upper \| lower`; NULL unless `target_kind='arch'` |
| `local_ordinal` | distinguishes two unnumbered subjects between the same anchors |
| `geometry` | JSONB nullable — **reserved, no capture yet** (§11) |

**Three target kinds, no fake FDI numbers.**

| `target_kind` | `tooth_number` | `arch` | Used by |
|---|---|---|---|
| `fdi_tooth` | NOT NULL, FDI-checked | NULL | most rules |
| `unnumbered_tooth` | **NULL** | NULL | 6.1.26 supernumerary |
| `arch` | NULL | NOT NULL | 6.1.2, 6.1.7, 6.1.30 |

`tooth_number = 0` or `99` as a sentinel is forbidden. A subject the chart
cannot number is `unnumbered_tooth` with NULL, identified by its anchors
plus `local_ordinal`.

**Grouping without a third table.** One finding may cover disjoint
stretches via `group_index`:

| Rule | Shape |
|---|---|
| 6.1.31 removable partial prosthesis | one finding, several `group_index` values — the norm's own figure draws two non-contiguous segments for one appliance |
| 6.1.29 fixed partial prosthesis | exactly one group; abutments carry `role='pilar'` |
| 6.1.26 supernumerary | one `unnumbered_tooth` subject + two `fdi_tooth` anchors |

A `TargetGroup` table would only be justified if a group carried **its own
metadata**. Across the 38 rules of NTS N.° 188 it never does: roles hang
off teeth, not off the span. **Revisable decision** — a future norm that
attaches data to a segment forces the third table.

**PostgreSQL enforces:** `participation` and `target_kind` domains; the
per-kind column coherence in the table above; FDI validity when
`target_kind='fdi_tooth'`; `UNIQUE (finding_id, group_index, position)`;
`arch IN ('upper','lower')`; cascade from the finding.

**Service + catalog enforce:** scope coherence (target kinds, counts and
grouping matching the rule's `scope`); `arch_cardinality` `one` ⇒ exactly
one arch target, `one_or_both` ⇒ one or two; `range_grouping`
`single_segment` ⇒ exactly one group; exactly two `anchor` targets for
6.1.26 and none elsewhere; geometry present **iff** the rule's
`geometry_input.mode = 'clinician_defined_shape'`.

### 2.4 `nts_record_specifications`

**Purpose.** NTS §5.14 *Especificaciones* — data the norm sends outside the
boxes, usually about one specific finding.

| Conceptual field | Notes |
|---|---|
| `id` | UUID PK |
| `record_id` | FK → records, `ON DELETE CASCADE` |
| `finding_id` | nullable FK → findings |
| `text` | Text |
| `sequence` | int — preserves the normative list order |

Three rules route content here normatively: 6.1.3 (crown metal colour),
6.1.4 (temporary crown material), 6.1.5 (fluorosis classification).
`finding_id` is what lets the UI prompt contextually ("you recorded `CM` —
specify the metal colour") and what lets the printed *Especificaciones*
list say which finding each line extends.

*Especificaciones* and *Observaciones* are different normative concepts and
are **never concatenated**: observations are global Text on the record;
specifications are rows here.

**PostgreSQL enforces:** `UNIQUE (record_id, sequence)`; both cascades;
that a referenced finding belongs to the same record is *not* expressible
in a CHECK — see below.

**Service enforces:** that `finding_id`, when set, belongs to `record_id`;
that rules requiring a specification have one at finalize.

### 2.5 `nts_record_audit_events`

**Purpose.** Append-only trail of every persisted change, from the first
write in draft. See §5.

| Conceptual field | Notes |
|---|---|
| `id` | UUID PK |
| `clinic_id` | FK → clinics, indexed |
| `record_id` | FK → records, **`ON DELETE RESTRICT`** |
| `record_version` | the record's `version` *after* the change |
| `entity_type` | `record \| finding \| target \| specification` |
| `entity_id` | UUID nullable (NULL for record-level events) |
| `action` | see the closed list in §5.2 |
| `previous_state` | JSONB nullable |
| `new_state` | JSONB nullable |
| `changed_by` | FK → users |
| `changed_at` | timestamptz |
| `notes` | Text nullable |

This mirrors the repo's existing `{entity}_history` pattern
(`budget_history`, `invoice_history`, `payment_history`) with two
deliberate deviations, both explained in ADR 0022: `ON DELETE RESTRICT`
instead of `CASCADE`, and the added `record_version`.

**PostgreSQL enforces:** `entity_type` and `action` domains; RESTRICT; and
a planned `BEFORE UPDATE OR DELETE` trigger that rejects both. *(The
trigger is specified here and implemented in NTS-04B.)*

**Service enforces:** that exactly one event is written per persisted
mutation, in the same transaction, carrying the post-bump
`record_version`.

---

## 3. Lifecycle

### 3.1 States and transitions

```
         ┌─────────┐
         │  draft  │   editable, versioned, audited from the first write
         └────┬────┘
              ├──────────▶  discarded   (terminal)
              └──────────▶  finalized   (terminal)
```

Allowed: `draft → discarded`, `draft → finalized`.

Forbidden, with no exception: `finalized → draft`, `discarded → draft`,
`finalized → discarded`, and any other transition.

### 3.2 What `draft` is

> `draft` is DenPlant's editable working state.

DenPlant makes **no claim** — in either direction — about whether a draft
constitutes a clinical record under the Peruvian electronic health record
framework. That qualification belongs to the applicable framework and to
legal review, not to this software.

Independently of how that question is answered: **every clinical datum
persisted during draft carries full traceability from its first write** —
who, when, which entity, which action, which record version, and what
changed (§5).

### 3.3 Coherence triples

`status` and its satellite columns move together, enforced by CHECK:

```
(status = 'finalized')  ⟺  finalized_at IS NOT NULL AND finalized_by IS NOT NULL
(status = 'discarded')  ⟺  discarded_at IS NOT NULL AND discarded_by IS NOT NULL
                            AND discard_reason IS NOT NULL
(status = 'finalized')  ⟺  content_hash IS NOT NULL AND hash_algorithm IS NOT NULL
                            AND canonicalization_version IS NOT NULL
(supersedes_record_id IS NULL)  ⟺  (supersession_reason IS NULL)
supersedes_record_id IS DISTINCT FROM id
version >= 1
```

### 3.4 No hard delete

**An NTS record is never physically deleted.** An abandoned draft becomes
`discarded`, keeping `discarded_at`, `discarded_by` and `discard_reason`,
and stays queryable and auditable.

A conditional hard-delete for "a scaffold that never held clinical data"
was considered and rejected: proving *never* requires trusting the audit
trail, which would add a second destructive code path guarded by an
invariant whose violation destroys data silently — to save rows that cost
nothing.

Retention and purge policy for discarded records is **out of scope for
NTS-04B** and subject to a legal/operational decision.

---

## 4. Attributes: JSONB, not columns

`nts_findings.attributes` is JSONB, and it is **not free JSON**. Its keys
and values are defined by `norm_version + rule_id` in the catalog, and the
service validates every write against `get_nts_rule(rule_id, norm_version)`.

| | PostgreSQL | Service + catalog |
|---|---|---|
| Responsibility | **shape** | **normative meaning** |
| Checks | `jsonb_typeof(attributes) = 'object'`, GIN index for containment queries | required keys present; enum membership; `enum_multi` subset; `fixed` value; `integer` kind; `surfaces` ⊆ the rule's codes |

**Why not columns** (`crown_type`, `caries_type`, `absence_type`, …):

1. **It would duplicate normative semantics in DDL.** A CHECK expressing
   "`crown_type` is required iff `rule_id = '6.1.3'`" has to enumerate 38
   rules in SQL — a second hand-maintained copy of the norm, which NTS-03
   forbade when it made the catalog the single source.
2. **Norms are versioned; a column set is global.** A second norm, or a
   revision of this one, would mean a migration per norm.
3. **Sparsity.** Each rule uses one to three attributes, so ~10 columns
   would be almost entirely NULL on every row.
4. `rule_id` stays a real column, so the common queries ("all caries
   findings", "findings by rule") need no JSONB at all.

The choice is made **for versioning and single-source**, not for
convenience — and it matches how the repo already stores catalog-shaped
data (`PeriodontogramSnapshot.indices`, `Treatment` price snapshots).

---

## 5. Audit trail

### 5.1 Why a dedicated table

The repo was audited for reusable infrastructure. Nothing fits:

| Candidate | Verdict |
|---|---|
| `patient_timeline` | Event-bus driven, and NTS publishes no events by design. A `removable` candidate — an audit trail you can uninstall is not one. Stores no previous/new state, so it cannot answer "what changed". It is a display feed. |
| `AgentAuditLog` (`core/agents`) | Agent-specific (`agent_id`, `session_id`, `tool_name`). |
| `core/events` | In-memory bus, no persistence. |
| `budget_history` / `invoice_history` / `payment_history` | **The repo's canonical pattern** — but a repeated per-entity shape, not a shared facility. |

So NTS-04B follows the established pattern rather than inventing a new
shape.

### 5.2 Actions

```
record_created            record_metadata_updated
finding_created           finding_updated            finding_removed
target_changed
specification_changed
carried_forward           carried_forward_confirmed
discarded                 finalized
supersession_recorded
```

### 5.3 `supersession_recorded` — resolving the ambiguity

"Superseded" is ambiguous about *which* record the event belongs to. The
contract is explicit:

- The event is written **against the superseding (new) record**:
  `record_id` = the new record's id, emitted at the moment it is finalized
  with a non-NULL `supersedes_record_id`. Its `new_state` carries
  `{supersedes_record_id, supersession_reason}`.
- **The superseded (old) record receives no audit event and no mutation.**
  Its `status` stays `finalized` and its `content_hash` stays valid.
- When an audit view for the old record needs to show "superseded by S",
  that row is **derived** from the inverse relation at read time. It is
  never stored.

### 5.4 Append-only

No UPDATE, no DELETE. Enforced by service discipline plus the planned
trigger (§2.5). The trigger is recommended here more strongly than
anywhere else in the model, because append-only-ness *is* the table's
entire value and the trigger needs no joins.

---

## 6. Concurrency: optimistic locking

The repo has **no existing optimistic-locking pattern** — no
`version_id_col`, no `__mapper_args__` anywhere. NTS-04B introduces one.

SQLAlchemy's `version_id_col` was rejected: it bumps only on UPDATE of the
versioned row, so inserting a finding would not bump the record — exactly
the case that has to be covered.

### 6.1 The pattern

Every mutating operation begins with one statement:

```sql
UPDATE nts_odontogram_records
   SET version = version + 1, updated_at = now()
 WHERE id = :record_id
   AND version = :expected_version
   AND status = 'draft'
RETURNING version;
```

Zero rows → **409 Conflict** (stale version, or no longer a draft; a
follow-up read distinguishes the message for the client). Never
last-write-wins, never a silent overwrite.

That single statement does three jobs at once: it detects the conflict, it
bumps the version, and it takes a row-level exclusive lock on the parent
for the rest of the transaction — which serialises concurrent child
mutations on the same record.

### 6.2 Transaction shape

```
BEGIN
  1. compare-and-bump the parent record   → 0 rows ⇒ 409, rollback
  2. the mutation (record / finding / target / specification)
  3. the audit event, carrying the post-bump record_version
COMMIT
```

The bump happens **before** any mutation of the record, a finding, a
target, a specification, a carry-forward confirmation, a finalize or a
discard. `expected_version` travels in the request body; the repo has no
ETag/`If-Match` convention, so none is invented.

### 6.3 One draft

```sql
UNIQUE (clinic_id, patient_id, norm_version) WHERE status = 'draft'
```

No draft per professional: an odontogram is one document about one mouth
at one time, and two drafts would produce two conflicting "current"
pictures with no merge semantics. No draft per stage: `stage` is metadata,
and a draft per stage would reintroduce fixed slots through the back door.

---

## 7. Supersession and the current record

### 7.1 Correcting a finalized record

A finalized record is never edited. A correction is a **new record**
carrying `supersedes_record_id` and a required `supersession_reason`. The
predecessor keeps `status = 'finalized'` and is not touched.

`superseded` is a **derived** state obtained through the inverse relation,
never a persisted `status` value.

```sql
-- linear chain: at most one finalized successor per record
UNIQUE (supersedes_record_id)
  WHERE status = 'finalized' AND supersedes_record_id IS NOT NULL
```

Without that index the chain could fork and "which record is current?"
would have no single answer.

### 7.2 Two different questions

```python
get_editable_draft()   # the active draft, or None
get_current_record()   # the clinically current finalized record
```

A draft **never** replaces the current finalized record. The current
record is the most recent finalized one that no finalized record
supersedes:

```sql
SELECT r.* FROM nts_odontogram_records r
 WHERE r.clinic_id = :c AND r.patient_id = :p AND r.norm_version = :v
   AND r.status = 'finalized'
   AND NOT EXISTS (
         SELECT 1 FROM nts_odontogram_records s
          WHERE s.supersedes_record_id = r.id AND s.status = 'finalized')
 ORDER BY r.finalized_at DESC
 LIMIT 1;
```

The `NOT EXISTS` drops corrected records; the `ORDER BY` picks among the
ordinary clinical succession (several finalized records that do not
supersede each other — the normal case under NTS §5.10–5.11). A superseded
record stops being current but remains fully accessible.

---

## 8. Carry-forward

A new draft may be seeded from the last finalized record. Each copied
finding arrives with:

```
provenance        = carried_forward
source_finding_id = <the original finding>
```

Each must be reviewed individually:

- **confirm** → `provenance` becomes `observed`;
- **remove** → deleted from the draft, leaving a `finding_removed` audit
  event.

**Finalize is blocked while any `carried_forward` finding remains.** There
is deliberately **no "confirm all" action**: a single button would turn
reviewed carry-forward back into blind copying, and the software would
assert observations the clinician never made on that date.

A record with **zero findings is valid** and may be finalized. The norm
records findings, not health, so no minimum is invented.

---

## 9. Targets, pair rules, and the queries that must not lie

### 9.1 `participation` stays binary

`participation ∈ {subject, anchor}`. No `member` value is added.

For 6.1.26, teeth 11 and 21 are `anchor`: they position the mark between
the apices and assert nothing clinical. `"findings on tooth 11"` is
therefore `WHERE tooth_number = 11 AND participation = 'subject'`, and a
service that only exposes subjects makes the wrong query unreachable.

### 9.2 Direct vs relational is derived, not stored

Tested against all three `pair` rules:

| Rule | "Tooth 11 has X"? | Nature |
|---|---|---|
| 6.1.6 Diastema | **false** — the subject is the space between | relational |
| 6.1.11 Fusión | true — 11 *is* a fused tooth | relational, and alters both |
| 6.1.38 Transposición | true — 11 *is* out of position | relational, and alters both |

A uniform `member` would under-claim for fusion and transposition, so it
solves nothing. More importantly, the direct/relational distinction is
**already a property of the rule's `scope`**, which the catalog holds.
Storing it on the target would duplicate normative semantics in the
database — the single-source violation NTS-03 forbade.

It is therefore derived:

```python
DIRECT      = {"tooth", "surface"}
RELATIONAL  = {"pair", "range", "arch"}

direct_findings_for_tooth(t)             # participation='subject' AND rule_id IN direct_rule_ids
relational_findings_involving_tooth(t)   # participation='subject' AND rule_id IN relational_rule_ids
```

The service resolves rule ids by scope from the cached catalog (38 rules,
in memory) and filters with `rule_id IN (...)`.

For 6.1.6 both teeth are `subject` with `scope='pair'`, and **the clinical
assertion is relational** — the space between them. No query may render
that as "tooth 11 has a diastema". No dedicated interdental-space entity is
created for a single rule.

`range` rules need no special case: an abutment genuinely carries the
bridge, and `role='pilar'` already says so. `arch` rules have no dental
targets at all.

### 9.3 Surfaces

Affected surfaces are persisted inside `attributes` (five rules declare a
`surfaces` attribute: 6.1.5, 6.1.16, 6.1.33, 6.1.34, 6.1.36; 6.1.35 derives
its region from fissure anatomy instead).

The codes coincide with `M/D/O/V/L`, but **the authority is the versioned
NTS catalog, not `constants.SURFACES`** of the Original profile. Because
they are stored as literal strings sourced from a frozen catalog, a
historical record stays self-describing: if `constants.SURFACES` ever
changes, NTS records are unaffected.

Surface-scoped rules are single-target, so attributes-on-finding loses no
information. If a future norm needs different surfaces per target, they
move to `nts_finding_targets`.

---

## 10. Integrity: `content_hash` and CanonicalSnapshotV1

### 10.1 The columns

| Column | draft | discarded | finalized |
|---|---|---|---|
| `content_hash` | NULL | NULL | **NOT NULL** — 64 lowercase hex chars |
| `hash_algorithm` | NULL | NULL | **NOT NULL** — `"sha256"` |
| `canonicalization_version` | NULL | NULL | **NOT NULL** — `1` |

NTS-04B ships **no `previous_hash`**, no hash chain between records, and no
digital signature.

### 10.2 What the hash is for

To prove that the clinical content of a finalized record has not changed
since it was finalized. Nothing more — see §12.

### 10.3 CanonicalSnapshotV1 — included fields

The goal: *the same clinical record → the same canonical bytes → the same
SHA-256*, independent of query order, dict ordering, local timezone, ORM
version or frontend version.

**Record level**

| Field | Why it is in |
|---|---|
| `id` | binds the hash to this record; a hash cannot be transplanted |
| `clinic_id`, `patient_id` | a record about a different patient is a different document |
| `norm_version` | changes the interpretation of everything below |
| `stage`, `stage_label` | clinical metadata printed on the chart |
| `observations` | normative content (§5.15) |
| `supersedes_record_id`, `supersession_reason` | part of the assertion: *this corrects X because Y* |
| `recorded_at`, `recorded_by` | who opened the record, and when |
| `finalized_at`, `finalized_by` | the act being attested |
| `recorded_by_name`, `recorded_by_role`, `recorded_by_professional_id` | the authorship claim; a **stored snapshot**, never a live join (§9 of ADR 0022) |

**Findings**, sorted by `(sequence, id)` — `id` makes the order total:

`id`, `rule_id`, `attributes`, `provenance`, `source_finding_id`,
`sequence`, `created_at`, `created_by`.

`norm_version` is *not* repeated per finding: the composite FK
(`record_id, norm_version`) already makes it structurally equal to the
record's.

`provenance` is always `observed` at finalize under the current gate (§8).
It is included anyway so the attestation stays correct if that gate ever
changes.

**Targets**, nested under their finding, sorted by
`(group_index, position, id)`:

`id`, `group_index`, `position`, `participation`, `role`, `target_kind`,
`tooth_number`, `arch`, `local_ordinal`, `geometry` (§11).

`finding_id` is omitted — the nesting already states it.

**Specifications**, sorted by `(sequence, id)`:

`id`, `finding_id`, `text`, `sequence`.

### 10.4 CanonicalSnapshotV1 — excluded fields

| Excluded | Reason |
|---|---|
| `content_hash`, `hash_algorithm`, `canonicalization_version` | self-reference; the version is stored beside the hash so a verifier reads it first to choose the algorithm |
| `record.version` | concurrency control. Including it would make the hash depend on how many times the clinician edited during draft — that is audit information, not content |
| `status` | constant (`finalized`) at hash time, so it carries zero information, and it is terminal |
| `created_at`, `updated_at` | ORM bookkeeping; the clinical timestamps are `recorded_at` / `finalized_at` |
| audit events | they describe the *process*, not the document |
| anything resolved through a live FK (patient name, clinic name, a user's current name/role) | those change without any clinical change and would break the hash. **This is precisely why authorship is a stored snapshot** |
| derived values (colour, `superseded`, `is_current`) | recomputable from catalog + data; storing them in the hash would freeze a derivation, not a fact |
| UI state, the user's Original/MINSA preference, any renderer data | not clinical content, and per-user |

### 10.5 Serialization contract, version 1

A **logical value tree** is built explicitly from the stored values — never
`str(model)`, `repr(model)`, ORM `__dict__` or a bare `model_dump_json()`,
because a library upgrade could silently change the bytes.

1. **Encoding** — UTF-8.
2. **Object keys** — sorted ascending by Unicode code point.
3. **Separators** — compact: `,` and `:` with no surrounding whitespace.
4. **Strings** — emitted literally as UTF-8. Non-ASCII is **never**
   `\u`-escaped. Only what JSON requires is escaped: `"`, `\`, and control
   characters below `U+0020` (as `\u00XX`, lowercase hex). Unicode is
   **not** normalised — the stored code points are preserved exactly, so
   NFC/NFD text round-trips unchanged.
5. **UUID** — canonical hyphenated lowercase string, 36 characters.
6. **Timestamps** — converted to UTC, then
   `YYYY-MM-DDTHH:MM:SS.ffffffZ`: always six fractional digits, always the
   `Z` suffix, never `+00:00`. Fixing the fraction removes the
   trailing-zero ambiguity of PostgreSQL `timestamptz`.
7. **Integers** — JSON numbers, no leading zeros, no `+`.
8. **Booleans** — `true` / `false`.
9. **Null** — explicit. Every field in the schema is **always present**,
   even when NULL. Omitting-versus-null is never a choice.
10. **Floats** — **forbidden in v1**, except inside future geometry (§11),
    whose numeric contract is defined when the geometry contract lands.
    This removes float-repr instability from v1 entirely.
11. **Arrays** — sorted by the declared key *before* serialization. The
    sort is part of this contract, not incidental query order; every sort
    key ends in `id`, so the order is total and unique.
12. **Digest** — `SHA-256` over those bytes, stored as **lowercase** hex.
    (Verifactu's `huella` is uppercase because AEAT requires it; there is
    no such external requirement here, and lowercase matches the UUID
    rule.)

`canonicalization_version = 1` is a **permanent contract**. Any change to
any rule above is version 2, and version 1 must remain implemented so
existing records stay verifiable.

**Known trade-off.** `canonicalization_version` is excluded from the hashed
payload and stored as a column beside it, so the version tag is
out-of-band: a verifier must read the column to pick the algorithm. Placing
it inside the payload would additionally make identical content hash
differently across versions. The out-of-band form is the decided contract;
the trade-off is recorded here so a v2 can revisit it deliberately.

### 10.6 Order of operations at finalize

`finalized_at` is inside the hash, so the sequence is fixed:

```
BEGIN
  1. compare-and-bump version (requires status='draft')
  2. run every catalog and finalize gate (§8, §2.2–2.4)
  3. resolve and store the authorship snapshot
  4. set finalized_at, finalized_by, status='finalized'
  5. build CanonicalSnapshotV1 from the post-step-4 in-transaction state
  6. store content_hash, hash_algorithm='sha256', canonicalization_version=1
  7. write the 'finalized' audit event with the post-bump record_version
COMMIT
```

---

## 11. Geometry — CONTRACT PENDING

NTS-04B may create `nts_finding_targets.geometry` as a nullable JSONB
column. It may **not** capture, edit, validate or render freehand shapes.

Six rules need clinician-defined shapes — 6.1.10, 6.1.16, 6.1.33, 6.1.34,
6.1.35, 6.1.36 — and the storage shape depends on a coordinate system that
does not exist yet. Tooth-local normalised coordinates are the working
preference, but they cannot be frozen as a contract while the anatomical
tooth figure the renderer draws is itself unversioned.

> **GEOMETRY CONTRACT PENDING.** Capturing geometry before its coordinate
> space is defined and versioned makes replay impossible, and that is the
> one irreversible mistake available in this design.

Two independent guards keep it shut. `ck_nts_target_geometry_pending`
(`geometry IS NULL`) refuses a shape **at write time**, so a draft can never
accumulate one that would later block finalizing it; and
CanonicalSnapshotV1 refuses a non-null value at hash time. Enabling geometry
means a migration dropping that CHECK *and* canonicalization version 2.

CanonicalSnapshotV1 reserves the slot: `geometry` appears in the target
object and serialises as `null` today. When the contract lands, it will
define the geometry sub-object's key set, its numeric formatting (the only
place floats are permitted) and its own `space_version` — and that will be
`canonicalization_version = 2`.

---

## 12. What a hash is not

| `content_hash` is **not** | `finalized` is **not** |
|---|---|
| a digital signature | a digitally signed document |
| non-repudiation | proof of professional authorship in the PKI sense |
| SIHCE accreditation | compliance with the electronic health record framework |

A hash proves the content did not change. It does not prove **who** issued
it — that requires a signature, and signature is a later workstream:
professional electronic/digital signature, the applicable PKI or provider,
SIHCE accreditation, external audit, and interoperability where relevant.

**No claim of legal compliance or accreditation is made by this design, by
NTS-04B, or by any code, changelog entry or UI text derived from them.**

The repo's Verifactu module contains real hashing and certificate
infrastructure (`verifactu_records.huella` / `huella_anterior`,
`verifactu_certificates`, `services/hash_chain.py`). It may be cited as an
**internal technical precedent** for the hashing pattern. It is
Spanish-tax-specific and must **not** be reused as clinical infrastructure.

---

## 13. Coexistence with the Original profile

Two independent stores. NTS records never read or write `ToothRecord`,
`Treatment`, `TreatmentTooth` or `OdontogramHistory`, and publish no
events — so budget, treatment_plan and agenda see nothing, which is correct
at this stage. Nothing is migrated from the Original profile; several
mappings are lossy in the direction that matters, and some Original types
are procedures the norm excludes from the chart entirely (see
[`nts-188-catalog.md`](./nts-188-catalog.md) §15).

`OdontogramProfileView` already selects the renderer by profile, so
`DiagnosisMode` mounts the NTS record editor for `pe_nts_188_2022` while
the Treatment → plan → budget pipeline keeps running untouched.

**The profile preference is per user; a record's norm is a property of the
record.** A user toggling their preference must never change which records
exist or how they are interpreted: `record.norm_version` is authoritative,
and the preference only chooses the editor.

The finding → service bridge is a later ticket and must be an explicit
clinician action, never an automatic derivation.

---

## 14. Open items

| # | Item | Blocks NTS-04B? |
|---|---|---|
| 1 | Tooth-figure coordinate contract + `space_version` (§11) | only geometry capture |
| 2 | Professional signature strategy under the HCE framework (§12) | no — but blocks any compliance claim |
| 3 | Retention/purge policy for discarded records (§3.4) | no |
| 4 | Dedicated NTS permissions for finalize/supersede | no |
| 5 | SIHCE accreditation, external audit, interoperability | no |
