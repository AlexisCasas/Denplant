"""Tests for the NTS normative catalog (NTS-03).

These are data tests as much as code tests: they pin the readings of NTS
N.° 188 that the Phase 1/2 audit settled, so a later edit to the JSON
cannot quietly change what the norm is taken to say.
"""

import json

import pytest
from pydantic import ValidationError

from app.modules.odontogram.nts.catalog import (
    AttributeDef,
    AttributeKind,
    ColorSemantics,
    GeometryMode,
    RenderKind,
    ReviewStatus,
    Scope,
    SpecificationRequirement,
    VariantValue,
    get_nts_catalog,
    get_nts_rule,
    validate_nts_catalog,
)
from app.modules.odontogram.nts.catalog.loader import (
    CATALOG_DIR,
    CatalogNotFoundError,
    CatalogVersionMismatchError,
    available_norm_versions,
)
from app.modules.odontogram.nts.catalog.validator import CatalogValidationError

NORM = "pe_nts_188_2022"


@pytest.fixture
def catalog():
    return get_nts_catalog(NORM)


# --- 1. the catalog is complete and self-consistent ------------------------


def test_catalog_holds_exactly_the_38_norm_rules(catalog):
    """The norm enumerates 38 findings in §6.1; the audit confirmed the count."""
    assert catalog.expected_rule_count == 38
    assert len(catalog.rules) == 38
    assert catalog.norm_version == NORM
    assert catalog.country == "PE"

    ids = [r.rule_id for r in catalog.rules]
    assert ids == [f"6.1.{n}" for n in range(1, 39)]
    assert sorted(r.ordinal for r in catalog.rules) == list(range(1, 39))


def test_bundled_catalog_passes_its_own_validator(catalog):
    validate_nts_catalog(catalog)  # raises on any violation
    assert NORM in available_norm_versions()


# --- 2. scopes -------------------------------------------------------------


def test_scope_distribution_matches_the_audit(catalog):
    """NTS findings are not all tooth-scoped — the legacy model assumed they were."""
    counts = {s: 0 for s in Scope}
    for rule in catalog.rules:
        counts[rule.scope] += 1

    assert counts[Scope.TOOTH] == 23
    assert counts[Scope.SURFACE] == 6
    assert counts[Scope.PAIR] == 3
    assert counts[Scope.RANGE] == 3
    assert counts[Scope.ARCH] == 3
    assert counts[Scope.MOUTH] == 0, "NTS N.° 188 defines no mouth-wide finding"


def test_scope_modifiers_are_scoped_correctly(catalog):
    """6.1.30 spans one or both arches; 6.1.31 may cover disjoint segments."""
    assert get_nts_rule("6.1.30", NORM).arch_cardinality.value == "one_or_both"
    assert get_nts_rule("6.1.7", NORM).arch_cardinality.value == "one_or_both"
    assert get_nts_rule("6.1.2", NORM).arch_cardinality.value == "one"

    assert get_nts_rule("6.1.31", NORM).range_grouping.value == "multi_segment"
    assert get_nts_rule("6.1.29", NORM).range_grouping.value == "single_segment"
    assert get_nts_rule("6.1.1", NORM).range_grouping.value == "single_segment"

    for rule in catalog.rules:
        if rule.scope is not Scope.ARCH:
            assert rule.arch_cardinality is None, rule.rule_id
        if rule.scope is not Scope.RANGE:
            assert rule.range_grouping is None, rule.rule_id


def test_supernumerary_tooth_has_no_fdi_cell_and_uses_spatial_anchors(catalog):
    """6.1.26's subject is a tooth the chart cannot number."""
    rule = get_nts_rule("6.1.26", NORM)

    assert rule.scope is Scope.TOOTH
    assert rule.target_identity.value == "unnumbered"
    assert rule.anchor is not None
    assert rule.anchor.kind.value == "interproximal"
    assert rule.anchor.cardinality == 2
    assert rule.anchor.role.value == "spatial_reference_only"

    others = [r for r in catalog.rules if r.rule_id != "6.1.26"]
    assert all(r.anchor is None for r in others)
    assert all(r.target_identity.value == "numbered" for r in others)


