# NTS N.° 188 normative catalog

Reference for the versioned catalog that describes the Peruvian odontogram
norm **NTS N.° 188-MINSA/DGIESP-2022**. Written for engineers working on the
odontogram module — in particular whoever implements NTS-04 (findings,
persistence and rendering) on top of it.

Source of truth for the readings recorded here: the norm PDF itself
(`DGIESP-2022.pdf`, 24 pages). `preview.html` was used only as a secondary
cross-check and is *not* authoritative; §14 records where it diverges.

---

## 1. Purpose

A catalog answers one question: **what does the norm require?** It is a
versioned, validated, read-only description of 38 clinical findings — their
clinical reach, the structured data each carries, how each is drawn, where
the drawing geometry comes from, and which page of the norm says so.

It is data, not behaviour. Nothing in `nts/catalog/` touches the database,
reads a patient, or draws a pixel.

## 2. What this is explicitly *not* (NTS-03 scope boundary)

Out of scope, by ticket:

| Not included | Where it belongs |
|---|---|
| A persisted `NtsFinding` model or any table | NTS-04 |
| Migrations | NTS-04 |
| REST endpoints | NTS-04 |
| A renderer or any SVG | NTS-04 |
| Snapshots / odontogram history for the NTS profile | NTS-04 |
| Clinical services or validation of real findings | NTS-04 |
| The digital-immutability workflow (§13) | NTS-04, once decided |

The catalog is deliberately usable by all of these without being coupled to
any of them.

## 3. Layout

```
backend/app/modules/odontogram/nts/
├── __init__.py
└── catalog/
    ├── __init__.py              # public surface
    ├── schema.py                # typed model of a catalog (Pydantic v2)
    ├── validator.py             # the 13 invariants (§16)
    ├── loader.py                # get_nts_catalog / get_nts_rule, cached
    └── pe_nts_188_2022.json     # the data
```

Tests: `backend/tests/test_nts_catalog.py` (25 cases, no database).

A catalog file is named after its `norm_version` and the loader refuses any
version string outside `^[a-z0-9_]+$`, so a version can never resolve to a
path outside the package.

```python
from app.modules.odontogram.nts.catalog import get_nts_catalog, get_nts_rule

catalog = get_nts_catalog("pe_nts_188_2022")   # validated, cached, frozen
rule = get_nts_rule("6.1.16", "pe_nts_188_2022")
```

Validation runs at load time. A catalog that violates its own invariants
never reaches a caller.

### 3.1 Caching and deep immutability

`get_nts_catalog` is wrapped in `functools.cache`, so the **same object** is
handed to every caller for the life of the process. There is no mutable
module-level copy: the cache is the decorator's own, keyed by version string,
and `get_nts_rule` is a lookup over the cached catalog — it returns a rule
from it, never a handle that can write back into it.

That sharing makes deep immutability a correctness requirement, not a nicety.
`frozen=True` only blocks *attribute assignment*; a mutable container held in
a field stays writable. So:

- every collection is a `tuple` — `rules`, `global_rules`,
  `pending_decisions`, `attributes`, `values`, `related_rules`,
  `geometry_input.constraints`, `render.marks`;
- the single mapping, `RenderMark.params`, is a `FrozenStrMap`
  (`MappingProxyType` behind an `AfterValidator`), with an explicit
  `PlainSerializer` so `model_dump()` / `model_dump_json()` still emit a plain
  dict.

This was verified by probe, not assumed. Before the `FrozenStrMap` change,
`mark.params["shape"] = ...` and `mark.params.clear()` both succeeded and
poisoned the cache for every subsequent `get_nts_catalog()` call in the
process. Every other container was already immutable. Regression tests for
all of it live in §7 of `tests/test_nts_catalog.py`.

## 4. Identity

A rule is identified by **`norm_version` + `rule_id`** (`pe_nts_188_2022` +
`6.1.26`). Never by its sigla.

This matters because the norm reuses siglas across unrelated rules:

