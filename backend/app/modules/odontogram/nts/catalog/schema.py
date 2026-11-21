"""Typed schema for NTS odontogram catalogs.

The catalog describes *what a norm requires*: which findings exist, what
structured data each one carries, how it is drawn and where the geometry
comes from. It never stores drawings themselves — no SVG, no path data.

Identity
--------
A rule is identified by ``norm_version + rule_id`` (e.g.
``pe_nts_188_2022`` + ``6.1.26``), never by its sigla. NTS N.° 188 reuses
the same sigla in unrelated rules ("S" in 6.1.26 and 6.1.35; "M" in 6.1.19
and 6.1.28), so sigla uniqueness is scoped to a single rule:
``norm_version + rule_id + variant_code``.

Immutability
------------
A loaded catalog is cached and shared by every caller, so it has to be
immutable *all the way down* — ``frozen=True`` alone only blocks attribute
assignment, not mutation of a container held in a field. Every collection
here is therefore a ``tuple``, and the one mapping (:attr:`RenderMark.params`)
is a :data:`FrozenStrMap`. Without that, a single
``mark.params["shape"] = ...`` would poison the cache for the whole process.
"""

from __future__ import annotations

from collections.abc import Mapping
from enum import StrEnum
from types import MappingProxyType
from typing import Annotated, Final

from pydantic import AfterValidator, BaseModel, ConfigDict, Field, PlainSerializer


def _freeze_mapping(value: Mapping[str, str]) -> Mapping[str, str]:
    """Wrap a validated mapping so callers cannot write through it."""
    return MappingProxyType(dict(value))


#: A read-only ``str -> str`` mapping. Reads like a dict; every write raises.
#: The explicit serializer keeps ``model_dump``/``model_dump_json`` emitting a
#: plain dict, so a future read-only endpoint needs no special casing.
FrozenStrMap = Annotated[
    Mapping[str, str],
    AfterValidator(_freeze_mapping),
    PlainSerializer(dict, return_type=dict[str, str]),
]

_EMPTY_PARAMS: Final[Mapping[str, str]] = MappingProxyType({})


class Scope(StrEnum):
    """Clinical reach of a finding.

    Platform-wide vocabulary. A given norm version need not use all of it —
    NTS N.° 188 uses every member except ``MOUTH``.
    """

    TOOTH = "tooth"
    SURFACE = "surface"
    PAIR = "pair"
    RANGE = "range"
    ARCH = "arch"
    MOUTH = "mouth"


SUPPORTED_SCOPES: Final[frozenset[str]] = frozenset(s.value for s in Scope)


class RenderKind(StrEnum):
    """Finite drawing vocabulary derived from the 38 NTS rules."""

    BOX_SIGLAS = "box_siglas"
    SYMBOL = "symbol"
    ARROW = "arrow"
    LINE = "line"
    CONNECTOR = "connector"
    SHAPE_FILL = "shape_fill"
    OUTLINE = "outline"


# --- mark vocabulary -------------------------------------------------------
#
# Every token a mark may carry is enumerated below, so a renderer can switch
# exhaustively over a closed set instead of matching strings it hopes exist.
# The members are the ones the 38 rules actually use: this is a description of
# NTS N.° 188, not a general drawing language, and a token nothing uses would
# be a promise the norm never made.


