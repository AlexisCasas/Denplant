"""Structural validation of a normative catalog.

Pydantic already rejects unknown fields and bad enum members. This module
checks the invariants Pydantic cannot express: cross-field coherence inside
a rule, and coherence across the catalog as a whole.

Deliberate non-errors
---------------------
* **The same sigla in different rules.** NTS N.° 188 reuses "S" (6.1.26
  supernumerary, 6.1.35 sealant) and "M" (6.1.19 mobility, 6.1.28
  mesialised). Identity is ``norm_version + rule_id``, never the sigla, so
  collisions across rules are the norm's own design, not a data defect.
* **``needs_clinical_review`` items.** The norm genuinely leaves them open;
  flagging them is the point. They must carry ``notes`` saying what is open.
"""

from __future__ import annotations

from collections import Counter

from app.modules.odontogram.nts.catalog.schema import (
    MARK_PARAMS,
    REQUIRED_MARK_PARAMS,
    SUPPORTED_SCOPES,
    AttributeDef,
    AttributeKind,
    ColorSemantics,
    GeometryMode,
    NtsCatalog,
    NtsRule,
    RenderKind,
    RenderMark,
    ReviewStatus,
    RoleAppliesTo,
    Scope,
)

#: Attribute that carries the good/bad state a condition-dependent colour
#: depends on (NTS §5.12-5.13).
CONDITION_STATE_ATTRIBUTE = "condition_state"
CONDITION_STATE_CODES = frozenset({"good", "bad"})

#: Attribute kinds that enumerate their admissible values.
_VALUED_KINDS = frozenset({AttributeKind.ENUM, AttributeKind.ENUM_MULTI, AttributeKind.FIXED})

#: Attribute kinds a mark may write as its text.
#:
#: The norm writes *one* sigla per finding, so the source has to resolve to a
#: single code: ``enum`` (the clinician picks one) or ``fixed`` (the rule
#: already carries it). ``enum_multi`` would resolve to several and there is no
#: normative rule for joining them.
_SIGLA_SOURCE_KINDS = frozenset({AttributeKind.ENUM, AttributeKind.FIXED})

#: Attribute kinds a mark may append as a suffix: anything that is one scalar.
_SUFFIX_SOURCE_KINDS = frozenset(
    {AttributeKind.ENUM, AttributeKind.FIXED, AttributeKind.INTEGER, AttributeKind.FREE_TEXT}
)


class CatalogValidationError(ValueError):
    """One or more catalog invariants are violated."""

    def __init__(self, errors: list[str]) -> None:
        self.errors = errors
        joined = "\n  - ".join(errors)
        super().__init__(f"{len(errors)} catalog error(s):\n  - {joined}")


def validate_nts_catalog(catalog: NtsCatalog) -> None:
    """Raise :class:`CatalogValidationError` unless every invariant holds."""
    errors: list[str] = []

    _check_rule_count(catalog, errors)
    _check_identifiers_unique(catalog, errors)
    _check_ordinals(catalog, errors)
    _check_related_rules(catalog, errors)

    for rule in catalog.rules:
        _check_scope(rule, errors)
        _check_scope_modifiers(rule, errors)
        _check_attributes(rule, errors)
        _check_siglas_unique_within_rule(rule, errors)
        _check_render(rule, errors)
        _check_mark_vocabulary(rule, errors)
        _check_mark_bindings(rule, errors)
        _check_condition_state(rule, errors)
        _check_geometry(rule, errors)
        _check_target_roles(rule, errors)
        _check_specification_requirements(rule, errors)
        _check_review_status(rule, errors)
        _check_source(rule, errors)

    if errors:
        raise CatalogValidationError(errors)


# --- catalog-wide ---------------------------------------------------------


def _check_rule_count(catalog: NtsCatalog, errors: list[str]) -> None:
    """1. The catalog holds exactly as many rules as the norm declares."""
    if len(catalog.rules) != catalog.expected_rule_count:
        errors.append(
            f"expected_rule_count is {catalog.expected_rule_count} but the "
            f"catalog holds {len(catalog.rules)} rules"
        )


def _check_identifiers_unique(catalog: NtsCatalog, errors: list[str]) -> None:
    """2. ``rule_id`` identifies a rule and ``key`` a global rule: both unique."""
    for rule_id, count in Counter(r.rule_id for r in catalog.rules).items():
        if count > 1:
            errors.append(f"rule_id {rule_id!r} appears {count} times")
    for key, count in Counter(g.key for g in catalog.global_rules).items():
        if count > 1:
            errors.append(f"global rule key {key!r} appears {count} times")