# --- 3. siglas -------------------------------------------------------------


def test_the_same_sigla_in_different_rules_is_not_an_error(catalog):
    """Identity is norm_version + rule_id; the norm itself reuses codes."""
    assert _sigla_codes(catalog, "6.1.26") == {"S"}
    assert _sigla_codes(catalog, "6.1.35") == {"S"}
    assert _sigla_codes(catalog, "6.1.19") == {"M"}
    assert "M" in _sigla_codes(catalog, "6.1.28")

    validate_nts_catalog(catalog)  # the collisions above must not trip it


def test_each_rule_writes_at_most_one_sigla_in_the_box(catalog):
    for rule in catalog.rules:
        sigla_attrs = [a for a in rule.attributes if a.is_sigla]
        assert len(sigla_attrs) <= 1, rule.rule_id

        if any(m.kind is RenderKind.BOX_SIGLAS for m in rule.render.marks):
            assert sigla_attrs, f"{rule.rule_id} draws a box with nothing in it"

        for attr in rule.attributes:
            if attr.kind is AttributeKind.FIXED:
                assert len(attr.values) == 1, f"{rule.rule_id}.{attr.name}"


def test_multi_value_attributes_carry_the_audited_vocabularies(catalog):
    assert _codes(catalog, "6.1.3", "crown_type") == {"CM", "CF", "CMC", "CV", "CLM"}
    assert _codes(catalog, "6.1.16", "caries_type") == {"MB", "CE", "CD", "CDP"}
    assert _codes(catalog, "6.1.20", "absence_type") == {"DNE", "DEX", "DAO"}
    assert _codes(catalog, "6.1.28", "abnormal_position") == {"M", "D", "V", "P", "L"}
    assert _codes(catalog, "6.1.33", "restoration_material") == {
        "AM",
        "R",
        "IV",
        "IM",
        "IE",
        "C",
    }
    assert _codes(catalog, "6.1.37", "endodontic_treatment_type") == {"TC", "PC"}


# --- 4. colour and render --------------------------------------------------


def test_condition_dependent_rules_carry_a_good_bad_state(catalog):
    """NTS §5.12-5.13: blue for good, red for bad. Nothing else decides colour."""
    for rule in catalog.rules:
        state = next((a for a in rule.attributes if a.name == "condition_state"), None)
        if rule.render.color_semantics is ColorSemantics.CONDITION_DEPENDENT:
            assert state is not None, rule.rule_id
            assert {v.code for v in state.values} == {"good", "bad"}
        else:
            assert state is None, rule.rule_id


def test_render_vocabulary_is_closed(catalog):
    """Seven mark kinds cover all 38 rules; nothing may be invented silently."""
    used = {m.kind for r in catalog.rules for m in r.render.marks}
    assert used <= set(RenderKind)
    assert used == {
        RenderKind.BOX_SIGLAS,
        RenderKind.SYMBOL,
        RenderKind.ARROW,
        RenderKind.LINE,
        RenderKind.CONNECTOR,
        RenderKind.SHAPE_FILL,
        RenderKind.OUTLINE,
    }
    assert all(r.render.marks for r in catalog.rules)


def test_catalog_stores_no_drawings_and_no_colours():
    """The catalog describes marks; it never ships SVG, paths or hex colours."""
    raw = (CATALOG_DIR / f"{NORM}.json").read_text(encoding="utf-8")
    lowered = raw.lower()

    assert "#" not in raw, "hex colours belong to the UI layer"
    for forbidden in ("<svg", "viewbox", '"d":', "stroke-width", "rgb("):
        assert forbidden not in lowered, forbidden

    # And the JSON parses into exactly the declared schema (extra="forbid").
    json.loads(raw)


# --- 5. geometry -----------------------------------------------------------


def test_clinician_defined_shapes_are_the_six_audited_rules(catalog):
    """These need a geometry channel per finding — an open NTS-04 decision."""
    freehand = {
        r.rule_id
        for r in catalog.rules
        if r.geometry_input.mode is GeometryMode.CLINICIAN_DEFINED_SHAPE
    }
    assert freehand == {"6.1.10", "6.1.16", "6.1.33", "6.1.34", "6.1.35", "6.1.36"}


