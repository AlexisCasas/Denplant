"""Audit-state serialization and event writing for NTS records.

This is **not** CanonicalSnapshotV1 and must never be confused with it.
The canonical snapshot is a byte-exact, versioned contract whose only job
is to feed a hash; changing it changes stored digests. These states answer
a different question — *what did this row look like before and after?* —
are read by humans, and may gain fields without breaking anything.

Nothing here uses ``__dict__``, ``repr`` or ``str`` on an ORM object: the
fields are listed explicitly, so a column added later cannot leak into the
trail unnoticed, and UUID/datetime are converted deliberately.
"""

from __future__ import annotations

from datetime import UTC, datetime
from typing import Any
from uuid import UUID, uuid4

from sqlalchemy.ext.asyncio import AsyncSession

from app.modules.odontogram.nts.constants import AuditAction, AuditEntityType
from app.modules.odontogram.nts.models import (
    NtsFinding,
    NtsFindingTarget,
    NtsOdontogramRecord,
    NtsRecordAuditEvent,
    NtsRecordSpecification,
)

#: Record columns a clinician can change through the metadata operation.
EDITABLE_RECORD_FIELDS = ("stage", "stage_label", "observations")


def jsonable(value: Any) -> Any:
    """Convert a stored value into something JSONB accepts."""
    if value is None or isinstance(value, (str, int, float, bool)):
        return value
    if isinstance(value, UUID):
        return str(value)
    if isinstance(value, datetime):
        return value.astimezone(UTC).isoformat()
    if isinstance(value, dict):
        return {str(k): jsonable(v) for k, v in value.items()}
    if isinstance(value, (list, tuple, set, frozenset)):
        return [jsonable(v) for v in value]
    return str(value)


def record_metadata_state(record: NtsOdontogramRecord) -> dict[str, Any]:
    """The subset of a record a metadata update may touch."""
    return {field: jsonable(getattr(record, field)) for field in EDITABLE_RECORD_FIELDS}


def record_lifecycle_state(record: NtsOdontogramRecord) -> dict[str, Any]:
    """Identity plus lifecycle, for creation, discard and finalize events."""
    return {
        "id": jsonable(record.id),
        "clinic_id": jsonable(record.clinic_id),
        "patient_id": jsonable(record.patient_id),
        "norm_version": record.norm_version,
        "status": record.status,
        "version": record.version,
        "stage": record.stage,
        "stage_label": record.stage_label,
        "observations": record.observations,
        "recorded_at": jsonable(record.recorded_at),
        "recorded_by": jsonable(record.recorded_by),
        "finalized_at": jsonable(record.finalized_at),
        "finalized_by": jsonable(record.finalized_by),
        "discarded_at": jsonable(record.discarded_at),
        "discarded_by": jsonable(record.discarded_by),
        "discard_reason": record.discard_reason,
        "supersedes_record_id": jsonable(record.supersedes_record_id),
        "supersession_reason": record.supersession_reason,
        "content_hash": record.content_hash,
        "hash_algorithm": record.hash_algorithm,
        "canonicalization_version": record.canonicalization_version,
    }


def target_state(target: NtsFindingTarget) -> dict[str, Any]:
    return {
        "id": jsonable(target.id),
        "group_index": target.group_index,
        "position": target.position,
        "participation": target.participation,
        "role": target.role,
        "target_kind": target.target_kind,
        "tooth_number": target.tooth_number,
        "arch": target.arch,
        "local_ordinal": target.local_ordinal,
        "geometry": jsonable(target.geometry),
    }


def specification_state(specification: NtsRecordSpecification) -> dict[str, Any]:
    return {
        "id": jsonable(specification.id),
        "finding_id": jsonable(specification.finding_id),
        "text": specification.text,
        "sequence": specification.sequence,
    }


def finding_state(
    finding: NtsFinding,
    *,
    targets: list[NtsFindingTarget] | None = None,
    linked_specifications: list[NtsRecordSpecification] | None = None,
) -> dict[str, Any]:
    """The whole finding aggregate.

    ``targets`` and ``linked_specifications`` are passed in rather than
    lazily loaded, because a removal has to capture them *before* the
    cascade deletes them — after the fact there is nothing left to read.
    """
    resolved_targets = finding.targets if targets is None else targets
    state: dict[str, Any] = {
        "id": jsonable(finding.id),
        "record_id": jsonable(finding.record_id),
        "norm_version": finding.norm_version,
        "rule_id": finding.rule_id,
        "attributes": jsonable(finding.attributes),
        "provenance": finding.provenance,
        "source_finding_id": jsonable(finding.source_finding_id),
        "sequence": finding.sequence,
        "created_at": jsonable(finding.created_at),
        "created_by": jsonable(finding.created_by),
        "targets": sorted(
            (target_state(t) for t in resolved_targets),
            key=lambda t: (t["group_index"], t["position"], t["id"]),
        ),
    }
    if linked_specifications is not None:
        state["specifications"] = sorted(
            (specification_state(s) for s in linked_specifications),
            key=lambda s: (s["sequence"], s["id"]),
        )
    return state


def build_event(
    *,
    record: NtsOdontogramRecord,
    record_version: int,
    entity_type: AuditEntityType,
    entity_id: UUID | None,
    action: AuditAction,
    changed_by: UUID,
    previous_state: dict[str, Any] | None = None,
    new_state: dict[str, Any] | None = None,
    notes: str | None = None,
) -> NtsRecordAuditEvent:
    """One append-only trail row. Never updated, never deleted."""
    return NtsRecordAuditEvent(
        id=uuid4(),
        clinic_id=record.clinic_id,
        record_id=record.id,
        record_version=record_version,
        entity_type=entity_type.value,
        entity_id=entity_id,
        action=action.value,
        previous_state=previous_state,
        new_state=new_state,
        changed_by=changed_by,
        changed_at=datetime.now(UTC),
        notes=notes,
    )


def add_event(db: AsyncSession, event: NtsRecordAuditEvent) -> NtsRecordAuditEvent:
    """Stage the event on the caller's transaction. No commit happens here."""
    db.add(event)
    return event