| Sigla | Rules | Meaning |
|---|---|---|
| `S` | 6.1.26 / 6.1.35 | supernumerary tooth / sealant |
| `M` | 6.1.19 / 6.1.28 | pathological mobility / mesialised |

Sigla uniqueness is therefore scoped to `norm_version + rule_id +
variant_code`. The validator does **not** treat cross-rule reuse as an
error — that is the norm's own design, and a validator that rejected it
would be wrong about the norm.

## 5. Anatomy of a rule

| Field | Meaning |
|---|---|
| `rule_id`, `ordinal`, `official_name` | identity and presentation order |
| `scope` | clinical reach (§6) |
| `target_identity`, `anchor` | whether the subject has an FDI cell (§6.3) |
| `arch_cardinality`, `range_grouping` | scope modifiers (§6.2) |
| `attributes` | the structured data the finding carries (§7) |
| `render` | colour semantics + marks (§8, §9) |
| `geometry_input` | where concrete geometry comes from (§10) |
| `related_rules` | normative links to other rules (§11) |
| `status` | `verified` or `needs_clinical_review` (§12) |
| `source` | page + section, plus errata label (§11) |
| `notes` | why a modelling decision was made |

Every model is `extra="forbid", frozen=True`: an unknown key in the JSON is
an error, and a loaded catalog cannot be mutated by a caller.

## 6. Scopes

### 6.1 Distribution

| Scope | Count | Rules |
|---|---|---|
| `tooth` | 23 | 6.1.3, .4, .8, .9, .10, .12, .13, .14, .15, .17, .18, .19, .20, .21, .22, .23, .24, .25, .26, .27, .28, .32, .37 |
| `surface` | 6 | 6.1.5, .16, .33, .34, .35, .36 |
| `pair` | 3 | 6.1.6, .11, .38 |
| `range` | 3 | 6.1.1, .29, .31 |
| `arch` | 3 | 6.1.2, .7, .30 |
| `mouth` | 0 | — (the platform supports it; this norm uses none) |

**This is the single most consequential finding of the audit.** 15 of 38
rules are *not* tooth-scoped. Any model that keys a finding by one tooth
number — as both the legacy odontogram and `preview.html` do — cannot
represent them without distortion (§14, §15).

### 6.2 Scope modifiers

`arch_cardinality` is set exactly for arch-scoped rules, `range_grouping`
exactly for range-scoped rules; the validator enforces both directions.

| Rule | Modifier | Why |
|---|---|---|
| 6.1.7 Edéntulo total | `one_or_both` | upper and/or lower |
| 6.1.30 Prótesis completa | `one_or_both` | "ya sea el maxilar superior y/o el inferior" |
| 6.1.2 Aparato removible | `one` | one appliance, one arch |
| 6.1.1 Aparato fijo | `single_segment` | two endpoints joined by one line |
| 6.1.29 Prótesis parcial fija | `single_segment` | one bridge = one continuous span |
| 6.1.31 Prótesis parcial removible | `multi_segment` | the norm's figure draws two disjoint stretches for **one** appliance |

Two bridges are two occurrences of 6.1.29 — not one occurrence with two
segments. 6.1.31 is the opposite case, and the only one.

### 6.3 Targets that have no FDI number

6.1.26 (supernumerary tooth) is the sole rule whose clinical subject has no
cell in the chart. It is modelled as:

```json
"scope": "tooth",
"target_identity": "unnumbered",
"anchor": { "kind": "interproximal", "cardinality": 2,
            "role": "spatial_reference_only" }
```

The two adjacent teeth are **anchors, not targets**: they position the mark
between the apices and carry no finding of their own. Collapsing this into
"a finding on tooth 21" would record a clinical claim about 21 that the
norm does not make.

## 7. Attributes and siglas

`AttributeKind` is closed: `enum`, `enum_multi`, `fixed`, `integer`,
`free_text`. `enum`/`enum_multi`/`fixed` must enumerate values;
`integer`/`free_text` must not; `fixed` takes exactly one.