class MarkPlacement(StrEnum):
    """**Where** a mark sits, as the norm words it (``at``).

    These name *anatomical or chart landmarks*, never coordinates. Turning one
    into a position is the renderer's job and needs the chart geometry, which
    the catalog deliberately knows nothing about.

    Strictly a location. *Which* targets a mark applies to is a different
    question with its own field — see :class:`TargetSelector` and
    :attr:`RenderMark.role`. ``endpoints`` used to live here and answered the
    second question while pretending to answer the first, which left §6.1.1's
    symbol with no stated height at all.
    """

    #: Between the apices of the two adjacent teeth (§6.1.26).
    BETWEEN_APICES = "between_apices"
    #: Between two crowns (§6.1.6).
    BETWEEN_TEETH = "between_teeth"
    CROWN = "crown"
    NEAR_ROOTS = "near_roots"
    TOOTH_NUMBER = "tooth_number"
    TOOTH_NUMBERS = "tooth_numbers"
    #: The occlusal/incisal edge of the crown (§6.1.13).
    OCCLUSAL_ZONE = "occlusal_zone"
    #: Drawn over the tooth figure itself (§6.1.23 "sobre la gráfica").
    ON_FIGURE = "on_figure"
    #: Outside the figure, on the occlusal/incisal side (§6.1.24, §6.1.25
    #: "fuera del gráfico"). The screen direction follows from
    #: :class:`ArrowDirection` plus the tooth's arch, never from this token.
    OUTSIDE_OCCLUSAL = "outside_occlusal"
    #: At the level of the root apices (§6.1.2, §6.1.30, §6.1.31).
    APEX_LEVEL = "apex_level"
    #: Across the crowns (§6.1.7 "sobre las coronas").
    OVER_CROWNS = "over_crowns"
    ROOT = "root"
    #: The coronal pulp chamber (§6.1.27).
    CORONAL_PULP = "coronal_pulp"


class TargetSelector(StrEnum):
    """**Which** of a finding's targets a mark applies to.

    Deliberately separate from :class:`MarkPlacement`: a mark can be drawn on
    some targets rather than all of them, and that is not a statement about
    height or landmark. §6.1.1 draws its crossed squares on "las piezas
    dentarias que correspondan a **los extremos** del aparato" and, separately,
    "**a nivel de los ápices**" — two facts, two fields.

    :attr:`RenderMark.role` answers the same question a different way, by
    naming a normative role the target carries (§6.1.29's *pilares*). The
    difference is who decides: a role is recorded by the clinician on the
    target, a selector is a property of the span itself.

    One member, because the norm states one such subset. A selector nothing
    uses would be a promise the norm never made.
    """

    #: The first and last target of the range, in row order.
    RANGE_ENDPOINTS = "range_endpoints"


class SymbolShape(StrEnum):
    CIRCLE = "circle"
    #: A circle with the rule's sigla written inside it (§6.1.26).
    CIRCLE_ENCLOSING_SIGLA = "circle_enclosing_sigla"
    INVERTED_PARENTHESIS = "inverted_parenthesis"
    SQUARE = "square"
    #: A square drawn round the clinical crown. §6.1.3 words it "bordeando la
    #: corona" and §6.1.4 "que encierre la corona"; the figures on pp. 6-7 draw
    #: the same rectangle, so one token serves both.
    SQUARE_BORDERING_CROWN = "square_bordering_crown"
    SQUARE_WITH_CROSS = "square_with_cross"
    TRIANGLE = "triangle"
    TWO_INTERSECTING_CIRCLES = "two_intersecting_circles"
    X_CROSS = "x_cross"


class LineStyle(StrEnum):
    FRACTURE_TRACE = "fracture_trace"
    SEALANT_PATH = "sealant_path"
    STRAIGHT_HORIZONTAL = "straight_horizontal"
    STRAIGHT_VERTICAL = "straight_vertical"
    TWO_PARALLEL_HORIZONTAL = "two_parallel_horizontal"
    ZIGZAG = "zigzag"


class LineMeaning(StrEnum):
    """What a line stands for, where the norm names it."""

    #: §6.1.29: the horizontal states the extent of the bridge.
    BRIDGE_EXTENSION = "bridge_extension"


class ArrowStyle(StrEnum):
    CURVED = "curved"
    STRAIGHT_VERTICAL = "straight_vertical"
    TWO_CROSSED_CURVED = "two_crossed_curved"
    ZIGZAG = "zigzag"


class ArrowDirection(StrEnum):
    """Which way an arrow points, relative to the tooth (``toward``).

    Never a screen direction: an upper and a lower tooth with the same finding
    point opposite ways. The renderer combines this with the tooth's arch.
    """

    #: Toward the occlusal plane (§6.1.23).
    OCCLUSAL_PLANE = "occlusal_plane"
    #: Away from the tooth, out of the arch (§6.1.24 "en sentido externo").
    OUTWARD = "outward"
    #: Toward the tooth's incisal/occlusal zone (§6.1.25).
    INCISAL_OCCLUSAL = "incisal_occlusal"


