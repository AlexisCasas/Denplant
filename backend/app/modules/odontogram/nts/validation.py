"""Catalog-driven validation of NTS findings.

Every rule enforced here is *derived* from
:func:`~app.modules.odontogram.nts.catalog.get_nts_rule`. There is
deliberately not a single ``if rule_id == ...`` branch, no manual table of
rule identifiers, and no reading of a rule's ``notes``: notes explain a
modelling decision, they are never executable.

The functions return a list of problems rather than raising, so a caller
reports every error at once instead of one per round-trip.
"""

from __future__ import annotations

from collections import Counter
from collections.abc import Iterable, Mapping, Sequence
from typing import Any

from app.modules.odontogram.nts.catalog import NtsRule
from app.modules.odontogram.nts.catalog.schema import (
    AnchorKind,
    AttributeDef,
    AttributeKind,
    RoleAppliesTo,
    Scope,
    SpecificationRequirement,
    TargetIdentity,
)
from app.modules.odontogram.nts.constants import TargetKind, TargetParticipation

#: Which kind of target an anchor of a given kind must be. An interproximal
#: anchor sits between two teeth, so it is a numbered tooth. This maps a
#: catalog vocabulary onto a persistence vocabulary; it is not a rule table.
_ANCHOR_TARGET_KIND: dict[AnchorKind, TargetKind] = {
    AnchorKind.INTERPROXIMAL: TargetKind.FDI_TOOTH,
}

#: The subject's target kind implied by the rule's ``target_identity``.
_IDENTITY_TARGET_KIND: dict[TargetIdentity, TargetKind] = {
    TargetIdentity.NUMBERED: TargetKind.FDI_TOOTH,
    TargetIdentity.UNNUMBERED: TargetKind.UNNUMBERED_TOOTH,
}


# --------------------------------------------------------------------------
# attributes
# --------------------------------------------------------------------------


def validate_attributes(rule: NtsRule, attributes: Mapping[str, Any]) -> list[str]:
    """Check a finding's ``attributes`` against the rule that defines them."""
    errors: list[str] = []
    if not isinstance(attributes, Mapping):
        return [f"{rule.rule_id}: attributes must be an object"]

    declared = {a.name: a for a in rule.attributes}

    for name in attributes:
        if name not in declared:
            errors.append(
                f"{rule.rule_id}: unknown attribute {name!r}; "
                f"rule declares {sorted(declared) or 'none'}"
            )

    for name, definition in declared.items():
        if name not in attributes:
            if definition.required:
                errors.append(f"{rule.rule_id}: attribute {name!r} is required")
            continue
        errors.extend(_check_value(rule, definition, attributes[name]))

    return errors


def _check_value(rule: NtsRule, definition: AttributeDef, value: Any) -> list[str]:
    where = f"{rule.rule_id}.{definition.name}"
    allowed = {v.code for v in definition.values}

    if definition.kind in (AttributeKind.ENUM, AttributeKind.FIXED):
        if not isinstance(value, str):
            return [f"{where}: expected one code, got {type(value).__name__}"]
        if value not in allowed:
            return [f"{where}: {value!r} is not one of {sorted(allowed)}"]
        return []

    if definition.kind is AttributeKind.ENUM_MULTI:
        if isinstance(value, str) or not isinstance(value, (list, tuple)):
            return [f"{where}: expected a list of codes"]
        errors = [
            f"{where}: {item!r} is not one of {sorted(allowed)}"
            for item in value
            if not isinstance(item, str) or item not in allowed
        ]
        duplicates = [c for c, n in Counter(value).items() if n > 1]
        if duplicates:
            errors.append(f"{where}: repeated codes {sorted(duplicates)}")
        return errors

    if definition.kind is AttributeKind.INTEGER:
        # bool is an int subclass; a boolean is not a measurement.
        if isinstance(value, bool) or not isinstance(value, int):
            return [f"{where}: expected an integer, got {type(value).__name__}"]
        return []

    if definition.kind is AttributeKind.FREE_TEXT:
        if not isinstance(value, str):
            return [f"{where}: expected text, got {type(value).__name__}"]
        if not value.strip():
            return [f"{where}: text must not be blank"]
        return []

    return [f"{where}: unsupported attribute kind {definition.kind.value!r}"]


# --------------------------------------------------------------------------
# targets
# --------------------------------------------------------------------------


