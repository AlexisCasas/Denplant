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


class VariantValue(BaseModel):
    """One admissible value of an attribute (a sigla, a position, ...)."""

    model_config = ConfigDict(extra="forbid", frozen=True)

    code: str = Field(min_length=1, max_length=20)
    name: str = Field(min_length=1)
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
    """One drawing operation. ``params`` are descriptive tokens only."""

    model_config = ConfigDict(extra="forbid", frozen=True)

    kind: RenderKind
    params: FrozenStrMap = _EMPTY_PARAMS


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
    render: Render
    geometry_input: GeometryInput
    related_rules: tuple[RelatedRule, ...] = ()
    status: ReviewStatus = ReviewStatus.VERIFIED
    source: Source
    notes: str | None = None


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
