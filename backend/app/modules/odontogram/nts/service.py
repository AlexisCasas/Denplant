"""Transactional service for NTS clinical records.

Every mutation follows one shape (ADR 0022 §6):

    1. compare-and-bump the parent record   -> 0 rows means 409
    2. validate and mutate
    3. write exactly one audit event
    4. flush

The transaction belongs to the **caller**: this module flushes, never
commits and never rolls back globally. A caller that rolls back loses the
mutation, the version bump and the audit event together.

Every public method takes ``clinic_id`` and proves the record belongs to it
before touching anything. No method loads or mutates by ``record_id`` alone.

Normative meaning comes from the catalog through
:mod:`app.modules.odontogram.nts.validation`. There is no ``rule_id``
branch anywhere in this file.
"""

from __future__ import annotations

from collections.abc import Mapping, Sequence
from dataclasses import dataclass, field
from datetime import UTC, datetime
from typing import Any
from uuid import UUID, uuid4

from sqlalchemy import select, update
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload
from sqlalchemy.orm.attributes import set_committed_value

from app.core.auth.models import ClinicMembership, User
from app.modules.odontogram.nts import audit as audit_state
from app.modules.odontogram.nts import validation
from app.modules.odontogram.nts.canonical import (
    CANONICALIZATION_VERSION_V1,
    HASH_ALGORITHM_SHA256,
    sha256_canonical_v1,
)
from app.modules.odontogram.nts.catalog import NtsRule, get_nts_rule
from app.modules.odontogram.nts.catalog.loader import CatalogNotFoundError
from app.modules.odontogram.nts.constants import (
    AuditAction,
    AuditEntityType,
    DraftSeed,
    FindingProvenance,
    RecordStatus,
)
from app.modules.odontogram.nts.exceptions import (
    NtsClinicalValidationError,
    NtsDraftConflictError,
    NtsRecordNotFoundError,
    NtsStateConflictError,
    NtsVersionConflictError,
)
from app.modules.odontogram.nts.models import (
    NtsFinding,
    NtsFindingTarget,
    NtsOdontogramRecord,
    NtsRecordSpecification,
)


@dataclass(frozen=True)
class TargetSpec:
    """One target of a finding, as the caller supplies it."""

    participation: str
    target_kind: str
    tooth_number: int | None = None
    arch: str | None = None
    local_ordinal: int | None = None
    role: str | None = None
    group_index: int = 0
    position: int = 0
    geometry: dict[str, Any] | None = None


@dataclass(frozen=True)
class FindingSpec:
    """A finding plus its initial targets, created as one aggregate."""

    rule_id: str
    attributes: Mapping[str, Any] = field(default_factory=dict)
    targets: Sequence[TargetSpec] = ()