def validate_targets(rule: NtsRule, targets: Sequence[Any]) -> list[str]:
    """Check a finding's targets against the rule's scope and role metadata.

    ``targets`` may be ORM rows or any object exposing the same attribute
    names.
    """
    errors: list[str] = []
    if not targets:
        return [f"{rule.rule_id}: a finding needs at least one target"]

    for index, target in enumerate(targets):
        errors.extend(_check_target_shape(rule, index, target))

    slots = Counter((_int(t.group_index), _int(t.position)) for t in targets)
    for slot, count in slots.items():
        if count > 1:
            errors.append(f"{rule.rule_id}: {count} targets share group_index/position {slot}")

    subjects = [t for t in targets if t.participation == TargetParticipation.SUBJECT]
    anchors = [t for t in targets if t.participation == TargetParticipation.ANCHOR]

    errors.extend(_check_anchors(rule, anchors))
    errors.extend(_check_subjects(rule, subjects))
    errors.extend(validate_roles(rule, targets))
    return errors


def _check_target_shape(rule: NtsRule, index: int, target: Any) -> list[str]:
    where = f"{rule.rule_id}.target[{index}]"
    errors: list[str] = []

    if target.participation not in set(TargetParticipation):
        errors.append(f"{where}: unknown participation {target.participation!r}")
    if target.target_kind not in set(TargetKind):
        errors.append(f"{where}: unknown target_kind {target.target_kind!r}")

    # The column is reserved but no coordinate contract exists yet, so a
    # shape is refused here with a readable message rather than by the DB
    # CHECK at flush time.
    if getattr(target, "geometry", None) is not None:
        errors.append(
            f"{where}: geometry cannot be stored yet (GEOMETRY CONTRACT PENDING); "
            "canonicalization version 1 defines no geometry"
        )
    return errors


def _check_anchors(rule: NtsRule, anchors: Sequence[Any]) -> list[str]:
    if rule.anchor is None:
        if anchors:
            return [
                f"{rule.rule_id}: declares no anchor, but {len(anchors)} anchor "
                "target(s) were supplied"
            ]
        return []

    errors: list[str] = []
    if len(anchors) != rule.anchor.cardinality:
        errors.append(
            f"{rule.rule_id}: expects exactly {rule.anchor.cardinality} anchor "
            f"target(s), got {len(anchors)}"
        )
    expected = _ANCHOR_TARGET_KIND.get(rule.anchor.kind)
    if expected is not None:
        wrong = [a.target_kind for a in anchors if a.target_kind != expected]
        if wrong:
            errors.append(
                f"{rule.rule_id}: {rule.anchor.kind.value} anchors must be "
                f"{expected.value}, got {sorted(set(wrong))}"
            )
    teeth = [a.tooth_number for a in anchors if a.tooth_number is not None]
    if len(set(teeth)) != len(teeth):
        errors.append(f"{rule.rule_id}: anchors must reference distinct teeth")
    return errors


def _check_subjects(rule: NtsRule, subjects: Sequence[Any]) -> list[str]:
    errors: list[str] = []
    if not subjects:
        return [f"{rule.rule_id}: a finding needs at least one subject target"]

    scope = rule.scope

    if scope in (Scope.TOOTH, Scope.SURFACE):
        if len(subjects) != 1:
            errors.append(
                f"{rule.rule_id}: {scope.value}-scoped rules take exactly one "
                f"subject, got {len(subjects)}"
            )
        expected = _IDENTITY_TARGET_KIND[rule.target_identity]
        # A surface finding is always about a numbered tooth; a tooth finding
        # follows the rule's own target_identity.
        if scope is Scope.SURFACE:
            expected = TargetKind.FDI_TOOTH
        errors.extend(_expect_kind(rule, subjects, expected))

    elif scope is Scope.PAIR:
        if len(subjects) != 2:
            errors.append(
                f"{rule.rule_id}: pair-scoped rules take exactly two subjects, got {len(subjects)}"
            )
        errors.extend(_expect_kind(rule, subjects, TargetKind.FDI_TOOTH))
        teeth = [s.tooth_number for s in subjects]
        if len(set(teeth)) != len(teeth):
            errors.append(f"{rule.rule_id}: a pair must name two distinct teeth")

    elif scope is Scope.RANGE:
        errors.extend(_expect_kind(rule, subjects, TargetKind.FDI_TOOTH))
        groups = {_int(s.group_index) for s in subjects}
        # `single_segment` means one continuous stretch; `multi_segment`
        # allows several. No minimum span length is stated by the norm, so
        # none is invented here.
        if rule.range_grouping is not None and rule.range_grouping.value == ("single_segment"):
            if len(groups) != 1:
                errors.append(
                    f"{rule.rule_id}: single_segment rules use one group_index, "
                    f"got {sorted(groups)}"
                )
        teeth = [s.tooth_number for s in subjects]
        if len(set(teeth)) != len(teeth):
            errors.append(f"{rule.rule_id}: a range repeats a tooth")

    elif scope is Scope.ARCH:
        errors.extend(_expect_kind(rule, subjects, TargetKind.ARCH))
        arches = [s.arch for s in subjects]
        if len(set(arches)) != len(arches):
            errors.append(f"{rule.rule_id}: the same arch is named twice")
        cardinality = rule.arch_cardinality.value if rule.arch_cardinality else None
        if cardinality == "one" and len(subjects) != 1:
            errors.append(f"{rule.rule_id}: this rule covers exactly one arch, got {len(subjects)}")
        if cardinality == "one_or_both" and len(subjects) not in (1, 2):
            errors.append(
                f"{rule.rule_id}: this rule covers one or both arches, got {len(subjects)}"
            )

    return errors


