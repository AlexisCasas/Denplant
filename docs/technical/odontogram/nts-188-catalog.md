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
- **A target's role is not an attribute.** See §7.1.

### 7.1 Target roles

`NtsRule.target_roles` carries the roles a *target* of a finding may hold.
NTS N.° 188 defines exactly one: `pilar`, on 6.1.29, whose §6.1.29
draws "una línea recta horizontal ... con líneas verticales **sobre los
pilares**" — being a pilar is a property of one tooth inside the span, not
a datum of the finding.

It lives on the rule and **never also as an attribute**; the validator
refuses an attribute named `target_roles` precisely so a target's role
cannot acquire two sources.

`min_count` / `max_count` are `None` when **the norm states no
cardinality** — which is the case for `pilar`. `0` would be a stated lower
bound, never a stand-in for silence. The role is flagged
`needs_clinical_review` because §6.1.29 mandates marking the pilares but
never says how many there must be, nor which teeth of the span may be one.

Role codes and siglas are **separate namespaces**: a role code equal to a
sigla is not a collision, because nothing ever reads one as the other.

### 7.2 Especificaciones requirements

Three rules route data to the *Especificaciones* item (§5.14), and each now
says so structurally rather than in prose, so a consumer never branches on a
`rule_id`:

| Where | Rule | `code` | `required` | Evidence |
|---|---|---|---|---|
| rule level | 6.1.3 | `crown_metal_colour` | **false**, flagged | §6.1.3 (p.6-7) states it for the rule and names no crown_type condition |
| rule level | 6.1.4 | `temporary_crown_material` | true | §6.1.4 (p.7) "se coloca la característica o material utilizado" |
| variant level | 6.1.5 `dde_type=FLUOROSIS` | `fluorosis_classification` | true | §6.1.5 (p.8) "Se detalla en el ítem especificaciones ... acompañada de la clasificación utilizada" |

**Why 6.1.3 is not per-variant.** The norm's sentence is rule-level and
lists no condition; the crown-type list appears afterwards and is about
what goes in the box. A blanket obligation would also be wrong, since
`CLM` is metal-free and has no metal colour. It is therefore declared once,
`required=false`, and flagged `needs_clinical_review` until a clinical
reading closes which variants demand it. Nothing was inferred per variant.

`NtsRule.active_specification_requirements(attributes)` returns the
rule-level requirement plus the requirement of every selected variant, so
the question *"does this finding need an Especificaciones entry?"* is
answered from the catalog alone.

A requirement can be declared at rule level **or** at variant level, never
both: `nts_record_specifications` stores no requirement code, so with two
active requirements nothing could show which one a linked entry satisfied.
The validator rejects that combination, and also rejects two requirements
on one `enum_multi` attribute for the same reason.

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

A mark carries two kinds of information, kept deliberately apart.

**`params` say how it looks.** Descriptive tokens (`{"shape": "x_cross"}`),
never coordinates, and never free strings: each key has a closed vocabulary
declared in `MARK_PARAMS` (`MarkPlacement`, `SymbolShape`, `LineStyle`,
`ArrowStyle`, `ArrowDirection`, `ConnectorStyle`, `FillStyle`,
`OutlineStyle`, `SiglaCase`, `LineMeaning`), so a renderer switches over an
enum rather than matching strings it hopes exist. An arrow must declare both
`style` and `at` (`REQUIRED_MARK_PARAMS`): §6.1.23 draws its arrow *on* the
tooth and §6.1.24/6.1.25 draw theirs *outside* it, and neither placement
follows from `toward`.

**`text_from` / `suffix_from` / `role` say what data it reads.** They are
references into the rule's own `attributes` and `target_roles`, resolved by
the validator:

| Field | Meaning | Example |
|---|---|---|
| `text_from` | attribute whose selected value is the text written | 6.1.3 → `crown_type` |
| `suffix_from` | attribute appended after that text | 6.1.19 → `mobility_degree` |
| `role` | `target_roles` code selecting which targets carry the mark | 6.1.29 → `pilar` |
| `target_selector` | a subset of targets chosen by the span's own shape | 6.1.1 → `range_endpoints` |
| `regions_from` | attribute whose selected values name the regions the mark covers | 6.1.16 → `surfaces` |

**`at` says where, `target_selector` and `role` say which targets.** They are
separate because a mark can state both: §6.1.1 draws its crossed squares on
"las piezas dentarias que correspondan a **los extremos** del aparato" and
"**a nivel de los ápices**". Until NTS-05D.3a the placement token `endpoints`
was answering the second question while occupying the field for the first,
which left that symbol with no stated height at all.

**`geometry_input.constraints` is not a placement source.** It is declared once
per *rule* while marks are many. §6.1.8 constrains itself to `root_area,
crown_area` for a line on the root and a square on the crown, so a renderer
reading constraints to place either would find two candidate areas and no way
to choose. Every mark that needs a position states its own `at`; the validator
requires it of connectors always, and of lines unless the clinician draws the
shape.

Bindings are declared rather than inferred because the obvious inferences are
wrong. "The rule's one `is_sigla` attribute" looks like a safe answer for
`text_from`, but 6.1.26 carries a sigla that goes **inside a circle** and never
into the box — `is_sigla` says a sigla exists, not that a box is drawn. And
§6.1.29's verticals sit on the *pilares*, which the norm never equates with the
span's endpoints, so the connector reads a role off the targets instead of
guessing from position.

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

Mode `surface_regions` is **platform vocabulary that NTS N.° 188 does not
use**. 6.1.5 (DDE) declared it until NTS-05D.0b, but the norm asks which
surfaces are affected and then only writes the siglas in the box (p.7-8), so
the mode promised a drawing the norm never describes. Do not implement it
speculatively: no rule exercises it, and no test can therefore cover it.

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
| 14 | role definitions are well formed, unique, and never also modelled as an attribute |
| 15 | Especificaciones requirements cannot be ambiguous for the current model |
| 16 | every mark param is declared for its kind, with a value from that key's vocabulary; required params are present |
| 17 | every `box_siglas` declares `text_from`; `text_from`/`suffix_from`/`role` resolve within the rule; no `is_sigla` attribute is left unread |
| 18 | every connector, and every non-freehand line, declares its own `at` |
| 19 | a `target_selector` is used on a mark drawn per target, and `range_endpoints` only on a numbered range |
| 20 | `shape_fill` and `outline` take their geometry from exactly one source — a landmark `at` **or** a `regions_from` attribute, which must be `enum_multi`; no other kind may carry one |

**What a surface code looks like is not in the catalog, and not settled.** The
norm draws "la forma que se observa" (pp. 11, 17) and defines no
correspondence between `M`/`D`/`O`/`V`/`L` and parts of a drawn crown. Any such
mapping is a **product policy**: proposed in the NTS-05D.4 pre-flight, with
mesial/distal derivation verified against all eight quadrants, but **pending
clinical validation** on two points — the vestibular/lingual orientation, and
how an anterior's occlusal/incisal surface should be represented when its
central region is 4% of the crown. The catalog states which attribute carries
the codes and stops there.

Checks 16 and 17 are what make a rule-id-free renderer possible: after them, a
mark's text source, suffix source, target role and placement are all answerable
from metadata alone. Retiring a token is also enough to make its old spelling a
hard error, which is how the `apex_height` / `vertical` / `square_enclosing_crown`
synonyms and the prose `at: "pillars"` stay retired.

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

## 20. What a surface looks like is **not** in this catalog

NTS N.° 188 supplies the surface vocabulary — `M`, `D`, `O`, `V`, `L` — and
`regions_from` (§9) says which attribute a `shape_fill` or `outline` reads it
from. That is the whole of the normative contract. The norm then says the mark
is drawn "según la forma que se observa" (pp. 11, 17) and **never states which
part of a drawn crown a surface code corresponds to**.