class ConnectorStyle(StrEnum):
    STRAIGHT_LINE = "straight_line"
    VERTICAL_MARKS = "vertical_marks"


class FillStyle(StrEnum):
    SOLID = "solid"


class OutlineStyle(StrEnum):
    CONTOUR = "contour"


class SiglaCase(StrEnum):
    UPPERCASE = "uppercase"


#: Params each mark kind may carry, and the closed vocabulary of each.
#:
#: A key absent from a mark is fine — many marks need no placement. A key that
#: is *not* listed for its kind, or a value outside its enum, is a catalog
#: error: the renderer would have to guess, and guessing on an odontogram is
#: how a wrong clinical statement gets drawn.
MARK_PARAMS: Final[Mapping[RenderKind, Mapping[str, type[StrEnum]]]] = MappingProxyType(
    {
        RenderKind.BOX_SIGLAS: MappingProxyType({"case": SiglaCase}),
        RenderKind.SYMBOL: MappingProxyType({"shape": SymbolShape, "at": MarkPlacement}),
        RenderKind.LINE: MappingProxyType(
            {"style": LineStyle, "at": MarkPlacement, "meaning": LineMeaning}
        ),
        RenderKind.CONNECTOR: MappingProxyType({"style": ConnectorStyle, "at": MarkPlacement}),
        RenderKind.ARROW: MappingProxyType(
            {"style": ArrowStyle, "at": MarkPlacement, "toward": ArrowDirection}
        ),
        RenderKind.SHAPE_FILL: MappingProxyType({"fill": FillStyle, "at": MarkPlacement}),
        RenderKind.OUTLINE: MappingProxyType({"style": OutlineStyle}),
    }
)

#: Params a mark of this kind cannot be drawn without.
#:
#: An arrow is the one mark whose meaning collapses without both: §6.1.23 draws
#: its arrow *on* the tooth and §6.1.24/6.1.25 draw theirs *outside* it, so a
#: renderer that had to infer placement would be inferring it from ``toward``,
#: which says something else entirely.
REQUIRED_MARK_PARAMS: Final[Mapping[RenderKind, frozenset[str]]] = MappingProxyType(
    {RenderKind.ARROW: frozenset({"style", "at"})}
)


class ColorSemantics(StrEnum):
    """Normative colour meaning (NTS N.° 188 §5.12-5.13).

    Only red and blue may be used. The UI layer maps these to its own
    tokens; the catalog never stores hex values.
    """

    #: Always blue: good state / non-pathological characteristic.
    GOOD_OR_NON_PATHOLOGICAL = "good_or_non_pathological"
    #: Always red: bad state, temporary, or pathological.
    BAD_TEMPORARY_OR_PATHOLOGICAL = "bad_temporary_or_pathological"
    #: Blue when in good state, red when in bad state.
    CONDITION_DEPENDENT = "condition_dependent"


class GeometryMode(StrEnum):
    """Where the concrete geometry of a mark comes from."""

    #: Nothing is drawn on the tooth figure (siglas in the box only).
    NONE = "none"
    #: Fixed placement fully derived from the rule + its target.
    STANDARD_GEOMETRY = "standard_geometry"
    #: Geometry is the set of affected dental surfaces.
    SURFACE_REGIONS = "surface_regions"
    #: The clinician draws the observed shape ("según la forma que se observa").
    CLINICIAN_DEFINED_SHAPE = "clinician_defined_shape"


class GeometryConstraint(StrEnum):
    """Bounds applied on top of a geometry mode."""

    SURFACE_REGIONS = "surface_regions"
    FISSURE_ANATOMY = "fissure_anatomy"
    CROWN_AREA = "crown_area"
    ROOT_AREA = "root_area"
    APEX_LEVEL = "apex_level"
    INTERPROXIMAL = "interproximal"