def _check_ordinals(catalog: NtsCatalog, errors: list[str]) -> None:
    """3. Ordinals are a contiguous 1..N presentation order."""
    ordinals = sorted(r.ordinal for r in catalog.rules)
    if ordinals != list(range(1, len(catalog.rules) + 1)):
        errors.append(f"ordinals are not a contiguous 1..{len(catalog.rules)} sequence: {ordinals}")


def _check_related_rules(catalog: NtsCatalog, errors: list[str]) -> None:
    """4. Cross-references resolve, and no rule relates to itself."""
    known = {r.rule_id for r in catalog.rules}
    for rule in catalog.rules:
        for related in rule.related_rules:
            if related.rule_id == rule.rule_id:
                errors.append(f"{rule.rule_id}: related_rules references itself")
            elif related.rule_id not in known:
                errors.append(
                    f"{rule.rule_id}: related_rules references unknown rule {related.rule_id!r}"
                )


# --- per rule -------------------------------------------------------------


def _check_scope(rule: NtsRule, errors: list[str]) -> None:
    """5. Scope is one the platform declares support for."""
    if rule.scope.value not in SUPPORTED_SCOPES:
        errors.append(f"{rule.rule_id}: unsupported scope {rule.scope.value!r}")


def _check_scope_modifiers(rule: NtsRule, errors: list[str]) -> None:
    """6. Scope modifiers belong to their scope, and nowhere else.

    ``arch_cardinality`` only makes sense for an arch, ``range_grouping``
    only for a range, and an ``anchor`` only where the clinical subject has
    no FDI cell of its own (6.1.26).
    """
    if (rule.scope is Scope.ARCH) != (rule.arch_cardinality is not None):
        errors.append(
            f"{rule.rule_id}: arch_cardinality must be set exactly for arch-scoped "
            f"rules (scope={rule.scope.value}, "
            f"arch_cardinality={rule.arch_cardinality})"
        )
    if (rule.scope is Scope.RANGE) != (rule.range_grouping is not None):
        errors.append(
            f"{rule.rule_id}: range_grouping must be set exactly for range-scoped "
            f"rules (scope={rule.scope.value}, range_grouping={rule.range_grouping})"
        )
    if (rule.target_identity.value == "unnumbered") != (rule.anchor is not None):
        errors.append(
            f"{rule.rule_id}: an anchor is required exactly when target_identity is "
            f"'unnumbered' (target_identity={rule.target_identity.value}, "
            f"anchor={'set' if rule.anchor else 'unset'})"
        )


def _check_attributes(rule: NtsRule, errors: list[str]) -> None:
    """7. Attribute shape matches its kind, and at most one is the sigla."""
    names = Counter(a.name for a in rule.attributes)
    for name, count in names.items():
        if count > 1:
            errors.append(f"{rule.rule_id}: attribute {name!r} declared {count} times")

    sigla_attrs = [a for a in rule.attributes if a.is_sigla]
    if len(sigla_attrs) > 1:
        errors.append(
            f"{rule.rule_id}: {len(sigla_attrs)} attributes marked is_sigla "
            f"({', '.join(a.name for a in sigla_attrs)}); the box holds one"
        )

    for attr in rule.attributes:
        _check_attribute_values(rule, attr, errors)


def _check_attribute_values(rule: NtsRule, attr: AttributeDef, errors: list[str]) -> None:
    where = f"{rule.rule_id}.{attr.name}"
    if attr.kind in _VALUED_KINDS and not attr.values:
        errors.append(f"{where}: kind {attr.kind.value!r} requires values")
    if attr.kind not in _VALUED_KINDS and attr.values:
        errors.append(f"{where}: kind {attr.kind.value!r} must not enumerate values")
    if attr.kind is AttributeKind.FIXED and len(attr.values) != 1:
        errors.append(f"{where}: kind 'fixed' takes exactly one value, got {len(attr.values)}")


