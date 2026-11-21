# 0021 — NTS odontogram records persist as five tables, hybrid relational + JSONB

- **Status:** accepted
- **Date:** 2026-09-16
- **Deciders:** Backend team
- **Tags:** modules, odontogram, data-model, compliance

## Context

ADR 0013 settled how periodontal exams persist: immutable dated snapshots
rather than an event stream. The MINSA odontogram profile
(`pe_nts_188_2022`, NTS N.° 188-MINSA/DGIESP-2022) needs its own clinical
store, and it cannot reuse the Original profile's.

The normative catalog landed first (NTS-03,
`backend/app/modules/odontogram/nts/catalog/`) and closed the constraints
this model has to satisfy:

- 38 rules, of which **15 are not tooth-scoped** — 6 `surface`, 3 `pair`,
  3 `range`, 3 `arch`. Any model keyed by a single tooth number, as both
  `ToothRecord` and the `preview.html` prototype are, cannot represent them.
- Rule 6.1.31 covers **non-contiguous segments** with one finding.
- Rule 6.1.26's clinical subject is a **supernumerary tooth with no FDI
  number**; the two adjacent teeth are spatial anchors that assert nothing.
- Six rules require **clinician-defined shapes**.
- Normative identity is `norm_version + rule_id`, **never the sigla** — the
  norm reuses `S` (6.1.26 / 6.1.35) and `M` (6.1.19 / 6.1.28).
- The catalog is immutable and versioned; a historical record is never
  reinterpreted by a later catalog.

The Original profile's tables cannot carry this. `ToothRecord` is keyed
`UNIQUE (patient_id, tooth_number)` and holds *current* state, not dated
snapshots. `Treatment` models a clinical act with pricing, catalog links
and a budget bridge — but NTS §5.8 records **observed findings only**, and
a finding is not a procedure.

## Decision

Persist NTS records in **five module-owned tables**, relational where
integrity is buyable and JSONB where the shape is versioned by the catalog
or opaque:

```
nts_odontogram_records ─┬─ N nts_findings ──── N nts_finding_targets
                        ├─ N nts_record_specifications
                        └─ N nts_record_audit_events   (append-only)
```

- **`nts_finding_targets` is normalised**, with `participation ∈
  {subject, anchor}`, `target_kind ∈ {fdi_tooth, unnumbered_tooth, arch}`,
  and `group_index` / `position` for multi-segment findings.
- **`nts_findings.attributes` is JSONB**, validated against the catalog by
  `norm_version + rule_id`. `rule_id` stays a real column.
- **Specifications are a child table** with a nullable `finding_id`.
- **The audit trail is a dedicated table** (see ADR 0022).
- **No FDI sentinel values.** `unnumbered_tooth` has `tooth_number = NULL`.
- **Nothing touches the Original profile.**

Full field-by-field reference:
[`docs/technical/odontogram/nts-record-model.md`](../technical/odontogram/nts-record-model.md).

### Why targets are normalised

They are the one part of the model where the database can prevent a wrong
*clinical claim*, not merely a wrong shape. With `participation` as a
column, `"findings on tooth 11"` is
`WHERE tooth_number = 11 AND participation = 'subject'`, so 6.1.26's
anchors can never be reported as a supernumerary finding on tooth 11. In
JSONB that guarantee degrades to convention. Postgres also enforces FDI
validity, per-kind column coherence, and `UNIQUE (finding_id, group_index,
position)`.

### Why attributes are JSONB

Generic columns (`crown_type`, `caries_type`, `absence_type`, …) were the
obvious alternative and are rejected because a CHECK expressing
"`crown_type` is required iff `rule_id = '6.1.3'`" must enumerate 38 rules
in SQL — **a second hand-maintained copy of the norm, in DDL**. NTS-03 made
the catalog the single source precisely to prevent that. A column set is
also global while norms are versioned, so every future norm would mean a
migration.

The decision is made for **versioning and single-source**, not convenience.

### Why no `TargetGroup` table

Across all 38 rules a group never carries its own metadata: roles hang off
teeth (`role='pilar'` for 6.1.29), not off the span. `group_index` on the
target covers 6.1.31's disjoint segments. **Revisable** — a future norm
attaching data to a segment forces the third table.

