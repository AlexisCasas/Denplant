"""Tests for the NTS normative catalog (NTS-03).

These are data tests as much as code tests: they pin the readings of NTS
N.° 188 that the Phase 1/2 audit settled, so a later edit to the JSON
cannot quietly change what the norm is taken to say.
"""

import json

import pytest
from pydantic import ValidationError

from app.modules.odontogram.nts.catalog import (
    MARK_PARAMS,
    REQUIRED_MARK_PARAMS,
    AttributeDef,
    AttributeKind,
    ColorSemantics,
    GeometryMode,
    MarkPlacement,
    RenderKind,
    ReviewStatus,
    RoleAppliesTo,
    Scope,
    SpecificationRequirement,
    TargetSelector,
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


# --- 11. NTS-05D.0b: render metadata is resolvable without a rule_id --------
#
# The 05D.0 audit found that a renderer could not build any of the 38 findings
# from metadata alone: it would have had to know that 6.1.29's "pillars" means
# the `pilar` role, that 6.1.19's degree comes from `mobility_degree`, that
# 6.1.26's sigla goes in a circle rather than the box, and that 6.1.23 draws
# its arrow on the tooth while 6.1.24 draws one outside it. Every one of those
# is now declared. These tests pin the declarations and, more importantly, pin
# that they are *resolvable generically* — the property the renderer depends on.
#
# Evidence read for this amendment (the scanned PDF, rotated to read):
#   6.1.3  (p.6)  "Se dibuja un cuadrado bordeando la corona clinica..."
#   6.1.4  (p.7)  "Se dibuja un cuadrado de color rojo que encierre la corona..."
#   6.1.5  (p.7-8) "Se colocan en el recuadro correspondiente ... las siglas del
#     hallazgo clinico identificado en la(s) superficie(s) dentaria(s)."
#   6.1.23 (p.14) "Se dibuja sobre la grafica de la pieza dentaria una flecha..."
#   6.1.24 (p.14) "Se dibuja fuera del grafico de la pieza dentaria una flecha
#     recta vertical ... dirigida en sentido externo en incisal u oclusal."
#   6.1.25 (p.14) "Se dibuja fuera del grafico de la pieza dentaria, una flecha
#     recta vertical ... dirigida hacia la zona incisal u oclusal."
#   6.1.29 (p.16) "...con lineas verticales sobre los pilares."


def test_every_box_siglas_mark_declares_where_its_text_comes_from(catalog):
    """C3. 19 rules write in the box; not one of them leaves the source implied."""
    boxes = [
        (rule, mark)
        for rule in catalog.rules
        for mark in rule.render.marks
        if mark.kind is RenderKind.BOX_SIGLAS
    ]
    assert len(boxes) == 19

    for rule, mark in boxes:
        assert mark.text_from, rule.rule_id
        source = next(a for a in rule.attributes if a.name == mark.text_from)
        assert source.is_sigla, f"{rule.rule_id}.{mark.text_from}"
        assert source.kind in (AttributeKind.ENUM, AttributeKind.FIXED), rule.rule_id


def test_a_sigla_can_live_outside_the_box(catalog):
    """C2. `is_sigla` says a sigla exists, never that a box is drawn.

    6.1.26 writes its "S" inside the circumference between the two apices
    (p.15), so a renderer that keyed the annotation box off `is_sigla` would
    print a stray S in the box of a tooth that is not even the subject.
    """
    rule = get_nts_rule("6.1.26", NORM)
    assert any(a.is_sigla for a in rule.attributes)
    assert not any(m.kind is RenderKind.BOX_SIGLAS for m in rule.render.marks)

    symbol = rule.render.marks[0]
    assert symbol.kind is RenderKind.SYMBOL
    assert symbol.params["shape"] == "circle_enclosing_sigla"
    assert symbol.text_from == "sigla"


def test_no_declared_sigla_is_left_unread(catalog):
    """The same invariant from the other side: dead sigla data is a defect."""
    for rule in catalog.rules:
        read = {m.text_from for m in rule.render.marks if m.text_from}
        for attribute in rule.attributes:
            if attribute.is_sigla:
                assert attribute.name in read, f"{rule.rule_id}.{attribute.name}"


def test_mobility_degree_is_bound_not_inferred(catalog):
    """C4. The degree is a second datum, and the catalog names which one.

    CLINICAL-04 stays open: no scale and no bounds are invented here.
    """
    mark = get_nts_rule("6.1.19", NORM).render.marks[0]
    assert mark.text_from == "sigla"
    assert mark.suffix_from == "mobility_degree"
    # The old `suffix: "degree"` token only restated the attribute's own name.
    assert "suffix" not in mark.params

    degree = _attr(catalog, "6.1.19", "mobility_degree")
    assert degree.kind is AttributeKind.INTEGER
    assert degree.values == ()


def test_the_bridge_connector_selects_its_targets_by_role(catalog):
    """C5. `pilar` is the persisted role code, not prose about pillars.

    §6.1.29 marks the pilares of the span. The norm never says they are the
    endpoints — the figure's bridge just happens to have them there — so the
    renderer must read the role off the targets.
    """
    rule = get_nts_rule("6.1.29", NORM)
    connector = next(m for m in rule.render.marks if m.kind is RenderKind.CONNECTOR)

    assert connector.role == "pilar"
    assert rule.role(connector.role) is not None
    assert rule.role(connector.role).applies_to is RoleAppliesTo.SUBJECT
    # The mark does carry an `at` since NTS-05D.3a, but it is a band — where
    # the connector is drawn — and never a restatement of which teeth it
    # applies to. That question has exactly one answer, and it is the role.
    assert connector.params["at"] == "apex_level"
    assert "pillars" not in connector.params.values()
    assert connector.target_selector is None
    # ...and CLINICAL-02 is still open: no cardinality was invented.
    assert rule.role("pilar").min_count is None
    assert rule.role("pilar").max_count is None


@pytest.mark.parametrize(
    ("rule_id", "placement", "toward"),
    [
        ("6.1.23", "on_figure", "occlusal_plane"),
        ("6.1.24", "outside_occlusal", "outward"),
        ("6.1.25", "outside_occlusal", "incisal_occlusal"),
    ],
)
def test_arrow_placement_is_declared_separately_from_direction(rule_id, placement, toward):
    """C6. Where the arrow sits and which way it points are two facts.

    6.1.24 and 6.1.25 share a placement and oppose in direction; 6.1.23 shares
    6.1.24's screen direction and sits somewhere else entirely. Neither fact
    can be derived from the other.
    """
    mark = get_nts_rule(rule_id, NORM).render.marks[0]
    assert mark.kind is RenderKind.ARROW
    assert mark.params["at"] == placement
    assert mark.params["toward"] == toward


def test_every_arrow_declares_a_style_and_a_placement(catalog):
    for rule in catalog.rules:
        for mark in rule.render.marks:
            if mark.kind is RenderKind.ARROW:
                assert "style" in mark.params, rule.rule_id
                assert "at" in mark.params, rule.rule_id


def test_the_crown_square_is_one_token(catalog):
    """C7. 6.1.3 and 6.1.4 draw the same rectangle; the wording differs, not the figure."""
    shapes = {
        get_nts_rule(rule_id, NORM).render.marks[0].params["shape"]
        for rule_id in ("6.1.3", "6.1.4")
    }
    assert shapes == {"square_bordering_crown"}


def test_dde_writes_a_sigla_and_draws_nothing_on_the_tooth(catalog):
    """C1. The surfaces stay clinical data; they are not a drawing instruction.

    §6.1.5 asks which surfaces are affected and then only writes the siglas in
    the box, so a mode of `surface_regions` promised a drawing the norm never
    describes.
    """
    rule = get_nts_rule("6.1.5", NORM)
    assert rule.geometry_input.mode is GeometryMode.NONE
    assert rule.geometry_input.constraints == ()
    assert [m.kind for m in rule.render.marks] == [RenderKind.BOX_SIGLAS]
    # The clinical contract is untouched: the norm does ask for the surfaces.
    surfaces = _attr(catalog, "6.1.5", "surfaces")
    assert surfaces.kind is AttributeKind.ENUM_MULTI
    assert {v.code for v in surfaces.values} == {"M", "D", "O", "V", "L"}
    assert rule.notes


@pytest.mark.parametrize("legacy", ["apex_height", "pillars", "square_enclosing_crown"])
def test_retired_tokens_are_gone_from_the_catalog(legacy):
    """C8 + C5 + C7. A synonym left in the data is a second spelling to support."""
    raw = (CATALOG_DIR / f"{NORM}.json").read_text(encoding="utf-8")
    assert legacy not in raw


def test_the_vertical_line_synonym_is_gone(catalog):
    """C8. 6.1.8 and 6.1.37 both draw a vertical line down the root."""
    styles = {
        mark.params["style"]
        for rule_id in ("6.1.8", "6.1.37")
        for mark in get_nts_rule(rule_id, NORM).render.marks
        if mark.kind is RenderKind.LINE
    }
    assert styles == {"straight_vertical"}


def test_every_mark_param_is_declared_vocabulary(catalog):
    """G. Nothing a renderer must switch on is an undeclared string."""
    for rule in catalog.rules:
        for mark in rule.render.marks:
            allowed = MARK_PARAMS[mark.kind]
            for key, value in mark.params.items():
                assert key in allowed, f"{rule.rule_id}: {mark.kind.value}.{key}"
                assert value in {m.value for m in allowed[key]}, (
                    f"{rule.rule_id}: {mark.kind.value}.{key}={value}"
                )


def test_the_whole_render_contract_resolves_for_all_38_rules(catalog):
    """The coverage test: every binding on every rule resolves from metadata.

    This is what 05D.1-05D.4 will rely on. If it passes, a renderer can be
    written with a `match mark.kind` and nothing else — no rule_id anywhere.
    """
    assert len(catalog.rules) == 38
    seen_kinds = set()

    for rule in catalog.rules:
        assert rule.render.marks, rule.rule_id
        for mark in rule.render.marks:
            seen_kinds.add(mark.kind)
            names = {a.name for a in rule.attributes}

            if mark.text_from is not None:
                assert mark.text_from in names, f"{rule.rule_id}: {mark.text_from}"
            if mark.suffix_from is not None:
                assert mark.suffix_from in names, f"{rule.rule_id}: {mark.suffix_from}"
                assert mark.suffix_from != mark.text_from, rule.rule_id
            if mark.role is not None:
                assert rule.role(mark.role) is not None, f"{rule.rule_id}: {mark.role}"
            if mark.kind is RenderKind.BOX_SIGLAS:
                assert mark.text_from is not None, rule.rule_id
            if mark.kind is RenderKind.ARROW:
                assert set(REQUIRED_MARK_PARAMS[RenderKind.ARROW]) <= set(mark.params)

    assert seen_kinds == set(RenderKind)


# --- 12. the validator rejects each way the contract can be broken ---------


def test_validator_rejects_a_box_without_a_text_source(catalog):
    rule = get_nts_rule("6.1.9", NORM)
    box = rule.render.marks[0].model_copy(update={"text_from": None})
    broken = rule.model_copy(update={"render": rule.render.model_copy(update={"marks": (box,)})})
    with pytest.raises(CatalogValidationError, match="must declare text_from"):
        validate_nts_catalog(_with(catalog, broken))


def test_validator_rejects_a_text_source_that_does_not_exist(catalog):
    rule = get_nts_rule("6.1.9", NORM)
    box = rule.render.marks[0].model_copy(update={"text_from": "no_such_attribute"})
    broken = rule.model_copy(update={"render": rule.render.model_copy(update={"marks": (box,)})})
    with pytest.raises(CatalogValidationError, match="is not an attribute of this rule"):
        validate_nts_catalog(_with(catalog, broken))


def test_validator_rejects_a_text_source_that_is_not_the_sigla(catalog):
    """6.1.16 could point its box at `surfaces`; a box holds one sigla."""
    rule = get_nts_rule("6.1.16", NORM)
    box = next(m for m in rule.render.marks if m.kind is RenderKind.BOX_SIGLAS)
    patched = box.model_copy(update={"text_from": "surfaces"})
    marks = tuple(patched if m is box else m for m in rule.render.marks)
    broken = rule.model_copy(update={"render": rule.render.model_copy(update={"marks": marks})})
    with pytest.raises(CatalogValidationError, match="not the rule's sigla attribute"):
        validate_nts_catalog(_with(catalog, broken))


def test_validator_rejects_a_suffix_source_that_does_not_exist(catalog):
    rule = get_nts_rule("6.1.19", NORM)
    box = rule.render.marks[0].model_copy(update={"suffix_from": "grade"})
    broken = rule.model_copy(update={"render": rule.render.model_copy(update={"marks": (box,)})})
    with pytest.raises(CatalogValidationError, match="suffix_from 'grade' is not an attribute"):
        validate_nts_catalog(_with(catalog, broken))


def test_validator_rejects_a_connector_role_that_is_not_declared(catalog):
    rule = get_nts_rule("6.1.29", NORM)
    connector = next(m for m in rule.render.marks if m.kind is RenderKind.CONNECTOR)
    patched = connector.model_copy(update={"role": "pillar"})
    marks = tuple(patched if m is connector else m for m in rule.render.marks)
    broken = rule.model_copy(update={"render": rule.render.model_copy(update={"marks": marks})})
    with pytest.raises(CatalogValidationError, match="is not declared in target_roles"):
        validate_nts_catalog(_with(catalog, broken))


def test_validator_rejects_an_arrow_without_a_placement(catalog):
    rule = get_nts_rule("6.1.24", NORM)
    arrow = rule.render.marks[0].model_copy(
        update={"params": {"style": "straight_vertical", "toward": "outward"}}
    )
    broken = rule.model_copy(update={"render": rule.render.model_copy(update={"marks": (arrow,)})})
    with pytest.raises(CatalogValidationError, match="param 'at' is required"):
        validate_nts_catalog(_with(catalog, broken))


@pytest.mark.parametrize(
    ("rule_id", "params", "message"),
    [
        # A retired synonym is now simply not vocabulary.
        ("6.1.2", {"style": "zigzag", "at": "apex_height"}, "not in the declared vocabulary"),
        ("6.1.2", {"style": "vertical", "at": "apex_level"}, "not in the declared vocabulary"),
        # ...as is a param invented for a kind that has no such notion.
        ("6.1.2", {"style": "zigzag", "at": "apex_level", "shape": "circle"}, "is not declared"),
    ],
)
def test_validator_rejects_undeclared_mark_vocabulary(catalog, rule_id, params, message):
    rule = get_nts_rule(rule_id, NORM)
    mark = rule.render.marks[0].model_copy(update={"params": params})
    broken = rule.model_copy(update={"render": rule.render.model_copy(update={"marks": (mark,)})})
    with pytest.raises(CatalogValidationError, match=message):
        validate_nts_catalog(_with(catalog, broken))


def test_validator_rejects_a_sigla_no_mark_reads(catalog):
    """A rule that declares a sigla and draws no text would lose it silently."""
    rule = get_nts_rule("6.1.9", NORM)
    box = rule.render.marks[0].model_copy(
        update={"kind": RenderKind.OUTLINE, "params": {"style": "contour"}, "text_from": None}
    )
    broken = rule.model_copy(update={"render": rule.render.model_copy(update={"marks": (box,)})})
    with pytest.raises(CatalogValidationError, match="no mark reads it via text_from"):
        validate_nts_catalog(_with(catalog, broken))


# --- 13. NTS-05D.3a: where a mark goes vs which targets it applies to -------
#
# The 05D.3 pre-flight found four marks with no stated height: 6.1.1's symbol
# and connector and 6.1.29's line and connector. The norm states it for both
# rules -- "a nivel de los apices" on p.6 and p.16 -- and the catalog carried
# it only in `geometry_input.constraints`, which is per-rule and therefore
# cannot say where an individual mark goes.
#
# The fix separates two questions that `at` had been answering at once:
#   at              -> where the mark is drawn
#   target_selector -> which of the finding's targets it applies to
# `endpoints` was the second wearing the clothes of the first.


def test_endpoint_symbols_state_both_where_and_which(catalog):
    """A/B. 6.1.1 draws crossed squares on the extremes, at apex level."""
    rule = get_nts_rule("6.1.1", NORM)
    symbol = next(m for m in rule.render.marks if m.kind is RenderKind.SYMBOL)

    assert symbol.params["at"] == "apex_level"
    assert symbol.target_selector is TargetSelector.RANGE_ENDPOINTS
    # The two facts live in two fields; neither stands in for the other.
    assert symbol.params["at"] != "endpoints"


def test_every_connector_states_where_it_is_drawn(catalog):
    """C/E/J. A connector is two points and nothing else; it must say where."""
    connectors = [
        (rule, mark)
        for rule in catalog.rules
        for mark in rule.render.marks
        if mark.kind is RenderKind.CONNECTOR
    ]
    assert len(connectors) == 2

    for rule, mark in connectors:
        assert mark.params["at"] == "apex_level", rule.rule_id


def test_the_three_prosthesis_rules_agree_on_their_band(catalog):
    """D. 6.1.29 used to omit what 6.1.30 and 6.1.31 declared."""
    bands = set()
    for rule_id in ("6.1.29", "6.1.30", "6.1.31"):
        rule = get_nts_rule(rule_id, NORM)
        line = next(m for m in rule.render.marks if m.kind is RenderKind.LINE)
        bands.add(line.params["at"])
    assert bands == {"apex_level"}


def test_the_bridge_connector_still_selects_its_targets_by_role(catalog):
    """F. Placement was added; the role that picks the pilares is untouched.

    CLINICAL-02 stays open: no cardinality is stated or implied.
    """
    rule = get_nts_rule("6.1.29", NORM)
    connector = next(m for m in rule.render.marks if m.kind is RenderKind.CONNECTOR)

    assert connector.role == "pilar"
    assert connector.target_selector is None
    assert rule.role("pilar").min_count is None
    assert rule.role("pilar").max_count is None


def test_the_endpoints_placement_token_is_gone(catalog):
    """G. It answered the wrong question, and nothing else ever used it."""
    assert "endpoints" not in {m.value for m in MarkPlacement}
    raw = (CATALOG_DIR / f"{NORM}.json").read_text(encoding="utf-8")
    assert '"endpoints"' not in raw

    for rule in catalog.rules:
        for mark in rule.render.marks:
            assert mark.params.get("at") != "endpoints", rule.rule_id


def test_only_the_span_rule_selects_a_subset_of_its_targets(catalog):
    with_selector = {
        rule.rule_id: mark.target_selector.value
        for rule in catalog.rules
        for mark in rule.render.marks
        if mark.target_selector is not None
    }
    assert with_selector == {"6.1.1": "range_endpoints"}


def test_placement_never_has_to_be_inferred_from_geometry_constraints(catalog):
    """6.1.8 is the standing proof that constraints cannot place a mark.

    One rule, two marks, two areas: a line on the root and a square on the
    crown. Whichever area a renderer picked from `constraints` would be wrong
    for one of them, so every mark that needs a position states its own.
    """
    espigo = get_nts_rule("6.1.8", NORM)
    assert {c.value for c in espigo.geometry_input.constraints} == {"root_area", "crown_area"}
    assert len(espigo.render.marks) == 2

    for rule in catalog.rules:
        freehand = rule.geometry_input.mode is GeometryMode.CLINICIAN_DEFINED_SHAPE
        for mark in rule.render.marks:
            if mark.kind is RenderKind.CONNECTOR:
                assert "at" in mark.params, rule.rule_id
            if mark.kind is RenderKind.LINE and not freehand:
                assert "at" in mark.params, rule.rule_id


def test_validator_rejects_a_connector_without_a_placement(catalog):
    rule = get_nts_rule("6.1.29", NORM)
    connector = next(m for m in rule.render.marks if m.kind is RenderKind.CONNECTOR)
    stripped = connector.model_copy(update={"params": {"style": "vertical_marks"}})
    marks = tuple(stripped if m is connector else m for m in rule.render.marks)
    broken = rule.model_copy(update={"render": rule.render.model_copy(update={"marks": marks})})

    with pytest.raises(CatalogValidationError, match="must declare an 'at' placement"):
        validate_nts_catalog(_with(catalog, broken))


def test_validator_rejects_a_standard_line_without_a_placement(catalog):
    rule = get_nts_rule("6.1.30", NORM)
    line = rule.render.marks[0].model_copy(update={"params": {"style": "two_parallel_horizontal"}})
    broken = rule.model_copy(update={"render": rule.render.model_copy(update={"marks": (line,)})})

    with pytest.raises(CatalogValidationError, match="must declare an 'at' placement"):
        validate_nts_catalog(_with(catalog, broken))


def test_a_freehand_line_needs_no_band(catalog):
    """The clinician draws the shape, so there is no band to name."""
    for rule_id in ("6.1.10", "6.1.35"):
        rule = get_nts_rule(rule_id, NORM)
        assert rule.geometry_input.mode is GeometryMode.CLINICIAN_DEFINED_SHAPE
        line = next(m for m in rule.render.marks if m.kind is RenderKind.LINE)
        assert "at" not in line.params
    validate_nts_catalog(catalog)  # ...and that is not an error


def test_validator_rejects_range_endpoints_outside_a_range(catalog):
    """H. Endpoints need a span to be the extremes of."""
    rule = get_nts_rule("6.1.20", NORM)  # tooth-scoped
    symbol = next(m for m in rule.render.marks if m.kind is RenderKind.SYMBOL)
    patched = symbol.model_copy(update={"target_selector": TargetSelector.RANGE_ENDPOINTS})
    marks = tuple(patched if m is symbol else m for m in rule.render.marks)
    broken = rule.model_copy(update={"render": rule.render.model_copy(update={"marks": marks})})

    with pytest.raises(CatalogValidationError, match="needs a range to have endpoints of"):
        validate_nts_catalog(_with(catalog, broken))


def test_validator_rejects_a_selector_on_a_mark_drawn_as_one_extent(catalog):
    rule = get_nts_rule("6.1.29", NORM)
    line = next(m for m in rule.render.marks if m.kind is RenderKind.LINE)
    patched = line.model_copy(update={"target_selector": TargetSelector.RANGE_ENDPOINTS})
    marks = tuple(patched if m is line else m for m in rule.render.marks)
    broken = rule.model_copy(update={"render": rule.render.model_copy(update={"marks": marks})})

    with pytest.raises(CatalogValidationError, match="meaningless on a mark drawn as one"):
        validate_nts_catalog(_with(catalog, broken))


def test_an_unknown_target_selector_is_refused_by_the_schema():
    """I. Pydantic closes the vocabulary before the validator ever runs."""
    from app.modules.odontogram.nts.catalog.schema import RenderMark

    # `params` is passed explicitly: the field's default is a shared read-only
    # mapping, and letting pydantic deep-copy it raises before validation runs.
    with pytest.raises(ValidationError):
        RenderMark(kind=RenderKind.SYMBOL, params={}, target_selector="both_ends")

    # ...and the one declared member is accepted.
    assert (
        RenderMark(
            kind=RenderKind.SYMBOL, params={}, target_selector="range_endpoints"
        ).target_selector
        is TargetSelector.RANGE_ENDPOINTS
    )


def test_target_selector_serialises_flat_for_the_api(catalog):
    dumped = catalog.model_dump(mode="json")
    rule = next(r for r in dumped["rules"] if r["rule_id"] == "6.1.1")
    symbol = next(m for m in rule["render"]["marks"] if m["kind"] == "symbol")

    assert symbol["target_selector"] == "range_endpoints"
    assert symbol["params"]["at"] == "apex_level"
    # Every other mark carries the field as null rather than omitting it.
    for r in dumped["rules"]:
        for mark in r["render"]["marks"]:
            assert "target_selector" in mark


# --- 14. NTS-05D.4a: an area mark declares where its area comes from -------
#
# `box_siglas` says which attribute supplies its text. `shape_fill` and
# `outline` said nothing about which attribute supplies their regions, so a
# renderer would have had to go looking for an attribute called "surfaces" --
# or for the rule's only `enum_multi`. Both happen to work on this norm and
# neither is a contract, which is the same gap C3 closed for text.
#
# What a surface code *means* on a drawn crown is explicitly NOT settled here.
# The norm draws "la forma que se observa" (p.11, p.17) and defines no
# correspondence between M/D/O/V/L and parts of the figure.


def _marks_of(rule, kind):
    return [m for m in rule.render.marks if m.kind is kind]


@pytest.mark.parametrize("rule_id", ["6.1.16", "6.1.33", "6.1.36"])
def test_surface_fills_declare_their_region_source(rule_id):
    """A/B/D. The three rules the norm paints over recorded surfaces."""
    rule = get_nts_rule(rule_id, NORM)
    fill = _marks_of(rule, RenderKind.SHAPE_FILL)[0]

    assert fill.regions_from == "surfaces"
    assert "at" not in fill.params

    source = next(a for a in rule.attributes if a.name == fill.regions_from)
    assert source.kind is AttributeKind.ENUM_MULTI
    assert {v.code for v in source.values} == {"M", "D", "O", "V", "L"}


def test_the_outline_rule_declares_its_region_source():
    """C. 6.1.34 contours "las superficies comprometidas", not the crown."""
    rule = get_nts_rule("6.1.34", NORM)
    outline = _marks_of(rule, RenderKind.OUTLINE)[0]

    assert outline.regions_from == "surfaces"
    assert "at" not in outline.params
    assert outline.params["style"] == "contour"


def test_a_fill_anchored_to_a_landmark_carries_no_region_source():
    """E. `shape_fill` does not imply surfaces.

    6.1.27 paints the coronal pulp — a landmark the norm names, on a
    tooth-scoped rule with no surfaces attribute at all. It is the standing
    proof that the two geometry sources are alternatives.
    """
    rule = get_nts_rule("6.1.27", NORM)
    fill = _marks_of(rule, RenderKind.SHAPE_FILL)[0]

    assert fill.regions_from is None
    assert fill.params["at"] == "coronal_pulp"
    assert rule.scope is Scope.TOOTH
    assert not any(a.name == "surfaces" for a in rule.attributes)


def test_every_area_mark_has_exactly_one_geometry_source(catalog):
    """The invariant, over the whole catalog rather than the five known marks."""
    area_kinds = {RenderKind.SHAPE_FILL, RenderKind.OUTLINE}
    seen = 0

    for rule in catalog.rules:
        for mark in rule.render.marks:
            if mark.kind not in area_kinds:
                # Nothing else may carry one.
                assert mark.regions_from is None, f"{rule.rule_id}.{mark.kind.value}"
                continue
            seen += 1
            assert ("at" in mark.params) != (mark.regions_from is not None), rule.rule_id

    assert seen == 5


def test_no_consumer_has_to_look_up_the_attribute_by_name(catalog):
    """The binding resolves; nothing needs to know the word "surfaces".

    The attribute happens to be called that in every case today, and a renderer
    that hardcoded it would be right by accident — until a norm named it
    otherwise.
    """
    for rule in catalog.rules:
        for mark in rule.render.marks:
            if mark.regions_from is None:
                continue
            attribute = next((a for a in rule.attributes if a.name == mark.regions_from), None)
            assert attribute is not None, rule.rule_id
            assert attribute.kind is AttributeKind.ENUM_MULTI


# --- the validator refuses every way of getting it wrong -------------------


def _swap(rule, old, new):
    marks = tuple(new if m is old else m for m in rule.render.marks)
    return rule.model_copy(update={"render": rule.render.model_copy(update={"marks": marks})})


def test_validator_rejects_a_region_source_that_does_not_exist(catalog):
    """F."""
    rule = get_nts_rule("6.1.16", NORM)
    fill = _marks_of(rule, RenderKind.SHAPE_FILL)[0]
    broken = _swap(rule, fill, fill.model_copy(update={"regions_from": "faces"}))

    with pytest.raises(CatalogValidationError, match="is not an attribute of"):
        validate_nts_catalog(_with(catalog, broken))


def test_validator_rejects_a_region_source_that_is_not_multi_valued(catalog):
    """G. A finding covers however many regions were recorded."""
    rule = get_nts_rule("6.1.16", NORM)
    fill = _marks_of(rule, RenderKind.SHAPE_FILL)[0]
    broken = _swap(rule, fill, fill.model_copy(update={"regions_from": "caries_type"}))

    with pytest.raises(CatalogValidationError, match="regions are a set"):
        validate_nts_catalog(_with(catalog, broken))


@pytest.mark.parametrize(
    ("rule_id", "kind"),
    [("6.1.16", RenderKind.SHAPE_FILL), ("6.1.34", RenderKind.OUTLINE)],
)
def test_validator_rejects_an_area_mark_with_no_geometry_source(catalog, rule_id, kind):
    """H/J. With neither, a renderer has nothing to draw against."""
    rule = get_nts_rule(rule_id, NORM)
    mark = _marks_of(rule, kind)[0]
    broken = _swap(rule, mark, mark.model_copy(update={"regions_from": None}))

    with pytest.raises(CatalogValidationError, match="exactly one source"):
        validate_nts_catalog(_with(catalog, broken))


@pytest.mark.parametrize(
    ("rule_id", "kind"),
    [("6.1.16", RenderKind.SHAPE_FILL), ("6.1.34", RenderKind.OUTLINE)],
)
def test_validator_rejects_an_area_mark_with_two_geometry_sources(catalog, rule_id, kind):
    """I/K. With both, a renderer has to choose — and choosing is guessing."""
    rule = get_nts_rule(rule_id, NORM)
    mark = _marks_of(rule, kind)[0]
    params = dict(mark.params) | {"at": "coronal_pulp"}
    broken = _swap(rule, mark, mark.model_copy(update={"params": params}))

    with pytest.raises(CatalogValidationError, match="exactly one source"):
        validate_nts_catalog(_with(catalog, broken))


def test_validator_rejects_a_region_source_on_a_mark_that_covers_no_area(catalog):
    """L. A sigla, a line and an arrow have no area to fill."""
    rule = get_nts_rule("6.1.16", NORM)
    box = _marks_of(rule, RenderKind.BOX_SIGLAS)[0]
    broken = _swap(rule, box, box.model_copy(update={"regions_from": "surfaces"}))

    with pytest.raises(CatalogValidationError, match="only meaningful on a mark that covers"):
        validate_nts_catalog(_with(catalog, broken))


def test_region_source_serialises_flat_for_the_api(catalog):
    dumped = catalog.model_dump(mode="json")
    rule = next(r for r in dumped["rules"] if r["rule_id"] == "6.1.34")
    outline = rule["render"]["marks"][0]

    assert outline["regions_from"] == "surfaces"
    # Present on every mark, null where it does not apply.
    for r in dumped["rules"]:
        for mark in r["render"]["marks"]:
            assert "regions_from" in mark


def test_the_catalog_still_says_nothing_about_what_a_surface_looks_like():
    """G5 is a product decision, and the catalog does not absorb it.

    No region id, no side, no geometric word. The norm defines none of it: it
    names the surfaces and says the mark is drawn "según la forma que se
    observa", and stops there.

    A dentist has since settled the orientation of V/L and how an anterior's
    occlusal surface should read, and 05D.4b implemented both — in the
    frontend's surface policy module, as **clinically validated product
    policy**. That is exactly why this test still has to hold: a decision
    DenPlant made must not end up living somewhere that makes it look
    normative.
    """
    raw = (CATALOG_DIR / f"{NORM}.json").read_text(encoding="utf-8")
    for geometric in ("outer-top", "outer-right", "outer-bottom", "outer-left", "center-"):
        assert geometric not in raw