def _expect_kind(rule: NtsRule, targets: Sequence[Any], expected: TargetKind) -> list[str]:
    wrong = sorted({t.target_kind for t in targets if t.target_kind != expected})
    if wrong:
        return [
            f"{rule.rule_id}: subjects of a {rule.scope.value}-scoped rule must be "
            f"{expected.value}, got {wrong}"
        ]
    return []


# --------------------------------------------------------------------------
# roles
# --------------------------------------------------------------------------


def validate_roles(rule: NtsRule, targets: Sequence[Any]) -> list[str]:
    """Check target roles against ``rule.target_roles``.

    A cardinality is enforced only when the norm states one. ``min_count``
    and ``max_count`` of ``None`` mean the norm is silent, and silence is
    never turned into a constraint — so a rule whose only role has no
    bounds (``pilar`` today) never makes a role mandatory.
    """
    errors: list[str] = []

    for index, target in enumerate(targets):
        role = getattr(target, "role", None)
        if role is None:
            continue
        definition = rule.role(role)
        if definition is None:
            allowed = sorted(r.code for r in rule.target_roles)
            errors.append(
                f"{rule.rule_id}.target[{index}]: role {role!r} is not declared by "
                f"this rule (allowed: {allowed or 'none'})"
            )
            continue
        expected = (
            TargetParticipation.SUBJECT
            if definition.applies_to is RoleAppliesTo.SUBJECT
            else TargetParticipation.ANCHOR
        )
        if target.participation != expected:
            errors.append(
                f"{rule.rule_id}.target[{index}]: role {role!r} applies to "
                f"{expected.value} targets, not {target.participation!r}"
            )

    counts = Counter(getattr(t, "role", None) for t in targets if getattr(t, "role", None))
    for definition in rule.target_roles:
        used = counts.get(definition.code, 0)
        if definition.min_count is not None and used < definition.min_count:
            errors.append(
                f"{rule.rule_id}: role {definition.code!r} needs at least "
                f"{definition.min_count} target(s), got {used}"
            )
        if definition.max_count is not None and used > definition.max_count:
            errors.append(
                f"{rule.rule_id}: role {definition.code!r} allows at most "
                f"{definition.max_count} target(s), got {used}"
            )

    return errors


# --------------------------------------------------------------------------
# specifications
# --------------------------------------------------------------------------


def blocking_specification_requirements(
    rule: NtsRule, attributes: Mapping[str, Any]
) -> tuple[SpecificationRequirement, ...]:
    """Active requirements that must be satisfied before finalizing.

    Only ``required=True`` blocks. A requirement flagged
    ``needs_clinical_review`` with ``required=False`` (``crown_metal_colour``
    today) means *DentalPin has no normative evidence for an automatic
    block* — not that the norm made the datum optional. It is surfaced to
    the clinician, never enforced.
    """
    return tuple(
        requirement
        for requirement in rule.active_specification_requirements(attributes)
        if requirement.required
    )


def validate_specification_requirements(
    rule: NtsRule,
    attributes: Mapping[str, Any],
    linked_texts: Iterable[str | None],
) -> list[str]:
    """Check that a finding's required Especificaciones entries exist.

    ``linked_texts`` are the texts of specifications whose ``finding_id``
    is this finding. A general specification (``finding_id`` NULL) never
    counts, and neither does blank text.

    The only verifiable fact is that a non-empty linked entry exists.
    ``nts_record_specifications`` carries no requirement code, so nothing
    can prove *which* requirement an entry answers, and the prose itself is
    never interpreted.
    """
    blocking = blocking_specification_requirements(rule, attributes)
    if not blocking:
        return []
    if any(text and text.strip() for text in linked_texts):
        return []
    return [
        f"{rule.rule_id}: requires an Especificaciones entry linked to this "
        f"finding ({requirement.code}: {requirement.label})"
        for requirement in blocking
    ]


def _int(value: Any) -> int:
    return value if isinstance(value, int) and not isinstance(value, bool) else -1