### Why specifications are a table

NTS §5.14 routes content about a *specific* finding to *Especificaciones*
(6.1.3 crown metal colour, 6.1.4 temporary crown material, 6.1.5 fluorosis
classification). Plain text loses which finding each line extends and makes
contextual prompting impossible. Storing it as a finding attribute would
print it inside the tooth's box, which the norm forbids. *Especificaciones*
and *Observaciones* are different normative concepts and are never
concatenated.

### Why not a free `notes` column on findings

The norm has exactly two prose channels. A third would break the normative
format.

### Why colour is not persisted

It is a pure function of the rule's `color_semantics` and the
`condition_state` attribute. Persisting it would duplicate the catalog and
allow a record to drift from the norm.

## Consequences

### Good

- Non-tooth-scoped findings (15 of 38) round-trip without distortion.
- The dangerous query — "tooth 11 has a supernumerary finding" — is
  structurally unreachable, not merely discouraged.
- A new norm version needs a catalog file, not a migration.
- The Original profile, `Treatment`, budget, treatment_plan and agenda are
  untouched; the two profiles coexist per patient.
- Historical records stay self-describing: attribute keys, values and
  surface codes are literals sourced from a frozen catalog.

### Bad / accepted trade-offs

- Five tables and more joins than an embedded-JSONB design.
- The database cannot validate normative meaning; that lives entirely in
  the service plus catalog, and a write bypassing the service bypasses it.
- Querying inside `attributes` needs JSONB containment and a GIN index.
- `norm_version` is physically duplicated on findings — mitigated by a
  composite FK `(record_id, norm_version)` → `(id, norm_version)`, which
  makes divergence structurally impossible rather than merely unlikely.
- No migration path from the Original profile: several mappings are lossy
  toward NTS, and three Original types are procedures the norm excludes
  from the chart.

## Alternatives considered

- **Two tables, targets embedded as JSONB** — compact and join-free, but
  the database could enforce nothing about targets: not FDI validity, not
  anchor cardinality, not uniqueness, not the `participation` vocabulary.
  The protection against misreporting anchors as affected teeth would
  become convention only.
- **Generic attribute columns** — good for ad-hoc queries, but duplicates
  normative semantics in DDL and forces a migration per norm version.
- **Reuse `ToothRecord` / `Treatment`** — `ToothRecord` is current state
  keyed by one tooth and cannot hold dated snapshots or non-tooth scopes;
  `Treatment` models procedures with pricing and a budget bridge, and NTS
  §5.8 excludes procedures from the chart.
- **Event-sourced history like `odontogram_history`** — a record is one
  dated clinical act, as ADR 0013 already argued for periodontal exams;
  there is no clinical meaning to "the odontogram between two records".
- **A third `TargetGroup` table** — no group metadata exists in the 38
  rules, so it would add a join for nothing.

## How to verify the rule still holds

- No NTS module file imports `Treatment`, `TreatmentTooth`, `ToothRecord`
  or `OdontogramHistory`:
  `grep -rn "ToothRecord\|TreatmentTooth" backend/app/modules/odontogram/nts*`
- No NTS table publishes `odontogram.treatment.*`:
  `grep -rn "event_bus.publish" backend/app/modules/odontogram/nts*`
- No normative vocabulary is duplicated in DDL or models — the siglas and
  attribute code lists appear only in
  `backend/app/modules/odontogram/nts/catalog/pe_nts_188_2022.json`
  (the check already enforced by `backend/tests/test_nts_catalog.py`).
- No FDI sentinel: `tooth_number` is NULL for every target whose
  `target_kind <> 'fdi_tooth'` (planned CHECK).

## References

- `docs/technical/odontogram/nts-record-model.md`
- `docs/technical/odontogram/nts-188-catalog.md`
- `backend/app/modules/odontogram/nts/catalog/`
- `backend/app/modules/odontogram/models.py` — Original profile, untouched
- ADR 0013 — periodontogram snapshot model (the shape precedent)
- ADR 0022 — NTS lifecycle, auditability and concurrency
- NTS N.° 188-MINSA/DGIESP-2022