def test_rules_that_draw_nothing_declare_no_geometry_constraints(catalog):
    for rule in catalog.rules:
        if rule.geometry_input.mode is GeometryMode.NONE:
            assert rule.geometry_input.constraints == (), rule.rule_id


def test_directional_rules_do_not_ask_the_clinician_for_a_direction(catalog):
    """6.1.24/6.1.25 arrows follow from the rule and the quadrant, not input."""
    for rule_id in ("6.1.24", "6.1.25"):
        rule = get_nts_rule(rule_id, NORM)
        assert rule.attributes == ()
        assert any(m.kind is RenderKind.ARROW for m in rule.render.marks)


# --- 6. relations, review flags and traceability ---------------------------


def test_sealant_pulls_in_the_caries_rule_when_a_lesion_is_present(catalog):
    rule = get_nts_rule("6.1.35", NORM)
    assert len(rule.related_rules) == 1
    related = rule.related_rules[0]
    assert related.rule_id == "6.1.16"
    assert related.relation.value == "companion_when_present"

    known = {r.rule_id for r in catalog.rules}
    for candidate in catalog.rules:
        for link in candidate.related_rules:
            assert link.rule_id in known
            assert link.rule_id != candidate.rule_id


def test_open_clinical_questions_are_flagged_not_guessed(catalog):
    """The norm leaves three items underspecified; none may be silently filled."""
    flagged = {r.rule_id for r in catalog.rules if r.status is ReviewStatus.NEEDS_CLINICAL_REVIEW}
    assert flagged == {"6.1.5", "6.1.13", "6.1.19"}

    rotation = _attr(catalog, "6.1.13", "rotation_sense")
    assert rotation.kind is AttributeKind.FREE_TEXT
    assert rotation.notes

    degree = _attr(catalog, "6.1.19", "mobility_degree")
    assert degree.kind is AttributeKind.INTEGER
    assert degree.values == ()
    assert degree.notes

    fluorosis = next(v for v in _attr(catalog, "6.1.5", "dde_type").values if v.code == "FLUOROSIS")
    assert fluorosis.status is ReviewStatus.NEEDS_CLINICAL_REVIEW
    assert fluorosis.notes


def test_every_rule_cites_the_norm_and_errata_are_recorded(catalog):
    for rule in catalog.rules:
        assert rule.source.page >= 1
        assert rule.source.section == rule.rule_id
        assert rule.official_name

    # The PDF misprints two headings; the catalog records both rather than
    # normalising them away.
    assert get_nts_rule("6.1.15", NORM).source.document_label == "6.115"
    assert get_nts_rule("6.1.23", NORM).source.document_label == "5.2.23"

    labelled = {r.rule_id for r in catalog.rules if r.source.document_label}
    assert labelled == {"6.1.15", "6.1.23"}


def test_global_conventions_are_modelled_apart_from_the_38_findings(catalog):
    keys = {g.key for g in catalog.global_rules}
    assert {
        "fdi_two_digit",
        "finding_not_procedure",
        "registered_finding_is_unalterable",
        "red_blue_only",
    } <= keys
    assert all(g.summary and g.source.section for g in catalog.global_rules)

    # Immutability is documented as an open workflow question, not implemented.
    assert any("NTS-04" in d for d in catalog.pending_decisions)


# --- 7. deep immutability of the cached catalog ----------------------------
#
# The loader hands every caller the *same* object. `frozen=True` only blocks
# attribute assignment, so a mutable container in a field would let one
# consumer corrupt the catalog for the whole process. These tests pin that
# shut: each attempt must raise, and the damage must not be observable from
# a second `get_nts_catalog()` call.