At most one attribute per rule carries `is_sigla: true` — the chart's box
holds one sigla.

The closed vocabularies, as the norm words them:

| Rule | Attribute | Codes |
|---|---|---|
| 6.1.3 | `crown_type` | CM, CF, CMC, CV, CLM |
| 6.1.5 | `dde_type` | O, PE, FLUOROSIS* |
| 6.1.16 | `caries_type` | MB, CE, CD, CDP |
| 6.1.20 | `absence_type` | DNE, DEX, DAO |
| 6.1.28 | `abnormal_position` | M, D, V, P, L |
| 6.1.33 | `restoration_material` | AM, R, IV, IM, IE, C |
| 6.1.37 | `endodontic_treatment_type` | TC, PC |

Naming decisions worth keeping straight:

- **`crown_type`, not `crown_material`.** The norm says "tipo de corona".
  Metal colour goes to *Especificaciones*, so it is deliberately not an
  attribute.
- **`caries_type`, not `caries_grade`.** MB is a lesion type; CE/CD/CDP are
  depths. The set is not an ordinal scale.
- **`restoration_material`** keeps the norm's own wording even though
  IM/IE/C are restoration types rather than materials. Renaming it would be
  our reading, not the norm's.
- **`absence_type`** encodes aetiology (caries vs other). It cannot be
  inferred from "tooth is missing".
- **6.1.24/6.1.25 have no direction attribute.** Extrusion and intrusion
  arrows follow from the rule plus the FDI quadrant. Direction is
  renderer-derived; asking the clinician for it would invent an input.

## 8. Colour

NTS §5.12–5.13 permits exactly two colours. `ColorSemantics` encodes the
meaning, never a hex value — the UI maps it to its own tokens.

| Value | Meaning |
|---|---|
| `good_or_non_pathological` | always blue |
| `bad_temporary_or_pathological` | always red |
| `condition_dependent` | blue if good, red if bad |

Every `condition_dependent` rule carries a `condition_state` attribute with
codes `good`/`bad`, and no other rule may carry one. The validator enforces
both directions: a rule whose colour is fixed must not pretend to offer a
state the norm does not let the clinician choose.

## 9. Render vocabulary

Seven mark kinds cover all 38 rules. The set is closed — a new rule that
seems to need an eighth is a signal to re-read the norm, not to extend the
enum silently.

| Kind | Used for |
|---|---|
| `box_siglas` | letters written in the tooth's box |
| `symbol` | a discrete shape (square, circle, triangle, X, parenthesis) |
| `arrow` | eruption, giroversión, extrusion/intrusion, transposition |
| `line` | continuous or zigzag strokes (prostheses, endodontics, fracture) |
| `connector` | joins the endpoints of a span |
| `shape_fill` | a filled region (caries, restorations, pulpotomy, wear) |
| `outline` | contour without fill (temporary restoration) |

`params` are descriptive tokens (`{"shape": "x_cross"}`), never coordinates.
The catalog ships **no SVG, no path data, no hex colours** — a test asserts
this against the raw JSON.

## 10. Geometry

`geometry_input` is `{mode, constraints}`.

| Mode | Meaning |
|---|---|
| `none` | nothing drawn on the figure; siglas in the box only |
| `standard_geometry` | placement fully derived from rule + target |
| `surface_regions` | geometry *is* the set of affected surfaces |
| `clinician_defined_shape` | the clinician draws what they observe |

`constraints` (`surface_regions`, `fissure_anatomy`, `crown_area`,
`root_area`, `apex_level`, `interproximal`) bound the mode; mode `none`
cannot carry any.

**Six rules require clinician-defined shapes**: 6.1.10 (fracture), 6.1.16
(caries), 6.1.33 (definitive restoration), 6.1.34 (temporary restoration),
6.1.35 (sealant), 6.1.36 (wear). The norm says the mark is drawn "según la
forma que se observa" — the shape is clinical data, not decoration. NTS-04
needs a per-finding geometry channel for these; the catalog only records
that the requirement exists.

