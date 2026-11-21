"""HTTP schemas for the NTS clinical record API.

These validate **shape**, never clinical meaning. Which attributes a rule
takes, which targets a scope allows, which roles exist and when an
Especificaciones entry is required all come from the versioned catalog and
are enforced by :mod:`app.modules.odontogram.nts.validation`. Restating any
of it here would create a second source of the norm.

So ``attributes`` is an open object and ``rule_id`` is a plain string: the
service rejects what the catalog does not recognise, with every problem
reported at once.

Every request model is ``extra="forbid"``, so a client cannot smuggle
``clinic_id``, ``actor_id``, ``status``, ``version`` or a hash field into a
payload — those come from the authenticated context or from the server.
"""

from __future__ import annotations

from datetime import datetime
from typing import Any
from uuid import UUID

from pydantic import BaseModel, ConfigDict, Field

from app.modules.odontogram.nts.constants import DraftSeed


class _Request(BaseModel):
    """Base for every mutating payload."""

    model_config = ConfigDict(extra="forbid")


class _Response(BaseModel):
    model_config = ConfigDict(from_attributes=True)


# ---------------------------------------------------------------------------
# requests
# ---------------------------------------------------------------------------


class NtsExpectedVersionRequest(_Request):
    """The optimistic-locking token every mutation carries.

    It lives in the body rather than a query string or an ``If-Match``
    header because ADR 0022 makes it part of the operation, not transport
    metadata — which is also why removals are ``POST .../remove`` instead of
    ``DELETE`` with a body.
    """

    expected_version: int = Field(ge=1)


class NtsDraftCreateRequest(_Request):
    """Open a draft. ``patient_id`` comes from the path, the actor and clinic
    from the authenticated context; none of them is accepted here.

    ``norm_version`` is explicit and is **not** inferred from the user's
    odontogram profile preference: the norm is a property of the record.
    """

    norm_version: str = Field(min_length=1, max_length=50)
    stage: str = Field(min_length=1, max_length=20)
    stage_label: str | None = Field(default=None, min_length=1, max_length=200)
    observations: str | None = None
    seed: DraftSeed = DraftSeed.EMPTY
    supersedes_record_id: UUID | None = None
    supersession_reason: str | None = Field(default=None, min_length=1)


class NtsRecordMetadataUpdateRequest(NtsExpectedVersionRequest):
    """Change the three editable fields.

    Three states are distinguishable, and ``model_fields_set`` is what makes
    that possible:

    * the key is absent          -> leave the field alone;
    * the key is present, null   -> clear it;
    * the key is present, a value-> set it.

    An empty ``observations`` string is stored literally rather than being
    silently folded into NULL. ``stage_label`` rejects the empty string at
    the schema level (``min_length=1``), so clearing it is unambiguous.
    """

    stage: str | None = Field(default=None, min_length=1, max_length=20)
    stage_label: str | None = Field(default=None, min_length=1, max_length=200)
    observations: str | None = None

    def was_sent(self, field: str) -> bool:
        return field in self.model_fields_set


class NtsTargetInput(_Request):
    """One target. Which combinations are legal is a catalog question."""

    participation: str = Field(min_length=1, max_length=20)
    target_kind: str = Field(min_length=1, max_length=20)
    tooth_number: int | None = None
    arch: str | None = Field(default=None, max_length=10)
    local_ordinal: int | None = Field(default=None, ge=1)
    role: str | None = Field(default=None, max_length=30)
    group_index: int = Field(default=0, ge=0)
    position: int = Field(default=0, ge=0)


class NtsFindingCreateRequest(NtsExpectedVersionRequest):
    """A finding and its initial targets, created as one aggregate."""

    rule_id: str = Field(min_length=1, max_length=20)
    attributes: dict[str, Any] = Field(default_factory=dict)
    targets: list[NtsTargetInput] = Field(min_length=1)


class NtsFindingAttributesReplaceRequest(NtsExpectedVersionRequest):
    """Full replacement of a finding's attributes.

    ``rule_id``, ``norm_version``, ``provenance`` and ``source_finding_id``
    are not reachable: a finding does not change what rule it cites.
    """

    attributes: dict[str, Any] = Field(default_factory=dict)


