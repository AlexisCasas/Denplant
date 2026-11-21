# 0022 — NTS records: draft/discarded/finalized, append-only audit, optimistic locking

- **Status:** accepted
- **Date:** 2026-09-16
- **Deciders:** Backend team
- **Tags:** modules, odontogram, compliance, auditability, concurrency

> This ADR is written to be readable on its own, without reading code. It
> is the document a legal or clinical reviewer should be given.

## Context

The MINSA odontogram profile records clinical findings under **NTS N.°
188-MINSA/DGIESP-2022**. Its §5.6 states that a *registered* clinical
finding is unalterable — no amendments, no crossing out — but the norm was
written for paper. It defines no draft state, no moment of digital
registration, no electronic signature, and no procedure for correcting a
material error.

The applicable framework reviewed for this decision is broader than NTS
188 and includes NTS N.° 139-MINSA/2018/DGAIN, RM 214-2018-MINSA,
DA N.° 343-MINSA/OGTI-2023, DA N.° 373-MINSA/OGTI-2025 and
RM 188-2026-MINSA. For electronic health records, that framework addresses
— among other things — auditability, traceability, inviolability and
integrity, authentication, registration by the professional, and signature
applicable to electronic records.

An earlier draft of this design asserted that *"a draft does not constitute
a clinical record"*. **That assertion is withdrawn.** It is a legal
qualification, not an engineering one, and the design should not depend on
winning it.

A second problem is practical. One shared draft per patient means two
clinicians can edit the same document at once, and the repository has **no
existing optimistic-locking pattern** anywhere to follow.

## Decision

### 1. Three states, two transitions

```
draft ──▶ discarded      (terminal)
draft ──▶ finalized      (terminal)
```

`finalized → draft`, `discarded → draft` and `finalized → discarded` are
forbidden without exception.

### 2. What `draft` means

> `draft` is DenPlant's editable working state.

**DenPlant makes no claim, in either direction, about whether a draft
constitutes a clinical record under the applicable framework.** That
qualification belongs to the framework and to legal review.

Independently of how it is answered: **every clinical datum persisted
during draft carries full traceability from its first write** — who, when,
which entity, which action, which record version, and what changed.

The design therefore does not depend on the answer.

### 3. No hard delete

An NTS record is **never physically deleted**. An abandoned draft becomes
`discarded` and keeps `discarded_at`, `discarded_by` and a required
`discard_reason`, remaining queryable and auditable.

Retention and purge policy is **out of scope** here and subject to a
legal/operational decision.

### 4. Correction is supersession, never mutation

A finalized record is never edited. A correction is a **new record**
carrying `supersedes_record_id` and a required `supersession_reason`. The
predecessor keeps `status = 'finalized'`, is not touched, and remains fully
accessible.

`superseded` is a **derived** state read through the inverse relation,
never a stored status value. A partial unique index keeps the chain linear,
so "which record is current?" always has one answer:

```sql
UNIQUE (supersedes_record_id)
  WHERE status = 'finalized' AND supersedes_record_id IS NOT NULL
```

The current record is the most recent finalized one that no finalized
record supersedes. **A draft never replaces it.**

### 5. Append-only audit trail

A dedicated `nts_record_audit_events` table records every persisted
change, from the first write in draft, with `previous_state` and
`new_state`. No UPDATE, no DELETE — enforced by service discipline and a
database trigger. Its foreign key to the record is `ON DELETE RESTRICT`,
not `CASCADE`.

Actions: `record_created`, `record_metadata_updated`, `finding_created`,
`finding_updated`, `finding_removed`, `target_changed`,
`specification_changed`, `carried_forward`, `carried_forward_confirmed`,
`discarded`, `finalized`, `supersession_recorded`.

`supersession_recorded` is written **against the new record** when it is
finalized. The superseded record receives no event and no mutation.

### 6. Optimistic locking, never last-write-wins

The record carries `version INTEGER >= 1`. Every mutating operation sends
`expected_version` and begins with one statement:

```sql
UPDATE nts_odontogram_records
   SET version = version + 1, updated_at = now()
 WHERE id = :record_id AND version = :expected_version AND status = 'draft'
RETURNING version;
```

Zero rows → **409 Conflict**. The bump precedes every mutation of the
record, a finding, a target, a specification, a carry-forward
confirmation, a finalize or a discard, and everything runs in one
transaction: *compare-and-bump → mutation → audit event → commit*.

One draft per `(clinic_id, patient_id, norm_version)`, enforced by a
partial unique index. No draft per professional, no draft per stage.

### 7. Carry-forward requires individual review

A new draft may be seeded from the last finalized record. Each copied
finding arrives as `provenance = carried_forward` with
`source_finding_id`, and must be confirmed or removed one by one.
**Finalize is blocked while any remains, and there is no "confirm all"
action** — a single button would make the software assert observations the
clinician never made on that date.

A record with **zero findings is valid**: the norm records findings, not
health.

### 8. Integrity: `content_hash`

On finalize the record stores `content_hash` (SHA-256, lowercase hex),
`hash_algorithm` (`"sha256"`) and `canonicalization_version` (`1`), all
NULL in `draft` and `discarded`. The hashed input is
**CanonicalSnapshotV1**, a byte-exact serialization contract specified in
[`nts-record-model.md`](../technical/odontogram/nts-record-model.md) §10,
so the same clinical record always yields the same digest regardless of
query order, dictionary ordering, local timezone, ORM or frontend version.