class NtsRecordService:
    """Clinical operations on NTS odontogram records."""

    # ------------------------------------------------------------------
    # reads
    # ------------------------------------------------------------------

    @staticmethod
    async def get_record(db: AsyncSession, clinic_id: UUID, record_id: UUID) -> NtsOdontogramRecord:
        """One record with its whole clinical aggregate, no N+1.

        The audit trail is *not* loaded: it is process metadata, not part of
        the clinical document, and it grows without bound.
        """
        record = await NtsRecordService._load_aggregate(db, clinic_id, record_id)
        if record is None:
            raise NtsRecordNotFoundError(f"NTS record {record_id} not found in this clinic")
        return record

    @staticmethod
    async def get_editable_draft(
        db: AsyncSession, clinic_id: UUID, patient_id: UUID, norm_version: str
    ) -> NtsOdontogramRecord | None:
        """The open draft, or ``None``. At most one can exist."""
        stmt = (
            NtsRecordService._aggregate_query()
            .where(
                NtsOdontogramRecord.clinic_id == clinic_id,
                NtsOdontogramRecord.patient_id == patient_id,
                NtsOdontogramRecord.norm_version == norm_version,
                NtsOdontogramRecord.status == RecordStatus.DRAFT.value,
            )
            .limit(1)
        )
        return (await db.execute(stmt)).unique().scalar_one_or_none()

    @staticmethod
    async def get_current_record(
        db: AsyncSession, clinic_id: UUID, patient_id: UUID, norm_version: str
    ) -> NtsOdontogramRecord | None:
        """The clinically current record: the latest finalized one that no
        finalized record supersedes.

        A draft never replaces it, and a discarded record never counts.
        """
        # A self-join needs an explicit alias, otherwise the correlation
        # collapses onto the outer row.
        successor = NtsOdontogramRecord.__table__.alias("successor")
        superseded = (
            select(successor.c.id)
            .where(
                successor.c.supersedes_record_id == NtsOdontogramRecord.id,
                successor.c.status == RecordStatus.FINALIZED.value,
            )
            .exists()
        )

        stmt = (
            NtsRecordService._aggregate_query()
            .where(
                NtsOdontogramRecord.clinic_id == clinic_id,
                NtsOdontogramRecord.patient_id == patient_id,
                NtsOdontogramRecord.norm_version == norm_version,
                NtsOdontogramRecord.status == RecordStatus.FINALIZED.value,
                ~superseded,
            )
            .order_by(NtsOdontogramRecord.finalized_at.desc())
            .limit(1)
        )
        return (await db.execute(stmt)).unique().scalar_one_or_none()

    # ------------------------------------------------------------------
    # create
    # ------------------------------------------------------------------

    @staticmethod
    async def create_draft(
        db: AsyncSession,
        clinic_id: UUID,
        *,
        patient_id: UUID,
        norm_version: str,
        stage: str,
        actor_id: UUID,
        stage_label: str | None = None,
        observations: str | None = None,
        seed: DraftSeed = DraftSeed.EMPTY,
        supersedes_record_id: UUID | None = None,
        supersession_reason: str | None = None,
    ) -> NtsOdontogramRecord:
        """Open a draft.

        Creation is the one mutation that cannot compare-and-bump: the
        parent does not exist yet. It starts at ``version = 1`` and writes
        its ``record_created`` event at that same version, inside the
        caller's transaction.
        """
        NtsRecordService._require_known_norm(norm_version)

        if (supersedes_record_id is None) != (supersession_reason is None):
            raise NtsClinicalValidationError(
                ["supersedes_record_id and supersession_reason must be set together"]
            )

        predecessor = None
        if supersedes_record_id is not None:
            predecessor = await NtsRecordService._validate_predecessor(
                db,
                clinic_id,
                supersedes_record_id,
                patient_id=patient_id,
                norm_version=norm_version,
            )

        now = datetime.now(UTC)
        record = NtsOdontogramRecord(
            id=uuid4(),
            clinic_id=clinic_id,
            patient_id=patient_id,
            norm_version=norm_version,
            stage=stage,
            stage_label=stage_label,
            status=RecordStatus.DRAFT.value,
            version=1,
            observations=observations,
            recorded_at=now,
            recorded_by=actor_id,
            supersedes_record_id=supersedes_record_id,
            supersession_reason=supersession_reason,
        )
        # A SAVEPOINT so a lost race on the one-draft index does not discard
        # whatever else the caller had already done in this transaction. The
        # row is added *inside* it: added before, it would survive the
        # savepoint rollback still pending, and the caller's next flush would
        # retry the same failing INSERT.
        try:
            async with db.begin_nested():
                db.add(record)
                await db.flush()
        except IntegrityError as exc:
            if record in db:
                db.expunge(record)
            if "uq_nts_record_one_draft" in str(exc.orig):
                raise NtsDraftConflictError(
                    "a draft already exists for this patient and norm version"
                ) from exc
            raise

        audit_state.add_event(
            db,
            audit_state.build_event(
                record=record,
                record_version=1,
                entity_type=AuditEntityType.RECORD,
                entity_id=record.id,
                action=AuditAction.RECORD_CREATED,
                changed_by=actor_id,
                new_state=audit_state.record_lifecycle_state(record),
                notes=f"seed={seed.value}",
            ),
        )

        if seed is DraftSeed.CARRY_FORWARD:
            source = predecessor or await NtsRecordService.get_current_record(
                db, clinic_id, patient_id, norm_version
            )
            if source is None:
                raise NtsStateConflictError(
                    "carry_forward needs a finalized record to copy from; none exists"
                )
            await NtsRecordService._carry_forward(db, record, source, actor_id)

        await db.flush()
        # Return the aggregate with its collections eagerly loaded, so the
        # caller never triggers lazy IO on a freshly created record.
        return await NtsRecordService.get_record(db, clinic_id, record.id)

    @staticmethod
    async def _carry_forward(
        db: AsyncSession,
        draft: NtsOdontogramRecord,
        source: NtsOdontogramRecord,
        actor_id: UUID,
    ) -> None:
        """Seed the draft from ``source`` for individual review.

        Copies findings, their attributes, their targets and the
        specifications linked to those findings. It deliberately does not
        copy ``observations`` or general specifications (``finding_id``
        NULL): those carry no per-item provenance, so carrying them would
        assert old narrative as observed today with nothing to review.
        """
        now = datetime.now(UTC)
        linked = await NtsRecordService._specifications_by_finding(db, source.id)

        for source_finding in sorted(source.findings, key=lambda f: f.sequence):
            finding = NtsFinding(
                id=uuid4(),
                record_id=draft.id,
                norm_version=draft.norm_version,
                rule_id=source_finding.rule_id,
                attributes=dict(source_finding.attributes or {}),
                provenance=FindingProvenance.CARRIED_FORWARD.value,
                source_finding_id=source_finding.id,
                sequence=source_finding.sequence,
                created_at=now,
                created_by=actor_id,
            )
            db.add(finding)
            for source_target in source_finding.targets:
                db.add(
                    NtsFindingTarget(
                        id=uuid4(),
                        finding_id=finding.id,
                        group_index=source_target.group_index,
                        position=source_target.position,
                        participation=source_target.participation,
                        role=source_target.role,
                        target_kind=source_target.target_kind,
                        tooth_number=source_target.tooth_number,
                        arch=source_target.arch,
                        local_ordinal=source_target.local_ordinal,
                        geometry=None,
                    )
                )
            for source_spec in linked.get(source_finding.id, []):
                db.add(
                    NtsRecordSpecification(
                        id=uuid4(),
                        record_id=draft.id,
                        finding_id=finding.id,
                        text=source_spec.text,
                        sequence=source_spec.sequence,
                    )
                )
            await db.flush()
            await db.refresh(finding, ["targets"])
            audit_state.add_event(
                db,
                audit_state.build_event(
                    record=draft,
                    record_version=1,
                    entity_type=AuditEntityType.FINDING,
                    entity_id=finding.id,
                    action=AuditAction.CARRIED_FORWARD,
                    changed_by=actor_id,
                    previous_state={"source_finding_id": str(source_finding.id)},
                    new_state=audit_state.finding_state(finding),
                ),
            )

    # ------------------------------------------------------------------
    # record metadata
    # ------------------------------------------------------------------

    @staticmethod
    async def update_metadata(
        db: AsyncSession,
        clinic_id: UUID,
        record_id: UUID,
        *,
        expected_version: int,
        actor_id: UUID,
        stage: str | None = None,
        stage_label: str | None = None,
        observations: str | None = None,
        clear_stage_label: bool = False,
    ) -> NtsOdontogramRecord:
        """Change the three editable metadata fields, and nothing else.

        Identity, lifecycle, authorship, hashes and supersession are not
        reachable from here — each has its own operation or none at all.
        """
        record = await NtsRecordService.get_record(db, clinic_id, record_id)
        version = await NtsRecordService._compare_and_bump(db, clinic_id, record, expected_version)
        previous = audit_state.record_metadata_state(record)

        if stage is not None:
            record.stage = stage
        if clear_stage_label:
            record.stage_label = None
        elif stage_label is not None:
            record.stage_label = stage_label
        if observations is not None:
            record.observations = observations

        if record.stage == "other" and not record.stage_label:
            raise NtsClinicalValidationError(["stage 'other' requires a stage_label"])

        audit_state.add_event(
            db,
            audit_state.build_event(
                record=record,
                record_version=version,
                entity_type=AuditEntityType.RECORD,
                entity_id=record.id,
                action=AuditAction.RECORD_METADATA_UPDATED,
                changed_by=actor_id,
                previous_state=previous,
                new_state=audit_state.record_metadata_state(record),
            ),
        )
        await db.flush()
        return record

    # ------------------------------------------------------------------
    # findings
    # ------------------------------------------------------------------

    @staticmethod
    async def create_finding(
        db: AsyncSession,
        clinic_id: UUID,
        record_id: UUID,
        *,
        expected_version: int,
        actor_id: UUID,
        spec: FindingSpec,
    ) -> NtsFinding:
        """Create a finding and its targets as one aggregate, one bump."""
        record = await NtsRecordService.get_record(db, clinic_id, record_id)
        rule = NtsRecordService._require_rule(spec.rule_id, record.norm_version)
        NtsRecordService._require_valid(rule, spec.attributes, spec.targets)

        version = await NtsRecordService._compare_and_bump(db, clinic_id, record, expected_version)

        sequence = 1 + max((f.sequence for f in record.findings), default=0)
        finding = NtsFinding(
            id=uuid4(),
            record_id=record.id,
            norm_version=record.norm_version,
            rule_id=spec.rule_id,
            attributes=dict(spec.attributes),
            provenance=FindingProvenance.OBSERVED.value,
            source_finding_id=None,
            sequence=sequence,
            created_at=datetime.now(UTC),
            created_by=actor_id,
        )
        record.findings.append(finding)
        targets = [NtsRecordService._build_target(finding.id, target) for target in spec.targets]
        for target in targets:
            finding.targets.append(target)
        await db.flush()

        audit_state.add_event(
            db,
            audit_state.build_event(
                record=record,
                record_version=version,
                entity_type=AuditEntityType.FINDING,
                entity_id=finding.id,
                action=AuditAction.FINDING_CREATED,
                changed_by=actor_id,
                new_state=audit_state.finding_state(finding, targets=targets),
            ),
        )
        await db.flush()
        return finding

    @staticmethod
    async def update_finding_attributes(
        db: AsyncSession,
        clinic_id: UUID,
        record_id: UUID,
        finding_id: UUID,
        *,
        expected_version: int,
        actor_id: UUID,
        attributes: Mapping[str, Any],
    ) -> NtsFinding:
        """Replace a finding's attributes. Identity and provenance are fixed."""
        record = await NtsRecordService.get_record(db, clinic_id, record_id)
        finding = NtsRecordService._find(record, finding_id)
        rule = NtsRecordService._require_rule(finding.rule_id, record.norm_version)
        NtsRecordService._require_valid(rule, attributes, finding.targets)

        version = await NtsRecordService._compare_and_bump(db, clinic_id, record, expected_version)
        previous = audit_state.finding_state(finding)
        finding.attributes = dict(attributes)
        await db.flush()

        audit_state.add_event(
            db,
            audit_state.build_event(
                record=record,
                record_version=version,
                entity_type=AuditEntityType.FINDING,
                entity_id=finding.id,
                action=AuditAction.FINDING_UPDATED,
                changed_by=actor_id,
                previous_state=previous,
                new_state=audit_state.finding_state(finding),
            ),
        )
        await db.flush()
        return finding

    @staticmethod
    async def replace_targets(
        db: AsyncSession,
        clinic_id: UUID,
        record_id: UUID,
        finding_id: UUID,
        *,
        expected_version: int,
        actor_id: UUID,
        targets: Sequence[TargetSpec],
    ) -> NtsFinding:
        """Swap the whole target set at once.

        The new set is validated in full *before* anything is written, so
        the finding never passes through a partially valid state, and the
        whole change costs one version bump however many targets move.
        """
        record = await NtsRecordService.get_record(db, clinic_id, record_id)
        finding = NtsRecordService._find(record, finding_id)
        rule = NtsRecordService._require_rule(finding.rule_id, record.norm_version)
        NtsRecordService._require_valid(rule, finding.attributes, targets)

        version = await NtsRecordService._compare_and_bump(db, clinic_id, record, expected_version)
        previous = audit_state.finding_state(finding)

        finding.targets.clear()
        await db.flush()

        replacements = [NtsRecordService._build_target(finding.id, target) for target in targets]
        for target in replacements:
            finding.targets.append(target)
        await db.flush()

        audit_state.add_event(
            db,
            audit_state.build_event(
                record=record,
                record_version=version,
                entity_type=AuditEntityType.TARGET,
                entity_id=finding.id,
                action=AuditAction.TARGET_CHANGED,
                changed_by=actor_id,
                previous_state=previous,
                new_state=audit_state.finding_state(finding, targets=replacements),
            ),
        )
        await db.flush()
        return finding

    @staticmethod
    async def remove_finding(
        db: AsyncSession,
        clinic_id: UUID,
        record_id: UUID,
        finding_id: UUID,
        *,
        expected_version: int,
        actor_id: UUID,
    ) -> None:
        """Delete a finding from a draft, preserving what it was."""
        record = await NtsRecordService.get_record(db, clinic_id, record_id)
        finding = NtsRecordService._find(record, finding_id)

        version = await NtsRecordService._compare_and_bump(db, clinic_id, record, expected_version)
        linked = [s for s in record.specifications if s.finding_id == finding.id]
        # Captured before the cascade removes them; afterwards there is
        # nothing left to describe.
        previous = audit_state.finding_state(
            finding, targets=list(finding.targets), linked_specifications=linked
        )

        try:
            async with db.begin_nested():
                record.findings.remove(finding)
                await db.flush()
        except IntegrityError as exc:
            raise NtsStateConflictError(
                "this finding cannot be removed: another finding was carried forward from it"
            ) from exc

        audit_state.add_event(
            db,
            audit_state.build_event(
                record=record,
                record_version=version,
                entity_type=AuditEntityType.FINDING,
                entity_id=finding_id,
                action=AuditAction.FINDING_REMOVED,
                changed_by=actor_id,
                previous_state=previous,
            ),
        )
        await db.flush()

    @staticmethod
    async def confirm_carried_forward(
        db: AsyncSession,
        clinic_id: UUID,
        record_id: UUID,
        finding_id: UUID,
        *,
        expected_version: int,
        actor_id: UUID,
    ) -> NtsFinding:
        """Confirm one carried-forward finding as observed today.

        Individual on purpose. There is no bulk equivalent: a single
        "confirm all" would turn reviewed carry-forward back into blind
        copying, and the record would assert observations nobody made.
        """
        record = await NtsRecordService.get_record(db, clinic_id, record_id)
        finding = NtsRecordService._find(record, finding_id)
        if finding.provenance != FindingProvenance.CARRIED_FORWARD.value:
            raise NtsStateConflictError(
                f"finding {finding_id} is {finding.provenance}, not carried_forward"
            )

        version = await NtsRecordService._compare_and_bump(db, clinic_id, record, expected_version)
        previous = audit_state.finding_state(finding)
        # source_finding_id is kept: the provenance trail outlives the review.
        finding.provenance = FindingProvenance.OBSERVED.value
        await db.flush()

        audit_state.add_event(
            db,
            audit_state.build_event(
                record=record,
                record_version=version,
                entity_type=AuditEntityType.FINDING,
                entity_id=finding.id,
                action=AuditAction.CARRIED_FORWARD_CONFIRMED,
                changed_by=actor_id,
                previous_state=previous,
                new_state=audit_state.finding_state(finding),
            ),
        )
        await db.flush()
        return finding

    # ------------------------------------------------------------------
    # specifications
    # ------------------------------------------------------------------

    @staticmethod
    async def set_specification(
        db: AsyncSession,
        clinic_id: UUID,
        record_id: UUID,
        *,
        expected_version: int,
        actor_id: UUID,
        text: str,
        finding_id: UUID | None = None,
        specification_id: UUID | None = None,
    ) -> NtsRecordSpecification:
        """Create or update one Especificaciones entry (NTS §5.14).

        Never merged with ``observations`` (§5.15) and never folded into a
        finding's attributes: three different normative channels.
        """
        record = await NtsRecordService.get_record(db, clinic_id, record_id)
        if finding_id is not None:
            NtsRecordService._find(record, finding_id)
        if not text or not text.strip():
            raise NtsClinicalValidationError(["specification text must not be blank"])

        version = await NtsRecordService._compare_and_bump(db, clinic_id, record, expected_version)

        previous: dict[str, Any] | None = None
        if specification_id is None:
            specification = NtsRecordSpecification(
                id=uuid4(),
                record_id=record.id,
                finding_id=finding_id,
                text=text,
                sequence=1 + max((s.sequence for s in record.specifications), default=0),
            )
            record.specifications.append(specification)
        else:
            specification = NtsRecordService._specification(record, specification_id)
            previous = audit_state.specification_state(specification)
            specification.finding_id = finding_id
            specification.text = text
        await db.flush()

        audit_state.add_event(
            db,
            audit_state.build_event(
                record=record,
                record_version=version,
                entity_type=AuditEntityType.SPECIFICATION,
                entity_id=specification.id,
                action=AuditAction.SPECIFICATION_CHANGED,
                changed_by=actor_id,
                previous_state=previous,
                new_state=audit_state.specification_state(specification),
            ),
        )
        await db.flush()
        return specification

    @staticmethod
    async def remove_specification(
        db: AsyncSession,
        clinic_id: UUID,
        record_id: UUID,
        specification_id: UUID,
        *,
        expected_version: int,
        actor_id: UUID,
    ) -> None:
        record = await NtsRecordService.get_record(db, clinic_id, record_id)
        specification = NtsRecordService._specification(record, specification_id)

        version = await NtsRecordService._compare_and_bump(db, clinic_id, record, expected_version)
        previous = audit_state.specification_state(specification)
        record.specifications.remove(specification)
        await db.flush()

        audit_state.add_event(
            db,
            audit_state.build_event(
                record=record,
                record_version=version,
                entity_type=AuditEntityType.SPECIFICATION,
                entity_id=specification_id,
                action=AuditAction.SPECIFICATION_CHANGED,
                changed_by=actor_id,
                previous_state=previous,
            ),
        )
        await db.flush()

    # ------------------------------------------------------------------
    # terminal transitions
    # ------------------------------------------------------------------

    @staticmethod
    async def discard(
        db: AsyncSession,
        clinic_id: UUID,
        record_id: UUID,
        *,
        expected_version: int,
        actor_id: UUID,
        reason: str,
    ) -> NtsOdontogramRecord:
        """Abandon a draft. Nothing is deleted, ever."""
        if not reason or not reason.strip():
            raise NtsClinicalValidationError(["a discard reason is required"])

        record = await NtsRecordService.get_record(db, clinic_id, record_id)
        version = await NtsRecordService._compare_and_bump(db, clinic_id, record, expected_version)
        previous = audit_state.record_lifecycle_state(record)

        record.status = RecordStatus.DISCARDED.value
        record.discarded_at = datetime.now(UTC)
        record.discarded_by = actor_id
        record.discard_reason = reason
        # content_hash stays NULL: a discarded record attests nothing.
        await db.flush()

        audit_state.add_event(
            db,
            audit_state.build_event(
                record=record,
                record_version=version,
                entity_type=AuditEntityType.RECORD,
                entity_id=record.id,
                action=AuditAction.DISCARDED,
                changed_by=actor_id,
                previous_state=previous,
                new_state=audit_state.record_lifecycle_state(record),
            ),
        )
        await db.flush()
        return record

    @staticmethod
    async def finalize(
        db: AsyncSession,
        clinic_id: UUID,
        record_id: UUID,
        *,
        expected_version: int,
        actor_id: UUID,
    ) -> NtsOdontogramRecord:
        """Lock the clinical snapshot and stamp its integrity digest.

        `finalized` means DentalPin locked the record. It does **not** mean
        the document is digitally signed, and no compliance or accreditation
        is claimed (ADR 0022 §10).
        """
        record = await NtsRecordService.get_record(db, clinic_id, record_id)
        version = await NtsRecordService._compare_and_bump(db, clinic_id, record, expected_version)

        await NtsRecordService._run_finalize_gates(db, record)
        name, role, professional_id = await NtsRecordService._authorship(db, record)

        # No flush between setting the status and storing the hash: the DB
        # CHECK requires status='finalized' and the hash triple together.
        with db.no_autoflush:
            record.recorded_by_name = name
            record.recorded_by_role = role
            record.recorded_by_professional_id = professional_id
            record.finalized_at = datetime.now(UTC)
            record.finalized_by = actor_id
            record.status = RecordStatus.FINALIZED.value

            record.content_hash = sha256_canonical_v1(record)
            record.hash_algorithm = HASH_ALGORITHM_SHA256
            record.canonicalization_version = CANONICALIZATION_VERSION_V1

        audit_state.add_event(
            db,
            audit_state.build_event(
                record=record,
                record_version=version,
                entity_type=AuditEntityType.RECORD,
                entity_id=record.id,
                action=AuditAction.FINALIZED,
                changed_by=actor_id,
                new_state=audit_state.record_lifecycle_state(record),
            ),
        )

        if record.supersedes_record_id is not None:
            # Written against the *new* record. The predecessor is never
            # touched; its supersession is read through the inverse relation.
            audit_state.add_event(
                db,
                audit_state.build_event(
                    record=record,
                    record_version=version,
                    entity_type=AuditEntityType.RECORD,
                    entity_id=record.id,
                    action=AuditAction.SUPERSESSION_RECORDED,
                    changed_by=actor_id,
                    new_state={
                        "supersedes_record_id": str(record.supersedes_record_id),
                        "supersession_reason": record.supersession_reason,
                    },
                ),
            )

        try:
            async with db.begin_nested():
                await db.flush()
        except IntegrityError as exc:
            if "uq_nts_record_linear_chain" in str(exc.orig):
                raise NtsStateConflictError(
                    "another finalized record already supersedes that predecessor"
                ) from exc
            raise
        return record

    # ------------------------------------------------------------------
    # internals
    # ------------------------------------------------------------------

    @staticmethod
    async def _compare_and_bump(
        db: AsyncSession,
        clinic_id: UUID,
        record: NtsOdontogramRecord,
        expected_version: int,
    ) -> int:
        """Bump the parent's version, or raise. The core of §6 of ADR 0022.

        One statement detects the conflict, increments the version and takes
        a row-level lock that serialises concurrent child mutations for the
        rest of the transaction.
        """
        stmt = (
            update(NtsOdontogramRecord)
            .where(
                NtsOdontogramRecord.id == record.id,
                NtsOdontogramRecord.clinic_id == clinic_id,
                NtsOdontogramRecord.version == expected_version,
                NtsOdontogramRecord.status == RecordStatus.DRAFT.value,
            )
            .values(version=NtsOdontogramRecord.version + 1, updated_at=datetime.now(UTC))
            .returning(NtsOdontogramRecord.version)
            .execution_options(synchronize_session=False)
        )
        with db.no_autoflush:
            new_version = (await db.execute(stmt)).scalar_one_or_none()

        if new_version is None:
            await NtsRecordService._raise_bump_failure(db, clinic_id, record.id, expected_version)

        # Keep the identity map honest: without this the ORM still believes
        # the old version and a later flush could write it back.
        set_committed_value(record, "version", new_version)
        db.expire(record, ["updated_at"])
        return new_version

    @staticmethod
    async def _raise_bump_failure(
        db: AsyncSession, clinic_id: UUID, record_id: UUID, expected_version: int
    ) -> None:
        stmt = select(NtsOdontogramRecord.version, NtsOdontogramRecord.status).where(
            NtsOdontogramRecord.id == record_id,
            NtsOdontogramRecord.clinic_id == clinic_id,
        )
        with db.no_autoflush:
            row = (await db.execute(stmt)).one_or_none()

        if row is None:
            raise NtsRecordNotFoundError(f"NTS record {record_id} not found in this clinic")
        version, status = row
        if status != RecordStatus.DRAFT.value:
            raise NtsStateConflictError(
                f"NTS record {record_id} is {status} and can no longer be modified"
            )
        raise NtsVersionConflictError(
            f"expected version {expected_version}, stored version is {version}"
        )

    @staticmethod
    async def _run_finalize_gates(db: AsyncSession, record: NtsOdontogramRecord) -> None:
        """Every clinical gate, reported together.

        A record with zero findings is valid: the norm records findings, not
        health, so no minimum is invented.
        """
        errors: list[str] = []

        pending = [
            f for f in record.findings if f.provenance == FindingProvenance.CARRIED_FORWARD.value
        ]
        if pending:
            errors.append(
                f"{len(pending)} carried-forward finding(s) still need individual "
                "review before this record can be finalized"
            )

        by_finding: dict[UUID, list[str | None]] = {}
        for specification in record.specifications:
            if specification.finding_id is not None:
                by_finding.setdefault(specification.finding_id, []).append(specification.text)

        for finding in record.findings:
            try:
                rule = get_nts_rule(finding.rule_id, finding.norm_version)
            except CatalogNotFoundError as exc:
                errors.append(str(exc))
                continue
            errors.extend(validation.validate_attributes(rule, finding.attributes))
            errors.extend(validation.validate_targets(rule, list(finding.targets)))
            errors.extend(
                validation.validate_specification_requirements(
                    rule, finding.attributes, by_finding.get(finding.id, [])
                )
            )

        if record.supersedes_record_id is not None:
            await NtsRecordService._validate_predecessor(
                db,
                record.clinic_id,
                record.supersedes_record_id,
                patient_id=record.patient_id,
                norm_version=record.norm_version,
                exclude_id=record.id,
            )

        if errors:
            raise NtsClinicalValidationError(errors)

    @staticmethod
    async def _authorship(
        db: AsyncSession, record: NtsOdontogramRecord
    ) -> tuple[str | None, str | None, str | None]:
        """Freeze who recorded this document.

        The snapshot describes the record's ``recorded_by``, even when
        somebody else presses finalize. It is product traceability, not a
        signature. Missing sources stay NULL rather than being invented.
        """
        user = await db.get(User, record.recorded_by)
        membership = (
            await db.execute(
                select(ClinicMembership.role).where(
                    ClinicMembership.user_id == record.recorded_by,
                    ClinicMembership.clinic_id == record.clinic_id,
                )
            )
        ).scalar_one_or_none()

        if user is None:
            return None, membership, None
        name = f"{user.first_name} {user.last_name}".strip() or None
        return name, membership, user.professional_id

    @staticmethod
    async def _validate_predecessor(
        db: AsyncSession,
        clinic_id: UUID,
        predecessor_id: UUID,
        *,
        patient_id: UUID,
        norm_version: str,
        exclude_id: UUID | None = None,
    ) -> NtsOdontogramRecord:
        predecessor = (
            await db.execute(
                select(NtsOdontogramRecord).where(
                    NtsOdontogramRecord.id == predecessor_id,
                    NtsOdontogramRecord.clinic_id == clinic_id,
                )
            )
        ).scalar_one_or_none()
        if predecessor is None:
            raise NtsRecordNotFoundError(
                f"record to supersede {predecessor_id} not found in this clinic"
            )

        problems: list[str] = []
        if predecessor.patient_id != patient_id:
            problems.append("the record to supersede belongs to another patient")
        if predecessor.norm_version != norm_version:
            problems.append("the record to supersede uses another norm version")
        if problems:
            raise NtsClinicalValidationError(problems)
        if predecessor.status != RecordStatus.FINALIZED.value:
            raise NtsStateConflictError(
                f"only a finalized record can be superseded; that one is {predecessor.status}"
            )

        successor_stmt = select(NtsOdontogramRecord.id).where(
            NtsOdontogramRecord.supersedes_record_id == predecessor_id,
            NtsOdontogramRecord.status == RecordStatus.FINALIZED.value,
        )
        if exclude_id is not None:
            successor_stmt = successor_stmt.where(NtsOdontogramRecord.id != exclude_id)
        if (await db.execute(successor_stmt)).first() is not None:
            raise NtsStateConflictError(
                "that record has already been superseded by another finalized record"
            )
        return predecessor

    @staticmethod
    def _require_rule(rule_id: str, norm_version: str) -> NtsRule:
        try:
            return get_nts_rule(rule_id, norm_version)
        except CatalogNotFoundError as exc:
            raise NtsClinicalValidationError([str(exc)]) from exc

    @staticmethod
    def _require_known_norm(norm_version: str) -> None:
        from app.modules.odontogram.nts.catalog import get_nts_catalog

        try:
            get_nts_catalog(norm_version)
        except CatalogNotFoundError as exc:
            raise NtsClinicalValidationError([str(exc)]) from exc

    @staticmethod
    def _require_valid(
        rule: NtsRule, attributes: Mapping[str, Any], targets: Sequence[Any]
    ) -> None:
        errors = validation.validate_attributes(rule, attributes)
        errors.extend(validation.validate_targets(rule, list(targets)))
        if errors:
            raise NtsClinicalValidationError(errors)

    @staticmethod
    def _build_target(finding_id: UUID, spec: TargetSpec) -> NtsFindingTarget:
        return NtsFindingTarget(
            id=uuid4(),
            finding_id=finding_id,
            group_index=spec.group_index,
            position=spec.position,
            participation=spec.participation,
            role=spec.role,
            target_kind=spec.target_kind,
            tooth_number=spec.tooth_number,
            arch=spec.arch,
            local_ordinal=spec.local_ordinal,
            geometry=spec.geometry,
        )

    @staticmethod
    def _find(record: NtsOdontogramRecord, finding_id: UUID) -> NtsFinding:
        finding = next((f for f in record.findings if f.id == finding_id), None)
        if finding is None:
            raise NtsRecordNotFoundError(
                f"finding {finding_id} does not belong to record {record.id}"
            )
        return finding

    @staticmethod
    def _specification(
        record: NtsOdontogramRecord, specification_id: UUID
    ) -> NtsRecordSpecification:
        specification = next((s for s in record.specifications if s.id == specification_id), None)
        if specification is None:
            raise NtsRecordNotFoundError(
                f"specification {specification_id} does not belong to record {record.id}"
            )
        return specification

    @staticmethod
    def _aggregate_query():
        # populate_existing: the identity map may already hold this record
        # with collections loaded before the latest mutation. Without it a
        # caller running with ``expire_on_commit=False`` would keep reading a
        # stale aggregate.
        return (
            select(NtsOdontogramRecord)
            .options(
                selectinload(NtsOdontogramRecord.findings).selectinload(NtsFinding.targets),
                selectinload(NtsOdontogramRecord.specifications),
            )
            .execution_options(populate_existing=True)
        )

    @staticmethod
    async def _load_aggregate(
        db: AsyncSession, clinic_id: UUID, record_id: UUID
    ) -> NtsOdontogramRecord | None:
        stmt = NtsRecordService._aggregate_query().where(
            NtsOdontogramRecord.id == record_id,
            NtsOdontogramRecord.clinic_id == clinic_id,
        )
        return (await db.execute(stmt)).unique().scalar_one_or_none()

    @staticmethod
    async def _specifications_by_finding(
        db: AsyncSession, record_id: UUID
    ) -> dict[UUID, list[NtsRecordSpecification]]:
        rows = (
            (
                await db.execute(
                    select(NtsRecordSpecification).where(
                        NtsRecordSpecification.record_id == record_id,
                        NtsRecordSpecification.finding_id.is_not(None),
                    )
                )
            )
            .scalars()
            .all()
        )
        grouped: dict[UUID, list[NtsRecordSpecification]] = {}
        for row in rows:
            grouped.setdefault(row.finding_id, []).append(row)
        return grouped