def _check_siglas_unique_within_rule(rule: NtsRule, errors: list[str]) -> None:
    """8. Sigla codes are unique *within* a rule (never across rules).

    Cross-rule reuse is normative; see the module docstring.
    """
    for attr in rule.attributes:
        codes = Counter(v.code for v in attr.values)
        for code, count in codes.items():
            if count > 1:
                errors.append(f"{rule.rule_id}.{attr.name}: code {code!r} appears {count} times")


def _check_render(rule: NtsRule, errors: list[str]) -> None:
    """9. A box_siglas mark needs an is_sigla attribute to put in the box."""
    has_box = any(m.kind is RenderKind.BOX_SIGLAS for m in rule.render.marks)
    has_sigla = any(a.is_sigla for a in rule.attributes)
    if has_box and not has_sigla:
        errors.append(
            f"{rule.rule_id}: renders a box_siglas mark but declares no is_sigla attribute"
        )


def _check_mark_vocabulary(rule: NtsRule, errors: list[str]) -> None:
    """16. Every mark param is declared for its kind, with a declared value.

    :data:`MARK_PARAMS` is the whole vocabulary. A key that is not listed for
    a kind, or a value outside that key's enum, means a renderer would have to
    guess — and the thing being guessed at is what a clinician sees on a legal
    record. Required params (:data:`REQUIRED_MARK_PARAMS`) are checked here
    too, for the same reason.

    Structural by construction: nothing below reads a ``rule_id``. Retiring a
    token is therefore enough to make the old spelling a hard error, which is
    how the ``apex_height``/``vertical``/``square_enclosing_crown`` synonyms
    stay retired.
    """
    for index, mark in enumerate(rule.render.marks):
        where = f"{rule.rule_id}.render.marks[{index}]({mark.kind.value})"
        allowed = MARK_PARAMS[mark.kind]

        for key in REQUIRED_MARK_PARAMS.get(mark.kind, frozenset()):
            if key not in mark.params:
                errors.append(f"{where}: param {key!r} is required for this mark kind")

        for key, value in mark.params.items():
            vocabulary = allowed.get(key)
            if vocabulary is None:
                errors.append(
                    f"{where}: param {key!r} is not declared for this mark kind "
                    f"(declared: {sorted(allowed) or 'none'})"
                )
                continue
            if value not in {member.value for member in vocabulary}:
                errors.append(
                    f"{where}: param {key}={value!r} is not in the declared vocabulary "
                    f"({sorted(member.value for member in vocabulary)})"
                )


def _check_mark_bindings(rule: NtsRule, errors: list[str]) -> None:
    """17. Every mark says where its text and its targets come from.

    Four invariants, none of which may be satisfied by inference:

    * a ``box_siglas`` mark declares ``text_from`` — the box is not the only
      place a sigla can land (§6.1.26 puts one inside a circle), so "the rule's
      one ``is_sigla`` attribute" is not a safe answer;
    * ``text_from`` / ``suffix_from`` resolve to an attribute of *this* rule,
      of a kind that yields the one value the mark writes;
    * ``role`` resolves in ``target_roles``;
    * no ``is_sigla`` attribute is left unread, which catches the same class of
      omission from the other side.
    """
    attributes = {a.name: a for a in rule.attributes}
    role_codes = {r.code: r for r in rule.target_roles}
    read_as_text: set[str] = set()

    for index, mark in enumerate(rule.render.marks):
        where = f"{rule.rule_id}.render.marks[{index}]({mark.kind.value})"

        if mark.kind is RenderKind.BOX_SIGLAS and mark.text_from is None:
            errors.append(f"{where}: box_siglas must declare text_from")

        if mark.text_from is not None:
            read_as_text.add(mark.text_from)
            _check_text_source(where, mark, attributes, errors)

        if mark.suffix_from is not None:
            _check_suffix_source(where, mark, attributes, errors)

        if mark.role is not None:
            role = role_codes.get(mark.role)
            if role is None:
                errors.append(
                    f"{where}: role {mark.role!r} is not declared in target_roles "
                    f"({sorted(role_codes) or 'none declared'})"
                )
            elif role.applies_to is RoleAppliesTo.ANCHOR and rule.anchor is None:
                errors.append(
                    f"{where}: role {mark.role!r} applies to anchors but the rule declares none"
                )

    for attribute in rule.attributes:
        if attribute.is_sigla and attribute.name not in read_as_text:
            errors.append(
                f"{rule.rule_id}.{attribute.name}: marked is_sigla but no mark reads it "
                "via text_from, so the sigla would never be drawn"
            )