No `previous_hash` and no chain between records in this phase.

### 9. Authorship

`recorded_by`, `finalized_by`, `discarded_by` and `changed_by` are live
foreign keys to users. In addition, the professional's **name, role and
`professional_id`** are snapshotted onto the record at finalize, so the
document renders identically years later even after the user is renamed,
changes role, or leaves.

This is **product traceability**. It is not asserted to be equivalent to a
digital signature.

### 10. What `finalized` does not mean

| `finalized` **is** | `finalized` is **not** |
|---|---|
| a clinical snapshot locked by DenPlant | a digitally signed document |
| immune to further clinical mutation | non-repudiation in the PKI sense |
| the unit produced under NTS §5.10–5.11 | compliance with the framework's signature requirement |
| the candidate for "current record" | SIHCE accreditation |

`content_hash` proves the content did not change. It does not prove **who**
issued it.

**No claim of legal compliance or accreditation is made by this decision,
by its implementation, or by any changelog entry or UI text derived from
them.** Professional electronic/digital signature, the applicable PKI or
provider, SIHCE requirements, accreditation, audit and interoperability are
a separate, later workstream that must be resolved before the module is
presented as a formal electronic health record component.

## Consequences

### Good

- The design holds whichever way the "is a draft a clinical record?"
  question is answered, because traceability starts at the first persisted
  write either way.
- Nothing clinical is ever destroyed or rewritten: corrections add, they do
  not replace.
- Concurrent edits fail loudly with 409 instead of silently overwriting.
- A finalized record's integrity is independently verifiable by anyone who
  can re-run CanonicalSnapshotV1.
- The legal reviewer can read this ADR alone.

### Bad / accepted trade-offs

- Discarded drafts accumulate until a retention policy exists.
- Every client must carry and send `expected_version`; forgetting it is a
  409 rather than a silent success.
- Audit completeness depends on every write going through the service
  layer; a bypass leaves a silent gap. The append-only trigger limits the
  damage but cannot close it.
- The hash proves integrity only, and only from the moment a record is
  finalized.
- Carry-forward still relies on clinician diligence; the model removes the
  bulk shortcut but cannot force attention.
- Introducing optimistic locking establishes a pattern the repo did not
  previously have, which future modules will be expected to follow.

## Alternatives considered

- **No draft state; every write immediately immutable** — closest to a
  literal reading of §5.6, but a typo would be uncorrectable without a
  void mechanism, and clinicians would prepare on paper first, defeating
  the purpose.
- **Keeping the earlier claim that a draft is not a clinical record** —
  rejected: it is a legal conclusion the engineering team cannot issue, and
  it was the sole justification for hard-deleting drafts.
- **A `voided` status as the correction mechanism** — rejected: it
  conflated abandoning a working draft with annulling a formal record.
  Split into `discarded` (drafts) and supersession (finalized).
- **Conditional hard delete for a draft that never held clinical data** —
  proving *never* requires trusting the audit trail, adding a second
  destructive path guarded by an invariant whose violation destroys data
  silently, to save rows that cost nothing.
- **SQLAlchemy `version_id_col`** — bumps only on UPDATE of the versioned
  row, so inserting a finding would not bump the record: precisely the case
  that must be covered.
- **Pessimistic locking / draft ownership per professional** — produces two
  conflicting "current" pictures with no merge semantics, and blocks a
  second clinician outright.
- **Reusing `patient_timeline` as the audit trail** — it is an event-bus
  display feed, NTS publishes no events by design, it stores no
  previous/new state, and it is a candidate for `removable=True`; an audit
  trail that can be uninstalled is not one.
- **Reusing the Verifactu hash chain** — cited as a valid internal
  technical precedent for hashing and certificate handling, but it is
  Spanish-tax-specific and is not clinical infrastructure.

## How to verify the rule still holds

- Every mutating NTS service method performs the compare-and-bump before
  any write and raises 409 on zero rows.
- No code path deletes an `nts_odontogram_records` row; `discarded` is the
  only abandonment route.
- No UPDATE or DELETE statement targets `nts_record_audit_events`; the
  trigger rejects both.
- `content_hash`, `hash_algorithm` and `canonicalization_version` are NULL
  in `draft`/`discarded` and NOT NULL in `finalized` (CHECK).
- No changelog, documentation or UI string claims signature, compliance or
  accreditation: `grep -rni "firmado digitalmente\|SIHCE\|acreditad"` over
  NTS files returns only disclaimers.

## References

- `docs/technical/odontogram/nts-record-model.md` — the full contract,
  including CanonicalSnapshotV1
- ADR 0021 — NTS record persistence model
- ADR 0013 — periodontogram snapshot model (draft → closed precedent)
- `backend/app/modules/periodontogram/service.py` — the 409 immutability
  precedent
- `backend/app/modules/budget/models.py` — `BudgetHistory`, the repo's
  audit-table pattern
- `backend/app/modules/verifactu/services/hash_chain.py` — internal
  hashing precedent, not clinical infrastructure
- NTS N.° 188-MINSA/DGIESP-2022; NTS N.° 139-MINSA/2018/DGAIN;
  RM 214-2018-MINSA; DA N.° 343-MINSA/OGTI-2023;
  DA N.° 373-MINSA/OGTI-2025; RM 188-2026-MINSA