So the correspondence is a **DenPlant clinically validated product policy**,
not a normative mapping, and it deliberately lives outside the catalog — in
`odontogram/frontend/utils/ntsSurfaceGeometry.ts`, pinned by
`tests/components/ntsSurfaceGeometry.spec.ts`. A catalog test asserts that no
region id, side or geometric word appears in the JSON at all, so the boundary
cannot erode by accident.

What a dentist validated, and which this documentation records as product
policy rather than norm:

| Surface | Resolves to | Because |
|---|---|---|
| `M` | the trapezoid facing the midline | mesial is toward the midline, so it follows the quadrant, not a fixed side |
| `D` | the opposite trapezoid | |
| `V` | upper: top · lower: bottom | "vestibular hacia afuera en ambas arcadas" — the two arches mirror each other |
| `L` | upper: bottom · lower: top | lingual/palatal takes the side opposite vestibular |
| `O` (posterior) | every central polygon | clinically one table, however many tiles it is drawn in |
| `O` (anterior) | a centred horizontal incisal band | spans the anterior central zone edge to edge, inset vertically so it never sits on the vestibular/lingual divide |

Contiguous affected surfaces merge into **one continuous figure with no
internal divider**; surfaces that do not touch stay separate rather than being
bridged, because one shape spanning them would claim the sound surface between
was affected too.

The incisal band's width is **derived from the central zone, never chosen**.
It spans `innerLeft → innerRight` exactly — 34% of the crown on the present
geometry, but read off that geometry rather than written down. Visibility is
bought with height (60% of the zone, leaving positive clearance above and
below) and, later, with stroke and fill in the renderer. It is deliberately not
bought by widening: a band pushed past the zone would cover the mesial and
distal trapezoids, claiming surfaces nobody recorded, and would overlap its
neighbours instead of meeting them, so it could not take part in the tiling.

Because the band is one of the tiles, **there is exactly one geometry for an
anterior's occlusal surface** — the same polygon that `resolveSurfaceRegions`
returns, that `resolveSurfaceComponents` merges, and that
`resolveSurfaces().incisal` points at. A separate "visual" shape beside a
"logical" one would agree today and diverge the first time an outline was
drawn from one and a fill from the other.

Two consequences worth stating, because neither is a defect to be fixed:

- On an anterior, **V+O and L+O are two figures**, not one. The band is inset
  from the vestibular and lingual boundaries precisely so it never sits on the
  divide; the price is that it does not reach them either. Bridging the gap
  would paint sound enamel.
- An anterior with **all five surfaces has two holes** — the slivers above and
  below the band, which were never recorded as affected. Rim and hole loops are
  wound oppositely so the set draws correctly as one path under either fill
  rule.

**G5 is now closed as product policy, not as norm.** Nothing above may be
cited as something NTS N.° 188 defines.

## 21. How an area mark is drawn (NTS-05D.4)

`shape_fill` and `outline` are the last two mark kinds to reach the chart, and
they share one resolver because they are the same geometry painted two ways:
the fill covers the regions, the contour strokes their **merged boundary**.

Where the geometry comes from is read from the mark and never guessed:

| The mark declares | Resolved by |
|---|---|
| `regions_from` | the bound attribute's codes → the surface policy (§20) |
| `params.at` | the named landmark → the crown tiles it covers |

The renderer never reads `finding.attributes.surfaces` by name. Every rule in
this norm happens to call the attribute that, and a renderer that hardcoded it
would be right by accident until a norm named it otherwise — which is the gap
`regions_from` was added to close. Anything the binding cannot resolve —
absent attribute, a value that is not a set of codes, an empty set, codes that
name no geometry — is reported as `unsupported` with its own reason. Nothing
is approximated.