class AttributeKind(StrEnum):
    """How an attribute's value is shaped."""

    #: Exactly one value from ``values``.
    ENUM = "enum"
    #: Zero or more values from ``values``.
    ENUM_MULTI = "enum_multi"
    #: A single constant code (a rule with one fixed sigla).
    FIXED = "fixed"
    #: Integer whose admissible range the norm does not define.
    INTEGER = "integer"
    #: Free text, routed by the norm to Especificaciones/Observaciones.
    FREE_TEXT = "free_text"


class ReviewStatus(StrEnum):
    """Whether the norm defines the item completely enough to implement."""

    VERIFIED = "verified"
    NEEDS_CLINICAL_REVIEW = "needs_clinical_review"


class TargetIdentity(StrEnum):
    """Whether the clinical subject carries an FDI number in the chart."""

    NUMBERED = "numbered"
    #: e.g. a supernumerary tooth: it exists, but has no FDI cell.
    UNNUMBERED = "unnumbered"


class AnchorKind(StrEnum):
    INTERPROXIMAL = "interproximal"


class AnchorRole(StrEnum):
    """Anchors position a mark; they are never the clinical subject."""

    SPATIAL_REFERENCE_ONLY = "spatial_reference_only"


class ArchCardinality(StrEnum):
    ONE = "one"
    #: NTS §6.1.30: "ya sea el maxilar superior y/o el maxilar inferior".
    ONE_OR_BOTH = "one_or_both"


class RangeGrouping(StrEnum):
    """Whether one occurrence may cover disjoint stretches of the arch."""

    SINGLE_SEGMENT = "single_segment"
    #: NTS §6.1.31 draws two separate segments for one appliance.
    MULTI_SEGMENT = "multi_segment"


class RelationKind(StrEnum):
    """Normative relationship between two rules."""

    #: §6.1.35: when a carious lesion is present, add 6.1.16's siglas too.
    COMPANION_WHEN_PRESENT = "companion_when_present"


class RoleAppliesTo(StrEnum):
    """Which kind of participant may carry a normative role.

    Deliberately declared here rather than imported from the persistence
    vocabulary: the catalog describes the norm and must not depend on how
    DentalPin happens to store a target. The consumer maps these onto its
    own ``participation`` values.
    """

    SUBJECT = "subject"
    ANCHOR = "anchor"


class RoleDef(BaseModel):
    """A normative role a *target* of a finding may carry.

    NTS §6.1.29 draws "una línea recta horizontal ... con líneas verticales
    **sobre los pilares**": being a *pilar* is a property of one tooth
    inside the span, not a datum of the finding as a whole. It therefore
    lives here, as metadata for the target's role, and never as an
    attribute of the finding — there must be exactly one source.

    ``min_count`` / ``max_count`` are ``None`` when **the norm does not
    state a cardinality**. ``0`` is a stated lower bound, never a stand-in
    for silence.
    """

    model_config = ConfigDict(extra="forbid", frozen=True)

    code: str = Field(min_length=1, max_length=30)
    name: str = Field(min_length=1)
    applies_to: RoleAppliesTo = RoleAppliesTo.SUBJECT
    min_count: int | None = Field(default=None, ge=0)
    max_count: int | None = Field(default=None, ge=1)
    status: ReviewStatus = ReviewStatus.VERIFIED
    notes: str | None = None


class SpecificationRequirement(BaseModel):
    """Data the norm routes to the *Especificaciones* item (NTS §5.14).

    Declared on a rule when the norm states it for every occurrence, or on
    a :class:`VariantValue` when only that variant triggers it.

    ``required=True`` means: a finding that activates this requirement
    cannot finalize its record without at least one
    ``nts_record_specifications`` row **linked to that finding**. A general
    specification (``finding_id`` NULL) never satisfies it.

    The only thing that can be verified is that such a linked entry exists
    and is not empty. Whether its prose actually states the metal colour or
    the fluorosis classification is a clinical judgement the software does
    not make.
    """

    model_config = ConfigDict(extra="forbid", frozen=True)

    #: Stable semantic key, safe to branch on. Not a UI string.
    code: str = Field(min_length=1, max_length=50)
    #: Clinical prompt shown to the professional.
    label: str = Field(min_length=1)
    required: bool = True
    status: ReviewStatus = ReviewStatus.VERIFIED
    notes: str | None = None