def test_catalog_collections_cannot_be_mutated_in_place(catalog):
    rule = catalog.rule("6.1.16")

    with pytest.raises(AttributeError):
        catalog.rules.append(rule)
    with pytest.raises(AttributeError):
        catalog.global_rules.append(catalog.global_rules[0])
    with pytest.raises(AttributeError):
        catalog.pending_decisions.append("anything")
    with pytest.raises(AttributeError):
        rule.attributes.append(rule.attributes[0])
    with pytest.raises(AttributeError):
        rule.attributes[0].values.append(rule.attributes[0].values[0])
    with pytest.raises(AttributeError):
        rule.geometry_input.constraints.append(rule.geometry_input.constraints[0])
    with pytest.raises(AttributeError):
        rule.render.marks.append(rule.render.marks[0])

    sealant = catalog.rule("6.1.35")
    with pytest.raises(AttributeError):
        sealant.related_rules.append(sealant.related_rules[0])

    # ...and none of them supports item assignment either.
    with pytest.raises(TypeError):
        catalog.rules[0] = rule
    with pytest.raises(TypeError):
        rule.attributes[0].values[0] = rule.attributes[0].values[0]


def test_render_params_is_a_read_only_mapping(catalog):
    """The one mapping in the schema — the only field that was ever writable."""
    params = catalog.rule("6.1.16").render.marks[0].params

    assert params["fill"] == "solid"  # reads like a dict
    assert params.get("absent") is None
    assert len(params) == 1

    for mutate in (
        lambda: params.__setitem__("fill", "poisoned"),
        lambda: params.clear(),
        lambda: params.pop("fill"),
        lambda: params.update({"fill": "poisoned"}),
    ):
        with pytest.raises((TypeError, AttributeError)):
            mutate()


def test_a_failed_mutation_cannot_be_observed_from_a_second_load():
    """The end-to-end guarantee: the cached catalog survives a hostile caller."""
    original = get_nts_catalog(NORM)
    rule_count = len(original.rules)
    params = dict(original.rule("6.1.16").render.marks[0].params)
    constraints = original.rule("6.1.16").geometry_input.constraints
    related = len(original.rule("6.1.35").related_rules)

    victim = get_nts_catalog(NORM)
    for mutate in (
        lambda: victim.rules.append(victim.rules[0]),
        lambda: victim.rule("6.1.16").render.marks[0].params.update({"x": "1"}),
        lambda: victim.rule("6.1.35").related_rules.append(None),
        lambda: victim.rule("6.1.16").geometry_input.constraints.append(None),
        lambda: victim.rule("6.1.16").attributes[0].values.append(None),
        lambda: setattr(victim, "rules", ()),
    ):
        with pytest.raises((TypeError, AttributeError, ValidationError)):
            mutate()

    reloaded = get_nts_catalog(NORM)
    assert len(reloaded.rules) == rule_count
    assert dict(reloaded.rule("6.1.16").render.marks[0].params) == params
    assert reloaded.rule("6.1.16").geometry_input.constraints == constraints
    assert len(reloaded.rule("6.1.35").related_rules) == related


def test_catalog_still_serialises_to_plain_json(catalog):
    """Read-only mappings must not leak into serialisation (future endpoint)."""
    dumped = catalog.model_dump()
    params = dumped["rules"][15]["render"]["marks"][0]["params"]
    assert type(params) is dict

    round_tripped = type(catalog).model_validate(dumped)
    assert round_tripped == catalog

    assert '"params"' in catalog.model_dump_json()


# --- 8. loader -------------------------------------------------------------


def test_loader_rejects_unknown_and_unsafe_versions():
    with pytest.raises(CatalogNotFoundError):
        get_nts_catalog("pe_nts_999_2099")

    for unsafe in ("../secrets", "PE_NTS_188_2022", "pe-nts-188", ""):
        with pytest.raises(CatalogNotFoundError):
            get_nts_catalog(unsafe)


def test_loader_caches_and_resolves_single_rules():
    assert get_nts_catalog(NORM) is get_nts_catalog(NORM)
    assert get_nts_rule("6.1.16", NORM).official_name == "Lesión de caries dental"

    with pytest.raises(CatalogNotFoundError):
        get_nts_rule("6.1.99", NORM)

    assert issubclass(CatalogVersionMismatchError, CatalogNotFoundError)