**A landmark is not a surface.** `coronal_pulp` resolves to the crown's central
tiles through the dentition's neutral accessor, *not* through the surface
policy. On a front tooth the two are materially different polygons — the
landmark is the whole central zone, the incisal surface is the inset band
inside it — and drawing one with the other's shape would be a wrong clinical
statement, not a rounding error.

**Style params are optional, and the fallback is guarded.** The catalog
requires only an arrow to carry its own params, so an area mark may declare no
style, and one in this norm does. The renderer falls back to the single style
its vocabulary declares, which is a reading of the contract rather than a
guess — while the vocabulary has one member. A test pins that; if either enum
ever gains a second value, the catalog has to declare a default before the
fallback can stay.

### Multi-loop figures

A component's `boundary` is **one or more** closed loops. A figure that
encloses ground the finding does not cover has a rim *and* holes, wound against
each other by nesting depth. The renderer keeps every loop and emits them as
**one path** with one closed subpath each, under `fill-rule="nonzero"` —
chosen because that is exactly what the opposite windings mean, not as a
default. Drawing only the first loop would fill a hole in and claim an area
nobody recorded; splitting the loops across separate paths would discard the
relationship the winding encodes.

### Two findings on the same ground

Both are drawn, both keep every instruction, and neither is merged into the
other: merging is only ever within one finding. Painting order is the record's
own order, kept stable through the layer sort. The situation is reported
outside the drawing as `NtsChartRender.overlaps`, flagged `silent` when one of
the findings writes no sigla anywhere — a contour has no letters to fall back
on, so whatever is painted over it can hide it completely.

### Coverage

With these two kinds implemented the catalog classifies as **35 complete,
1 partial, 2 unsupported**. What remains is not a renderer gap:

| Rule | State | Why |
|---|---|---|
| 6.1.35 sealant | partial | its sigla draws; the fissure anatomy the mark follows is not modelled (G10) |
| 6.1.10 fracture | unsupported | the norm draws the shape the clinician observed, and no channel carries it (G6) |
| 6.1.13 giroversión | unsupported | the direction is a clinical observation the norm never enumerates (CLINICAL-03) |

### Neutral structure under a fill (NTS-05D.4c)

A solid clinical fill is painted over the drawing, so it hides the tooth's own
strokes beneath it. Repainting the whole tooth on top would fix the crown and
break something more important: the grid would put a divider back between
contiguous surfaces, which is exactly what merging them exists to prevent.

The figure's own rim settles it, and no new rule is needed:

| Segment | Restored? | Why |
|---|---|---|
| outer crown perimeter | **yes** | on the rim, and a line the tooth is drawn with |
| selected ↔ unaffected surface | **yes** | same — it is the border of the finding |
| selected ↔ selected, one figure | **no** | interior: already absent from `boundary` |
| the incisal band's long sides | **no** | the drawing has no line there (synthetic) |
| the incisal band's short ends | **yes** | they sit on the central zone's real divider |

So the restored set is `boundary ∩ (the tooth's own edges)`. The first term
drops internal dividers for free — an edge shared by two selected regions
cancels during boundary extraction — and the second drops geometry DenPlant
introduced but the odontogram never had. **A neutral stroke is never drawn on
an edge the base chart does not contain.**

It is emitted as open polylines, never closed rings: these are stretches of an
existing outline showing through again, and closing one would draw an edge the
drawing does not have. They use the chart's own neutral ink and
`NTS_TOOTH_STROKE`, the same constant the cell draws with, so the result reads
as the drawing showing through rather than as a new line on top of it — and
`ntsDentition` owns that constant precisely so there cannot be two.

Painting order is fill → **structure** → outline → line/connector → symbol →
arrow → text. Any earlier and the fill covers it again; any later and it cuts
across clinical marks. An `outline` gets none: it fills nothing, so it hides
nothing.

No opacity, blend mode, pattern or third colour is involved — the clinical
fill stays solid and its two colours stay the only two.