class VariantValue(BaseModel):
    """One admissible value of an attribute (a sigla, a position, ...)."""

    model_config = ConfigDict(extra="forbid", frozen=True)

    code: str = Field(min_length=1, max_length=20)
    name: str = Field(min_length=1)
    #: Set when choosing *this* value is what triggers the requirement.
    specification_requirement: SpecificationRequirement | None = None
    status: ReviewStatus = ReviewStatus.VERIFIED
    notes: str | None = None


class AttributeDef(BaseModel):
    """Structured datum a rule carries. Never free-form prose."""

    model_config = ConfigDict(extra="forbid", frozen=True)

    name: str = Field(min_length=1)
    kind: AttributeKind
    required: bool = True
    #: True when this attribute is what gets written inside the tooth's box.
    is_sigla: bool = False
    values: tuple[VariantValue, ...] = ()
    status: ReviewStatus = ReviewStatus.VERIFIED
    notes: str | None = None


class GeometryInput(BaseModel):
    model_config = ConfigDict(extra="forbid", frozen=True)

    mode: GeometryMode
    constraints: tuple[GeometryConstraint, ...] = ()


class Anchor(BaseModel):
    """Spatial reference used to place a mark, not a clinical target."""

    model_config = ConfigDict(extra="forbid", frozen=True)

    kind: AnchorKind
    cardinality: int = Field(ge=1)
    role: AnchorRole


class RenderMark(BaseModel):
    """One drawing operation.

    Two kinds of information, deliberately kept apart:

    * ``params`` say **how it looks** — shape, style, case, placement. They are
      descriptive tokens from the enums above, never coordinates.
    * ``text_from`` / ``suffix_from`` / ``role`` / ``target_selector`` /
      ``regions_from`` say **what data it reads**. They are references into the
      rule's own ``attributes`` and ``target_roles``, and the validator
      resolves every one of them.

    The split exists so a renderer never has to infer a binding. With a single
    ``is_sigla`` attribute per rule the text source *looks* inferable today,
    but that is an accident of NTS N.° 188 rather than a contract, and §6.1.26
    already breaks the neighbouring assumption: it carries a sigla that goes
    inside a circle and never into the annotation box.
    """

    model_config = ConfigDict(extra="forbid", frozen=True)

    kind: RenderKind
    params: FrozenStrMap = _EMPTY_PARAMS
    #: Attribute whose selected value supplies this mark's text.
    text_from: str | None = Field(default=None, min_length=1)
    #: Attribute appended to that text (§6.1.19 writes the mobility degree
    #: after the "M"). Separate from ``text_from`` because it is a second
    #: datum, not a second rendering of the first.
    suffix_from: str | None = Field(default=None, min_length=1)
    #: ``target_roles`` code selecting *which* targets carry this mark.
    #: §6.1.29 marks the pilares of the span, which the norm does not equate
    #: with its endpoints — so the role is read from the targets, never
    #: guessed from their position.
    role: str | None = Field(default=None, min_length=1)
    #: A subset of the finding's targets, chosen by the span's own shape
    #: rather than by anything the clinician recorded (§6.1.1's extremes).
    #: Orthogonal to ``params["at"]``, which says where the mark is drawn.
    target_selector: TargetSelector | None = None
    #: Attribute whose selected values name the regions this mark covers —
    #: the dental surfaces, for the rules the norm scopes to surfaces.
    #:
    #: Declared rather than looked up. A renderer must not go hunting for an
    #: attribute called "surfaces", nor for "the rule's only ``enum_multi``":
    #: both happen to work on NTS N.° 188 today and neither is a contract. It
    #: is mutually exclusive with ``params["at"]`` — a mark takes its geometry
    #: from a landmark or from recorded data, never from both and never from
    #: neither.
    #:
    #: What a surface *code* means geometrically is not settled here and is not
    #: the catalog's business: the norm draws "la forma que se observa" and
    #: defines no correspondence between M/D/O/V/L and parts of a drawn crown.
    regions_from: str | None = Field(default=None, min_length=1)