# --- 9. the validator actually rejects bad data ----------------------------


def test_validator_catches_a_wrong_rule_count(catalog):
    broken = catalog.model_copy(update={"rules": catalog.rules[:-1]})
    with pytest.raises(CatalogValidationError) as exc:
        validate_nts_catalog(broken)
    assert "expected_rule_count" in str(exc.value)


def test_validator_catches_duplicate_rule_ids(catalog):
    broken = catalog.model_copy(update={"rules": catalog.rules + (catalog.rules[0],)})
    with pytest.raises(CatalogValidationError) as exc:
        validate_nts_catalog(broken)
    assert "appears 2 times" in str(exc.value)


def test_validator_catches_a_dangling_related_rule(catalog):
    original = get_nts_rule("6.1.35", NORM)
    dangling = original.related_rules[0].model_copy(update={"rule_id": "6.1.99"})
    patched = original.model_copy(update={"related_rules": (dangling,)})
    broken = catalog.model_copy(
        update={"rules": tuple(patched if r.rule_id == "6.1.35" else r for r in catalog.rules)}
    )
    with pytest.raises(CatalogValidationError) as exc:
        validate_nts_catalog(broken)
    assert "unknown rule" in str(exc.value)


def test_validator_catches_a_colour_without_a_state(catalog):
    original = get_nts_rule("6.1.3", NORM)
    stripped = original.model_copy(
        update={"attributes": tuple(a for a in original.attributes if a.name != "condition_state")}
    )
    broken = catalog.model_copy(
        update={"rules": tuple(stripped if r.rule_id == "6.1.3" else r for r in catalog.rules)}
    )
    with pytest.raises(CatalogValidationError) as exc:
        validate_nts_catalog(broken)
    assert "condition_state" in str(exc.value)


def test_validator_reports_every_problem_at_once(catalog):
    """A broken catalog should not be fixed one error per run."""
    broken = catalog.model_copy(update={"rules": catalog.rules[:-1]})
    broken = broken.model_copy(
        update={"global_rules": broken.global_rules + (broken.global_rules[0],)}
    )
    with pytest.raises(CatalogValidationError) as exc:
        validate_nts_catalog(broken)
    assert len(exc.value.errors) >= 2


# --- helpers ---------------------------------------------------------------


def _attr(catalog, rule_id: str, name: str):
    rule = catalog.rule(rule_id)
    return next(a for a in rule.attributes if a.name == name)


def _codes(catalog, rule_id: str, name: str) -> set[str]:
    return {v.code for v in _attr(catalog, rule_id, name).values}


def _sigla_codes(catalog, rule_id: str) -> set[str]:
    rule = catalog.rule(rule_id)
    return {v.code for a in rule.attributes if a.is_sigla for v in a.values}


# --- 10. NTS-03.1: target roles and specification requirements -------------
#
# Evidence is the PDF, read for this amendment:
#   6.1.3 (p.6-7) "En el item especificaciones del odontograma se registra el
#     color del metal de la corona, dorada o plateada, o cualquier
#     caracteristica clinica adicional del hallazgo clinico."  -> rule level,
#     with NO per-variant condition stated anywhere.
#   6.1.4 (p.7)  "En el item especificaciones del odontograma, se coloca la
#     caracteristica o material utilizado, asi como cualquier caracteristica
#     adicional."  -> rule level, unconditional.
#   6.1.5 (p.8)  "Fluorosis: Se detalla en el item especificaciones por ser una
#     caracteristica clinica generalizada acompanada de la clasificacion
#     utilizada."  -> variant level, only for FLUOROSIS.
#   6.1.29 (p.16) "Se dibuja una linea recta horizontal ... con lineas
#     verticales sobre los pilares."  -> a pilar is a marked target, and no
#     cardinality is stated.


def test_a_role_is_never_also_modelled_as_an_attribute(catalog):
    """One source: `target_roles` is a rule field, never a finding attribute."""
    for rule in catalog.rules:
        assert "target_roles" not in {a.name for a in rule.attributes}, rule.rule_id


