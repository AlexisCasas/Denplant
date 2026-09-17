"""Vocabularies for NTS clinical records.

These are **structural** vocabularies — lifecycle states, target kinds,
audit actions. They are not normative content: siglas, attribute codes and
rule ids live exclusively in the versioned catalog
(:mod:`app.modules.odontogram.nts.catalog`) and are never duplicated here
or in DDL.

Following the module's existing convention (see ``agenda.models``), these
are Python enums persisted as ``String`` columns with a ``CHECK``
constraint — not PostgreSQL ``ENUM`` types, which the repo does not use
anywhere and which make later migrations harder.
"""

from enum import StrEnum
from typing import Final


class RecordStatus(StrEnum):
    """Lifecycle of an NTS record (ADR 0022 §1).

    ``draft`` is DenPlant's editable working state. Both other states are
    terminal: ``draft → discarded`` and ``draft → finalized`` are the only
    transitions, and no record is ever physically deleted.
    """

    DRAFT = "draft"
    DISCARDED = "discarded"
    FINALIZED = "finalized"


class RecordStage(StrEnum):
    """Clinical stage of the record — metadata, never a fixed slot."""

    DIAGNOSIS = "diagnosis"
    EVOLUTION = "evolution"
    DISCHARGE = "discharge"
    OTHER = "other"


class DraftSeed(StrEnum):
    """How a new draft is populated. Never implicit.

    ``carry_forward`` copies findings from the current finalized record for
    individual review; it never copies observations or general
    specifications, which have no per-item provenance to review.
    """

    EMPTY = "empty"
    CARRY_FORWARD = "carry_forward"


class FindingProvenance(StrEnum):
    """Whether a finding was observed now or carried from a previous record."""

    OBSERVED = "observed"
    CARRIED_FORWARD = "carried_forward"


class TargetParticipation(StrEnum):
    """Whether a target carries the finding, or merely positions it.

    Deliberately binary — no ``member`` value. The direct/relational
    distinction is a property of the rule's ``scope`` in the catalog and is
    derived, never stored (nts-record-model.md §9.2).
    """

    #: This entity carries the clinical finding.
    SUBJECT = "subject"
    #: Spatial reference only; asserts nothing clinical (e.g. 6.1.26).
    ANCHOR = "anchor"


class TargetKind(StrEnum):
    """What kind of entity a target is. No fake FDI numbers, ever."""

    FDI_TOOTH = "fdi_tooth"
    #: A subject the chart cannot number (6.1.26 supernumerary).
    UNNUMBERED_TOOTH = "unnumbered_tooth"
    ARCH = "arch"


class AuditEntityType(StrEnum):
    """Which entity an audit event is about."""

    RECORD = "record"
    FINDING = "finding"
    TARGET = "target"
    SPECIFICATION = "specification"


class AuditAction(StrEnum):
    """Closed list of audited operations (nts-record-model.md §5.2)."""

    RECORD_CREATED = "record_created"
    RECORD_METADATA_UPDATED = "record_metadata_updated"
    FINDING_CREATED = "finding_created"
    FINDING_UPDATED = "finding_updated"
    FINDING_REMOVED = "finding_removed"
    TARGET_CHANGED = "target_changed"
    SPECIFICATION_CHANGED = "specification_changed"
    CARRIED_FORWARD = "carried_forward"
    CARRIED_FORWARD_CONFIRMED = "carried_forward_confirmed"
    DISCARDED = "discarded"
    FINALIZED = "finalized"
    #: Written against the *superseding* record; the superseded one is never
    #: touched (nts-record-model.md §5.3).
    SUPERSESSION_RECORDED = "supersession_recorded"


#: Digest stored on a finalized record. See :mod:`.canonical`.
HASH_ALGORITHM_SHA256: Final[str] = "sha256"

#: The canonical serialization contract in force. Permanent: any change to
#: a serialization rule is version 2, and version 1 stays implemented.
CANONICALIZATION_VERSION_V1: Final[int] = 1


def sql_in_clause(column: str, values: type[StrEnum]) -> str:
    """Render ``column IN ('a', 'b')`` for a CHECK constraint.

    Mirrors the ``ck_appointment_status_valid`` style in ``agenda.models``
    so the enum stays the single source of the allowed values.
    """
    rendered = ", ".join(f"'{member.value}'" for member in values)
    return f"{column} IN ({rendered})"