class Render(BaseModel):
    model_config = ConfigDict(extra="forbid", frozen=True)

    color_semantics: ColorSemantics
    marks: tuple[RenderMark, ...] = Field(min_length=1)


class RelatedRule(BaseModel):
    model_config = ConfigDict(extra="forbid", frozen=True)

    rule_id: str = Field(min_length=1)
    relation: RelationKind
    notes: str | None = None


class Source(BaseModel):
    """Traceability back to the norm. Reference, never reproduction."""

    model_config = ConfigDict(extra="forbid", frozen=True)

    page: int = Field(ge=1)
    section: str = Field(min_length=1)
    #: Set only where the PDF prints a different label than the logical id
    #: (NTS N.° 188 has two such typos).
    document_label: str | None = None


class NtsRule(BaseModel):
    model_config = ConfigDict(extra="forbid", frozen=True)

    rule_id: str = Field(min_length=1)
    ordinal: int = Field(ge=1)
    official_name: str = Field(min_length=1)
    scope: Scope
    target_identity: TargetIdentity = TargetIdentity.NUMBERED
    anchor: Anchor | None = None
    arch_cardinality: ArchCardinality | None = None
    range_grouping: RangeGrouping | None = None
    attributes: tuple[AttributeDef, ...] = ()
    #: Roles a *target* of this finding may carry. Single source — a role
    #: is never also modelled as an attribute.
    target_roles: tuple[RoleDef, ...] = ()
    #: Set when the norm states the requirement for every occurrence of the
    #: rule. Mutually exclusive with per-variant requirements (see the
    #: validator): the specifications table stores no requirement code, so a
    #: consumer could not tell which of two requirements an entry satisfied.
    specification_requirement: SpecificationRequirement | None = None
    render: Render
    geometry_input: GeometryInput
    related_rules: tuple[RelatedRule, ...] = ()
    status: ReviewStatus = ReviewStatus.VERIFIED
    source: Source
    notes: str | None = None

    def role(self, code: str) -> RoleDef | None:
        """The role definition for ``code``, or ``None`` if not allowed."""
        return next((r for r in self.target_roles if r.code == code), None)

    def active_specification_requirements(
        self, attributes: Mapping[str, object]
    ) -> tuple[SpecificationRequirement, ...]:
        """Requirements a finding with these ``attributes`` activates.

        The rule-level requirement, if any, plus the requirement of every
        selected variant value. This is what lets a consumer ask *"does this
        finding need an Especificaciones entry?"* without ever branching on
        a ``rule_id``.

        ``attributes`` maps attribute name to the selected code, or to a
        collection of codes for ``enum_multi``. Unknown names are ignored —
        validating them is the caller's job, not this lookup's.
        """
        active: list[SpecificationRequirement] = []
        if self.specification_requirement is not None:
            active.append(self.specification_requirement)

        for attribute in self.attributes:
            if attribute.name not in attributes:
                continue
            selected = attributes[attribute.name]
            codes = (
                {selected}
                if isinstance(selected, str)
                else set(selected)
                if isinstance(selected, (list, tuple, set, frozenset))
                else set()
            )
            for value in attribute.values:
                if value.code in codes and value.specification_requirement:
                    active.append(value.specification_requirement)
        return tuple(active)


class GlobalRule(BaseModel):
    """Chart-wide convention, modelled apart from the 38 findings."""

    model_config = ConfigDict(extra="forbid", frozen=True)

    key: str = Field(min_length=1)
    title: str = Field(min_length=1)
    summary: str = Field(min_length=1)
    source: Source


class NtsCatalog(BaseModel):
    model_config = ConfigDict(extra="forbid", frozen=True)

    norm_version: str = Field(min_length=1)
    norm_label: str = Field(min_length=1)
    country: str = Field(min_length=1)
    expected_rule_count: int = Field(ge=1)
    rules: tuple[NtsRule, ...] = Field(min_length=1)
    global_rules: tuple[GlobalRule, ...] = ()
    pending_decisions: tuple[str, ...] = ()

    def rule(self, rule_id: str) -> NtsRule | None:
        return next((r for r in self.rules if r.rule_id == rule_id), None)