def test_fixed_bridge_declares_pilar_as_a_target_role(catalog):
    rule = get_nts_rule("6.1.29", NORM)
    assert [r.code for r in rule.target_roles] == ["pilar"]
    pilar = rule.role("pilar")
    assert pilar.applies_to.value == "subject"
    # The norm mandates marking the pilares but states no cardinality, so
    # neither bound is asserted. None means "the norm does not say"; 0 would
    # be a claim.
    assert pilar.min_count is None
    assert pilar.max_count is None
    assert pilar.status is ReviewStatus.NEEDS_CLINICAL_REVIEW
    assert pilar.notes


def test_roles_are_retrievable_generically_without_rule_id_branching(catalog):
    with_roles = {
        r.rule_id: [x.code for x in r.target_roles] for r in catalog.rules if r.target_roles
    }
    assert with_roles == {"6.1.29": ["pilar"]}
    # Every other rule answers the same question with an empty tuple rather
    # than needing a special case.
    assert all(r.role("pilar") is None for r in catalog.rules if r.rule_id != "6.1.29")


def test_temporary_crown_requires_its_material_in_especificaciones(catalog):
    requirement = get_nts_rule("6.1.4", NORM).specification_requirement
    assert requirement is not None
    assert requirement.code == "temporary_crown_material"
    assert requirement.required is True
    assert requirement.status is ReviewStatus.VERIFIED
    assert requirement.label


def test_fluorosis_requires_its_classification_at_variant_level(catalog):
    dde = _attr(catalog, "6.1.5", "dde_type")
    fluorosis = next(v for v in dde.values if v.code == "FLUOROSIS")
    assert fluorosis.specification_requirement is not None
    assert fluorosis.specification_requirement.code == "fluorosis_classification"
    assert fluorosis.specification_requirement.required is True
    # ...and no other DDE variant inherits it by inference.
    assert all(v.specification_requirement is None for v in dde.values if v.code != "FLUOROSIS")
    assert get_nts_rule("6.1.5", NORM).specification_requirement is None


def test_crown_metal_colour_is_rule_level_and_left_open(catalog):
    """6.1.3 never says which crown_type values make the entry mandatory.

    CLM is metal-free, so a blanket obligation would be demonstrably wrong.
    The requirement is therefore declared once, non-blocking, and flagged.
    """
    rule = get_nts_rule("6.1.3", NORM)
    requirement = rule.specification_requirement
    assert requirement is not None
    assert requirement.code == "crown_metal_colour"
    assert requirement.required is False
    assert requirement.status is ReviewStatus.NEEDS_CLINICAL_REVIEW
    assert requirement.notes
    # No crown_type variant carries one: nothing was inferred per variant.
    assert all(v.specification_requirement is None for a in rule.attributes for v in a.values)


def test_no_other_rule_gains_a_requirement_by_inference(catalog):
    carrying = {
        r.rule_id
        for r in catalog.rules
        if r.specification_requirement
        or any(v.specification_requirement for a in r.attributes for v in a.values)
    }
    assert carrying == {"6.1.3", "6.1.4", "6.1.5"}


@pytest.mark.parametrize(
    ("rule_id", "attributes", "expected"),
    [
        ("6.1.4", {"sigla": "CT"}, ["temporary_crown_material"]),
        ("6.1.3", {"crown_type": "CM"}, ["crown_metal_colour"]),
        ("6.1.3", {"crown_type": "CLM"}, ["crown_metal_colour"]),
        (
            "6.1.5",
            {"dde_type": "FLUOROSIS", "surfaces": ["V"]},
            ["fluorosis_classification"],
        ),
        ("6.1.5", {"dde_type": "O", "surfaces": ["V"]}, []),
        ("6.1.16", {"caries_type": "CDP", "surfaces": ["O"]}, []),
        ("6.1.29", {"condition_state": "good"}, []),
    ],
)
def test_active_requirements_resolve_from_rule_plus_selected_values(rule_id, attributes, expected):
    """What NTS-04B.2 will call: no rule_id branch, no manual map, no notes."""
    active = get_nts_rule(rule_id, NORM).active_specification_requirements(attributes)
    assert [r.code for r in active] == expected