def _check_text_source(
    where: str, mark: RenderMark, attributes: dict[str, AttributeDef], errors: list[str]
) -> None:
    attribute = attributes.get(mark.text_from or "")
    if attribute is None:
        errors.append(
            f"{where}: text_from {mark.text_from!r} is not an attribute of this rule "
            f"({sorted(attributes) or 'none declared'})"
        )
        return
    if not attribute.is_sigla:
        errors.append(f"{where}: text_from {mark.text_from!r} is not the rule's sigla attribute")
    if attribute.kind not in _SIGLA_SOURCE_KINDS:
        errors.append(
            f"{where}: text_from {mark.text_from!r} is kind {attribute.kind.value!r}, "
            f"which does not resolve to a single sigla "
            f"({sorted(k.value for k in _SIGLA_SOURCE_KINDS)})"
        )


def _check_suffix_source(
    where: str, mark: RenderMark, attributes: dict[str, AttributeDef], errors: list[str]
) -> None:
    attribute = attributes.get(mark.suffix_from or "")
    if attribute is None:
        errors.append(
            f"{where}: suffix_from {mark.suffix_from!r} is not an attribute of this rule "
            f"({sorted(attributes) or 'none declared'})"
        )
        return
    if mark.suffix_from == mark.text_from:
        errors.append(
            f"{where}: suffix_from and text_from both read {mark.suffix_from!r}; "
            "a suffix is a second datum, not the first one written twice"
        )
    if attribute.kind not in _SUFFIX_SOURCE_KINDS:
        errors.append(
            f"{where}: suffix_from {mark.suffix_from!r} is kind {attribute.kind.value!r}, "
            f"which is not a single appendable value "
            f"({sorted(k.value for k in _SUFFIX_SOURCE_KINDS)})"
        )


def _check_condition_state(rule: NtsRule, errors: list[str]) -> None:
    """10. ``condition_dependent`` colour requires a good/bad attribute.

    And conversely: a rule that is always red or always blue must not
    pretend to carry a state the norm does not let the clinician choose.
    """
    attr = next((a for a in rule.attributes if a.name == CONDITION_STATE_ATTRIBUTE), None)
    is_conditional = rule.render.color_semantics is ColorSemantics.CONDITION_DEPENDENT

    if is_conditional and attr is None:
        errors.append(
            f"{rule.rule_id}: color_semantics is 'condition_dependent' but no "
            f"{CONDITION_STATE_ATTRIBUTE!r} attribute is declared"
        )
    elif not is_conditional and attr is not None:
        errors.append(
            f"{rule.rule_id}: declares {CONDITION_STATE_ATTRIBUTE!r} but its colour "
            f"is fixed ({rule.render.color_semantics.value})"
        )
    elif attr is not None and {v.code for v in attr.values} != CONDITION_STATE_CODES:
        errors.append(
            f"{rule.rule_id}.{CONDITION_STATE_ATTRIBUTE}: expected codes "
            f"{sorted(CONDITION_STATE_CODES)}, got "
            f"{sorted(v.code for v in attr.values)}"
        )


def _check_geometry(rule: NtsRule, errors: list[str]) -> None:
    """11. Geometry constraints only make sense where geometry is drawn."""
    if rule.geometry_input.mode is GeometryMode.NONE and rule.geometry_input.constraints:
        errors.append(
            f"{rule.rule_id}: geometry mode 'none' cannot carry constraints "
            f"({', '.join(c.value for c in rule.geometry_input.constraints)})"
        )


def _check_target_roles(rule: NtsRule, errors: list[str]) -> None:
    """14. Role definitions are well formed and unique within their rule.

    Role codes live in their own namespace: a role code that happens to
    equal a sigla is **not** an error. Siglas are written in the tooth's
    box, roles describe a target's part in the finding, and nothing reads
    one as the other.
    """
    for code, count in Counter(r.code for r in rule.target_roles).items():
        if count > 1:
            errors.append(f"{rule.rule_id}: target role {code!r} defined {count} times")

    for role in rule.target_roles:
        where = f"{rule.rule_id}.role[{role.code}]"
        if role.min_count is not None and role.max_count is not None:
            if role.max_count < role.min_count:
                errors.append(
                    f"{where}: max_count {role.max_count} is below min_count {role.min_count}"
                )
        if role.status is ReviewStatus.NEEDS_CLINICAL_REVIEW and not role.notes:
            errors.append(f"{where}: needs_clinical_review without notes")

    # A role must never also be modelled as an attribute: one source only.
    for attribute in rule.attributes:
        if attribute.name == "target_roles":
            errors.append(
                f"{rule.rule_id}: 'target_roles' is a rule field, not an attribute; "
                "modelling it twice would give a target's role two sources"
            )