## 11. Traceability and errata

Every rule cites `source.page` and `source.section`. Two headings are
misprinted in the PDF and are recorded rather than normalised away:

| Logical id | Printed as | Field |
|---|---|---|
| 6.1.15 (Implante dental) | `6.115` | `source.document_label` |
| 6.1.23 (Pieza en erupción) | `5.2.23` | `source.document_label` |

`related_rules` carries normative links between rules. There is exactly one
in this norm: 6.1.35 → 6.1.16 with relation `companion_when_present` ("if a
carious lesion is identified, add 6.1.16's siglas as well"). It is
structural — a stated dependency, not a clinical equivalence.

## 12. Open clinical questions

Three items are flagged `needs_clinical_review` because the norm genuinely
does not close them. They were **not** filled in from general dental
knowledge; the ticket forbade it and the flag is the deliverable.

| Rule | What is open |
|---|---|
| 6.1.5 `dde_type` = `FLUOROSIS` | routed to *Especificaciones* "with the classification used"; no code vocabulary is given |
| 6.1.13 `rotation_sense` | the arrow follows "el sentido de la giroversión" but no values are enumerated |
| 6.1.19 `mobility_degree` | an arabic numeral after the M; neither the scale nor its bounds are defined |

The validator requires each flagged item to carry `notes` saying what is
open, and propagates the flag upward — an open attribute cannot sit inside
a rule marked `verified`.

## 13. Global rules, and immutability

Eight chart-wide conventions are modelled separately from the 38 findings,
because they are not findings and forcing them into the rule list would
distort both:

`fdi_two_digit`, `finding_not_procedure`,
`registered_finding_is_unalterable`, `new_odontogram_on_new_findings_or_reentry`,
`red_blue_only`, `especificaciones_item`, `observaciones_item`,
`chart_printed_black`.

Two deserve attention:

- **`finding_not_procedure` (§5.8).** The odontogram records observed
  findings only; planned procedures belong to the treatment plan. This is
  the same boundary the product already draws: *hallazgo clínico → relación
  opcional con servicio(s) → plan → presupuesto*. A finding is not a
  service.
- **`registered_finding_is_unalterable` (§5.6).** The norm forbids amending
  or crossing out a registered finding, but it was written for paper. It
  defines no draft/finalized transition, no electronic signature, and no
  procedure for correcting a material error. **NTS-03 documents this; it
  does not implement it.** Designing a digital immutability workflow
  against an undefined "moment of registration" would be inventing
  compliance, so it is an explicit NTS-04 gate. *(Resolved in design by
  [ADR 0022](../../adr/0022-nts-lifecycle-auditability-concurrency.md) as a
  product decision — draft/discarded/finalized with traceability from the
  first persisted write — explicitly not as a reading of the norm.)*

## 14. Matrix A — `preview.html` coverage

`preview.html` is a prototype, not a source of truth. Its `rules` object
holds **34** of the 38 findings.

**Missing (4):**

| Rule | Scope | Why it is missing |
|---|---|---|
| 6.1.8 Espigo-muñón | tooth | simply absent |
| 6.1.29 Prótesis parcial fija | range | prototype has no span model |
| 6.1.30 Prótesis completa | arch | prototype has no arch model |
| 6.1.31 Prótesis parcial removible | range (multi-segment) | same |

Three of the four missing rules are exactly the non-tooth-scoped prosthetic
rules — the gap is structural, not an oversight.

**Antipatterns not to carry over:**

| Antipattern | Where | Problem |
|---|---|---|
| `appState.sections = {diagnostico, evolucion, alta}` | hardcoded 3 slots | the norm's trigger for a new odontogram (§5.10–5.11) is event-based, not a fixed set of three |
| `state.dentition` exclusive permanent/deciduous | single toggle | mixed dentition cannot be represented |
| `const serviceCatalog = [...]` (line ~1000) | inline | re-couples finding to service, against the domain rule in §13 |
| `f.tooth === state.selectedTooth` | every findings query | **collapses all pair/range/arch findings onto one tooth**; 15 of 38 rules cannot round-trip |

## 15. Matrix B — legacy odontogram vs NTS

Mapping the module's current `TreatmentType` / `ToothCondition` vocabulary
against the norm. **No clinical equivalence is asserted** — "≈" means the
concepts overlap, not that one can be auto-migrated into the other.

| Legacy value | Nearest NTS rule | Relationship |
|---|---|---|
| `caries` | 6.1.16 `caries_type` CD/CDP | ≈ NTS distinguishes depth; legacy does not |
| `incipient_caries` | 6.1.16 `caries_type` MB/CE | ≈ splits into two NTS codes |
| `pigmentation` | 6.1.5 `dde_type` PE | ≈ NTS scopes it to enamel defects |
| `fracture` | 6.1.10 | ≈ NTS requires a drawn shape |
| `missing` | 6.1.20 `absence_type` | **lossy** — NTS requires aetiology (DNE/DEX/DAO), absent from legacy |
| `rotated` | 6.1.13 | ≈ NTS also wants rotation sense (open, §12) |
| `displaced` | 6.1.28 `abnormal_position` | **lossy** — NTS requires M/D/V/P/L |
| `unerupted` | 6.1.23 / 6.1.14 / 6.1.20 DNE | **ambiguous** — three distinct NTS rules |
| `filling_composite` | 6.1.33 `R` | ≈ |
| `filling_amalgam` | 6.1.33 `AM` | ≈ |
| `filling_temporary` | 6.1.34 | ≈ |
| `sealant` | 6.1.35 | ≈ plus companion link to 6.1.16 |
| `veneer` | 6.1.33 `C` | ≈ |
| `inlay` / `overlay` | 6.1.33 `IM`/`IE` | ≈ NTS splits on aesthetic vs metallic, not inlay vs overlay |
| `crown` | 6.1.3 `crown_type` | **lossy** — NTS requires CM/CF/CMC/CV/CLM |
| `crown_on_implant`, `provisional_crown_on_implant` | 6.1.3 + 6.1.15 / 6.1.4 | two NTS findings, one legacy type |
| `bridge` | 6.1.29 | **scope change** — multi_tooth → `range` |
| `splint` | *(no NTS rule)* | → *Observaciones* |
| `extraction` | *(procedure)* | **not a finding** — §5.8 excludes it |
| `implant` | 6.1.15 | ≈ recorded only if clinically observed |
| `apicoectomy` | *(no NTS rule)* | → *Observaciones* |
| `root_canal_full` | 6.1.37 `TC` | ≈ |
| `root_canal_two_thirds`, `root_canal_half`, `root_canal_overfill` | 6.1.37 `TC` | **collapses** — NTS records no obturation extent |
| `post` | 6.1.8 | ≈ |
| `pulpitis` | *(no NTS rule)* | → *Observaciones* (a diagnosis, not a chart finding) |
| `periapical_small/medium/large` | *(no NTS rule)* | → *Observaciones* |
| `bracket`, `tube`, `band`, `attachment` | 6.1.1 | **scope change** — per-tooth → `range` |
| `retainer` | 6.1.2 | **scope change** — per-tooth → `arch` |
| `ToothCondition.healthy` | *(no NTS rule)* | NTS records findings, not health |
| `ToothCondition.extraction_indicated` | *(procedure)* | **not a finding** — §5.8 |

**NTS rules with no legacy counterpart at all (19 of 38):** 6.1.6 diastema,
6.1.7 edéntulo total, 6.1.9 FFP, 6.1.11 fusión, 6.1.12 geminación,
6.1.17 macrodoncia, 6.1.18 microdoncia, 6.1.19 movilidad patológica,
6.1.21 clavija, 6.1.22 ectópica, 6.1.24 extruida, 6.1.25 intruida,
6.1.26 supernumeraria, 6.1.27 pulpotomía, 6.1.30 prótesis completa,
6.1.31 prótesis parcial removible, 6.1.32 remanente radicular,
6.1.36 superficie desgastada, 6.1.38 transposición.

The takeaway for NTS-04: **this is not a migration.** Several mappings are
lossy in the direction that matters (legacy → NTS loses required data), and
three legacy types are procedures the norm excludes from the chart
entirely. The two profiles coexist; findings do not convert automatically.

## 16. Validator checklist

`validate_nts_catalog()` aggregates every violation and raises one
`CatalogValidationError` carrying the full list — a broken catalog is fixed
in one pass, not one error per run.

| # | Check |
|---|---|
| 1 | rule count matches `expected_rule_count` |
| 2 | `rule_id` and global-rule `key` are unique |
| 3 | ordinals form a contiguous 1..N sequence |
| 4 | `related_rules` resolve, and no rule relates to itself |
| 5 | scope is one the platform supports |
| 6 | `arch_cardinality` / `range_grouping` / `anchor` are set exactly where their scope or `target_identity` requires |
| 7 | attribute names unique, ≤1 `is_sigla`, value shape matches `kind` |
| 8 | sigla codes unique **within** a rule (never across rules) |
| 9 | a `box_siglas` mark requires an `is_sigla` attribute |
| 10 | `condition_dependent` ⟺ a `condition_state` attribute with `good`/`bad` |
| 11 | geometry mode `none` carries no constraints |
| 12 | `needs_clinical_review` items explain themselves, and the flag propagates to the rule |
| 13 | every rule cites its section; a divergent printed heading is recorded as `document_label` |

Deliberate non-errors, restated because they look like bugs: the same sigla
in different rules (§4), and the presence of `needs_clinical_review` items
(§12).

## 17. Decisions deferred to NTS-04

Carried in `catalog.pending_decisions` so they travel with the data:

1. When does a digital finding become "registrado"? (§13)
2. Does 6.1.30 persist as one bi-arch finding or two related ones?
3. How are multi-segment ranges (6.1.31) grouped?
4. What is the storage shape for the six clinician-defined geometries?
5. Closed vocabularies for the three items in §12 — a clinical question, not
   an engineering one.

Items 1 and 3 are now answered by the record model — see
[`nts-record-model.md`](./nts-record-model.md) §3 and §2.3, and
[ADR 0022](../../adr/0022-nts-lifecycle-auditability-concurrency.md).
Item 4 remains open: **GEOMETRY CONTRACT PENDING**
([`nts-record-model.md`](./nts-record-model.md) §11).
`catalog.pending_decisions` still lists all five and is updated in NTS-04B,
when the data change ships with its tests.

## 18. Consuming the catalog from the frontend (open, not implemented)

The catalog lives in the backend and is Python-only today. When the MINSA
renderer needs it, the one thing that must **not** happen is a second manual
copy of the 38 rules in TypeScript — two hand-maintained sources of a legal
norm will drift, and the drift will be silent.

Candidate strategies, to be decided later (no decision is taken here, and no
endpoint is created by NTS-03):

- a read-only endpoint serving the validated catalog;
- build-time generation of a TS module from the JSON;
- some other shared-artifact strategy.

What already makes any of them cheap: `model_dump()` emits plain JSON-safe
structures (§3.1), so serving or generating needs no special casing.

## 19. Adding a norm version

1. Add `<norm_version>.json` to `nts/catalog/`, matching `^[a-z0-9_]+$` and
   declaring the same `norm_version` inside.
2. Extend the schema enums only if the new norm genuinely needs a value the
   platform lacks — and say so in the PR.
3. Add the version to `OdontogramProfile` (`odontogram/constants.py`) and to
   the migration's `CHECK` constraint if it is user-selectable.
4. Assert its invariants in `tests/test_nts_catalog.py`.

The loader discovers files automatically; nothing else needs registering.