def test_validator_rejects_a_duplicate_role_within_a_rule(catalog):
    rule = get_nts_rule("6.1.29", NORM)
    broken_rule = rule.model_copy(update={"target_roles": rule.target_roles + rule.target_roles})
    with pytest.raises(CatalogValidationError, match="defined 2 times"):
        validate_nts_catalog(_with(catalog, broken_rule))


def test_validator_rejects_incoherent_role_cardinality(catalog):
    rule = get_nts_rule("6.1.29", NORM)
    pilar = rule.target_roles[0].model_copy(update={"min_count": 3, "max_count": 2})
    broken_rule = rule.model_copy(update={"target_roles": (pilar,)})
    with pytest.raises(CatalogValidationError, match="below min_count"):
        validate_nts_catalog(_with(catalog, broken_rule))


def test_validator_rejects_a_role_flagged_without_notes(catalog):
    rule = get_nts_rule("6.1.29", NORM)
    pilar = rule.target_roles[0].model_copy(update={"notes": None})
    broken_rule = rule.model_copy(update={"target_roles": (pilar,)})
    with pytest.raises(CatalogValidationError, match="needs_clinical_review"):
        validate_nts_catalog(_with(catalog, broken_rule))


def test_validator_rejects_a_role_modelled_as_an_attribute(catalog):
    rule = get_nts_rule("6.1.29", NORM)
    smuggled = AttributeDef(
        name="target_roles",
        kind=AttributeKind.ENUM_MULTI,
        values=(VariantValue(code="pilar", name="Pilar"),),
    )
    broken_rule = rule.model_copy(update={"attributes": rule.attributes + (smuggled,)})
    with pytest.raises(CatalogValidationError, match="not an attribute"):
        validate_nts_catalog(_with(catalog, broken_rule))


def test_validator_rejects_rule_and_variant_requirements_at_once(catalog):
    """The specifications table stores no requirement code.

    With two requirements active on one finding, nothing could show which
    one a linked entry satisfied, so the combination is refused.
    """
    rule = get_nts_rule("6.1.3", NORM)
    crown_type = next(a for a in rule.attributes if a.name == "crown_type")
    cm = crown_type.values[0].model_copy(
        update={
            "specification_requirement": SpecificationRequirement(
                code="metal_colour_cm", label="Color del metal"
            )
        }
    )
    patched_attr = crown_type.model_copy(update={"values": (cm,) + crown_type.values[1:]})
    broken_rule = rule.model_copy(
        update={
            "attributes": tuple(
                patched_attr if a.name == "crown_type" else a for a in rule.attributes
            )
        }
    )
    with pytest.raises(CatalogValidationError, match="ambiguous"):
        validate_nts_catalog(_with(catalog, broken_rule))


def test_validator_rejects_two_requirements_on_one_multi_valued_attribute(catalog):
    """Two surfaces could be chosen at once; neither could be shown satisfied."""
    rule = get_nts_rule("6.1.16", NORM)
    surfaces = next(a for a in rule.attributes if a.name == "surfaces")
    flagged = tuple(
        v.model_copy(
            update={
                "specification_requirement": SpecificationRequirement(
                    code=f"detail_{v.code}", label=f"Detalle {v.code}"
                )
            }
        )
        if v.code in {"M", "D"}
        else v
        for v in surfaces.values
    )
    patched_attr = surfaces.model_copy(update={"values": flagged})
    broken_rule = rule.model_copy(
        update={
            "attributes": tuple(
                patched_attr if a.name == "surfaces" else a for a in rule.attributes
            )
        }
    )
    with pytest.raises(CatalogValidationError, match="multi-valued"):
        validate_nts_catalog(_with(catalog, broken_rule))


def _with(catalog, replacement):
    """The bundled catalog with one rule swapped for a mutated copy."""
    return catalog.model_copy(
        update={
            "rules": tuple(
                replacement if r.rule_id == replacement.rule_id else r for r in catalog.rules
            )
        }
    )