def _check_specification_requirements(rule: NtsRule, errors: list[str]) -> None:
    """15. Especificaciones requirements are unambiguous for the current model.

    ``nts_record_specifications`` stores no requirement code, so a consumer
    can only observe *that* a finding-linked entry exists — not which
    requirement it satisfies. A rule that could activate two requirements
    at once would therefore be unverifiable, and is rejected.
    """
    variant_requirements = [
        (attribute.name, value.code, value.specification_requirement)
        for attribute in rule.attributes
        for value in attribute.values
        if value.specification_requirement is not None
    ]

    if rule.specification_requirement is not None and variant_requirements:
        named = ", ".join(f"{a}={c}" for a, c, _ in variant_requirements)
        errors.append(
            f"{rule.rule_id}: declares a rule-level specification requirement and "
            f"variant-level ones ({named}); the specifications table stores no "
            "requirement code, so which one an entry satisfies would be ambiguous"
        )

    # Two variants of the *same* attribute may each require a specification
    # only if they cannot both be selected, i.e. the attribute is single-valued.
    per_attribute = Counter(name for name, _, _ in variant_requirements)
    for attribute in rule.attributes:
        if attribute.kind is AttributeKind.ENUM_MULTI and per_attribute[attribute.name] > 1:
            errors.append(
                f"{rule.rule_id}.{attribute.name}: {per_attribute[attribute.name]} "
                "values carry a specification requirement on a multi-valued "
                "attribute, so two could be active at once and neither could be "
                "shown to be satisfied"
            )

    requirements = [r for _, _, r in variant_requirements]
    if rule.specification_requirement is not None:
        requirements.append(rule.specification_requirement)
    for requirement in requirements:
        where = f"{rule.rule_id}.specification[{requirement.code}]"
        if requirement.status is ReviewStatus.NEEDS_CLINICAL_REVIEW and (not requirement.notes):
            errors.append(f"{where}: needs_clinical_review without notes")


def _check_review_status(rule: NtsRule, errors: list[str]) -> None:
    """12. Anything flagged for clinical review says what is unresolved.

    The flag propagates upward: if an attribute or one of its values is
    open, the rule cannot claim to be verified.
    """
    needs_review = ReviewStatus.NEEDS_CLINICAL_REVIEW
    rule_is_open = rule.status is needs_review

    if rule_is_open and not any(_is_flagged(a) for a in rule.attributes):
        errors.append(
            f"{rule.rule_id}: marked needs_clinical_review but no attribute or value "
            "explains what is open"
        )

    for attr in rule.attributes:
        if attr.status is needs_review and not attr.notes:
            errors.append(f"{rule.rule_id}.{attr.name}: needs_clinical_review without notes")
        for value in attr.values:
            if value.status is needs_review and not value.notes:
                errors.append(
                    f"{rule.rule_id}.{attr.name}={value.code}: needs_clinical_review without notes"
                )
        if _is_flagged(attr) and not rule_is_open:
            errors.append(
                f"{rule.rule_id}: attribute {attr.name!r} needs clinical review but "
                "the rule is marked verified"
            )


def _is_flagged(attr: AttributeDef) -> bool:
    return attr.status is ReviewStatus.NEEDS_CLINICAL_REVIEW or any(
        v.status is ReviewStatus.NEEDS_CLINICAL_REVIEW for v in attr.values
    )


def _check_source(rule: NtsRule, errors: list[str]) -> None:
    """13. Every rule cites the section it came from, errata included.

    Where the PDF prints a different heading than the logical id (6.1.15 as
    "6.115", 6.1.23 as "5.2.23"), ``document_label`` must record it rather
    than the discrepancy being silently normalised away.
    """
    if not rule.source.section.startswith(rule.rule_id) and not rule.source.document_label:
        errors.append(
            f"{rule.rule_id}: source.section {rule.source.section!r} does not match "
            "the rule id and no document_label records the discrepancy"
        )