class NtsTargetsReplaceRequest(NtsExpectedVersionRequest):
    """Full replacement of a finding's target set.

    The whole set travels together so it can be validated as a whole and
    cost a single version bump; there is deliberately no target-by-target
    endpoint.
    """

    targets: list[NtsTargetInput] = Field(min_length=1)


class NtsSpecificationCreateRequest(NtsExpectedVersionRequest):
    """A new Especificaciones entry (NTS §5.14).

    ``finding_id`` is optional here because a general specification is
    legitimate — it simply never satisfies a finding's requirement.
    """

    text: str = Field(min_length=1)
    finding_id: UUID | None = None


class NtsSpecificationReplaceRequest(NtsExpectedVersionRequest):
    """Full replacement of one entry.

    ``finding_id`` is **required even when null**, so omitting it can never
    be mistaken for "unlink from its finding". This is a PUT, not a PATCH.
    """

    text: str = Field(min_length=1)
    finding_id: UUID | None = Field(...)


class NtsDiscardRequest(NtsExpectedVersionRequest):
    """Abandon a draft. Nothing is deleted; the reason is required."""

    reason: str = Field(min_length=1)


# ---------------------------------------------------------------------------
# responses
# ---------------------------------------------------------------------------


class NtsTargetResponse(_Response):
    id: UUID
    group_index: int
    position: int
    participation: str
    role: str | None
    target_kind: str
    tooth_number: int | None
    arch: str | None
    local_ordinal: int | None
    #: Reserved. GEOMETRY CONTRACT PENDING — always null in this version.
    geometry: dict[str, Any] | None


class NtsFindingResponse(_Response):
    id: UUID
    record_id: UUID
    norm_version: str
    rule_id: str
    attributes: dict[str, Any]
    provenance: str
    source_finding_id: UUID | None
    sequence: int
    created_at: datetime
    created_by: UUID
    targets: list[NtsTargetResponse]


class NtsSpecificationResponse(_Response):
    id: UUID
    record_id: UUID
    finding_id: UUID | None
    text: str
    sequence: int


class NtsRecordResponse(_Response):
    """A record and its clinical aggregate.

    The audit trail is not included: it is process metadata with its own
    volume and access questions, and it is not exposed by this API.

    ``content_hash`` attests that the content has not changed since it was
    finalized. It is **not** a digital signature and implies no compliance
    or accreditation claim.
    """

    id: UUID
    clinic_id: UUID
    patient_id: UUID
    norm_version: str
    stage: str
    stage_label: str | None
    status: str
    #: The next ``expected_version`` a client must send.
    version: int
    observations: str | None

    recorded_at: datetime
    recorded_by: UUID
    finalized_at: datetime | None
    finalized_by: UUID | None
    discarded_at: datetime | None
    discarded_by: UUID | None
    discard_reason: str | None

    recorded_by_name: str | None
    recorded_by_role: str | None
    recorded_by_professional_id: str | None

    supersedes_record_id: UUID | None
    supersession_reason: str | None

    content_hash: str | None
    hash_algorithm: str | None
    canonicalization_version: int | None

    created_at: datetime
    updated_at: datetime

    findings: list[NtsFindingResponse]
    specifications: list[NtsSpecificationResponse]


class NtsRecordSummaryResponse(_Response):
    """One row of a patient's record history — no findings, no targets."""

    id: UUID
    patient_id: UUID
    norm_version: str
    stage: str
    stage_label: str | None
    status: str
    version: int
    recorded_at: datetime
    finalized_at: datetime | None
    discarded_at: datetime | None
    supersedes_record_id: UUID | None
    content_hash: str | None
    #: Derived, never stored: a finalized record names this one as its
    #: predecessor.
    is_superseded: bool


# --- mutation responses ----------------------------------------------------
#
# A client must never infer `expected_version + 1`: the server always says
# what the version actually became.


class NtsVersionMutationResponse(BaseModel):
    record_version: int


class NtsFindingMutationResponse(BaseModel):
    record_version: int
    finding: NtsFindingResponse


class NtsSpecificationMutationResponse(BaseModel):
    record_version: int
    specification: NtsSpecificationResponse


class NtsCatalogVersionsResponse(BaseModel):
    """Norm versions this build can interpret."""

    norm_versions: list[str]
