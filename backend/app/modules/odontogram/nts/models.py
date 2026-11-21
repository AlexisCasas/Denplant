"""NTS clinical record models — the five tables of ADR 0021.

```
nts_odontogram_records ─┬─ N nts_findings ──── N nts_finding_targets
                        ├─ N nts_record_specifications
                        └─ N nts_record_audit_events   (append-only)
```

Contract: ``docs/technical/odontogram/nts-record-model.md``. That document
is authoritative; this module implements it.

Two rules the database itself enforces, and one it deliberately does not:

* **Structure and lifecycle** are enforced here — status/stage domains,
  coherence triples, FDI validity, target-kind column coherence, the
  one-draft and linear-chain partial indexes, immutability triggers.
* **Normative meaning** is *not*. Whether ``rule_id`` exists, whether
  ``attributes`` match the rule's ``AttributeDef`` set, whether a scope
  allows two anchors — all of that is validated by the service against the
  versioned catalog. Encoding it in DDL would be a second hand-maintained
  copy of the norm, which NTS-03 forbade.

The Original profile (``ToothRecord``, ``Treatment``, ``TreatmentTooth``,
``OdontogramHistory``) is not touched, not read and not written.
"""

from __future__ import annotations

from datetime import datetime
from typing import TYPE_CHECKING
from uuid import uuid4

from sqlalchemy import (
    DDL,
    CheckConstraint,
    DateTime,
    ForeignKey,
    ForeignKeyConstraint,
    Index,
    Integer,
    String,
    Text,
    UniqueConstraint,
    event,
)
from sqlalchemy import text as sa_text
from sqlalchemy.dialects.postgresql import JSONB, UUID
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.database import Base, TimestampMixin

from ..constants import Arch
from .constants import (
    AuditAction,
    AuditEntityType,
    FindingProvenance,
    RecordStage,
    RecordStatus,
    TargetKind,
    TargetParticipation,
    sql_in_clause,
)

if TYPE_CHECKING:
    from app.core.auth.models import Clinic, User
    from app.modules.patients.models import Patient


#: FDI "Sistema Dígito Dos" as the norm defines it: quadrants 1-4 carry
#: teeth 1-8 (permanent), quadrants 5-8 carry teeth 1-5 (deciduous). The
#: periodontogram's equivalent CHECK covers permanent teeth only; NTS
#: N.° 188 charts deciduous dentition too, so this expression covers both.
_FDI_TOOTH_EXPRESSION = (
    "((tooth_number / 10) BETWEEN 1 AND 4 AND (tooth_number % 10) BETWEEN 1 AND 8)"
    " OR "
    "((tooth_number / 10) BETWEEN 5 AND 8 AND (tooth_number % 10) BETWEEN 1 AND 5)"
)


class NtsOdontogramRecord(Base, TimestampMixin):
    """One clinical odontogram document under one norm version.

    A dated, authored snapshot of what was observed. ``draft`` is the
    editable working state; ``finalized`` and ``discarded`` are terminal
    and enforced by :data:`_RECORD_GUARD_TRIGGER`.

    There is deliberately no ``profile`` column: for an NTS record the
    profile *is* the ``norm_version``.
    """

    __tablename__ = "nts_odontogram_records"

    id: Mapped[UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid4)
    clinic_id: Mapped[UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("clinics.id"), nullable=False
    )
    patient_id: Mapped[UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("patients.id"), nullable=False
    )

    # Frozen at creation; a historical record is never reinterpreted by a
    # later catalog.
    norm_version: Mapped[str] = mapped_column(String(50), nullable=False)

    stage: Mapped[str] = mapped_column(String(20), nullable=False)
    stage_label: Mapped[str | None] = mapped_column(String(200))

    status: Mapped[str] = mapped_column(String(20), nullable=False)

    # Optimistic locking. Bumped by the service before every mutation of the
    # record or any of its children (nts-record-model.md §6).
    version: Mapped[int] = mapped_column(Integer, nullable=False, default=1)

    # NTS §5.15 — findings outside the nomenclature. Specifications (§5.14)
    # are rows in `nts_record_specifications`; the two are never merged.
    observations: Mapped[str | None] = mapped_column(Text)

    recorded_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    recorded_by: Mapped[UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("users.id"), nullable=False
    )

    finalized_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    finalized_by: Mapped[UUID | None] = mapped_column(UUID(as_uuid=True), ForeignKey("users.id"))

    discarded_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    discarded_by: Mapped[UUID | None] = mapped_column(UUID(as_uuid=True), ForeignKey("users.id"))
    discard_reason: Mapped[str | None] = mapped_column(Text)

    # Authorship snapshot, frozen at finalize. Product traceability, NOT a
    # digital signature (ADR 0022 §9-§10). Stored rather than joined: a live
    # join would change the canonical digest when a user is renamed.
    recorded_by_name: Mapped[str | None] = mapped_column(String(200))
    recorded_by_role: Mapped[str | None] = mapped_column(String(30))
    recorded_by_professional_id: Mapped[str | None] = mapped_column(String(50))

    # Correction chain. The predecessor is never touched; "superseded" is
    # derived through this relation, never a stored status.
    supersedes_record_id: Mapped[UUID | None] = mapped_column(
        UUID(as_uuid=True), ForeignKey("nts_odontogram_records.id")
    )
    supersession_reason: Mapped[str | None] = mapped_column(Text)

    # Integrity (nts-record-model.md §10). No previous_hash, no chain
    # between records, no signature.
    content_hash: Mapped[str | None] = mapped_column(String(64))
    hash_algorithm: Mapped[str | None] = mapped_column(String(20))
    canonicalization_version: Mapped[int | None] = mapped_column(Integer)

    clinic: Mapped[Clinic] = relationship()
    patient: Mapped[Patient] = relationship()
    recorder: Mapped[User] = relationship(foreign_keys=[recorded_by])
    finalizer: Mapped[User | None] = relationship(foreign_keys=[finalized_by])
    discarder: Mapped[User | None] = relationship(foreign_keys=[discarded_by])
    supersedes: Mapped[NtsOdontogramRecord | None] = relationship(
        remote_side=[id], foreign_keys=[supersedes_record_id]
    )
    findings: Mapped[list[NtsFinding]] = relationship(
        back_populates="record", cascade="all, delete-orphan"
    )
    specifications: Mapped[list[NtsRecordSpecification]] = relationship(
        back_populates="record", cascade="all, delete-orphan"
    )

    __table_args__ = (
        CheckConstraint(sql_in_clause("status", RecordStatus), name="ck_nts_record_status"),
        CheckConstraint(sql_in_clause("stage", RecordStage), name="ck_nts_record_stage"),
        CheckConstraint(
            "stage <> 'other' OR stage_label IS NOT NULL",
            name="ck_nts_record_stage_label",
        ),
        CheckConstraint("version >= 1", name="ck_nts_record_version_positive"),
        CheckConstraint(
            "(status = 'finalized') = (finalized_at IS NOT NULL AND finalized_by IS NOT NULL)",
            name="ck_nts_record_finalized_pair",
        ),
        CheckConstraint(
            "(status = 'discarded') = "
            "(discarded_at IS NOT NULL AND discarded_by IS NOT NULL "
            "AND discard_reason IS NOT NULL)",
            name="ck_nts_record_discarded_triple",
        ),
        CheckConstraint(
            "(status = 'finalized') = "
            "(content_hash IS NOT NULL AND hash_algorithm IS NOT NULL "
            "AND canonicalization_version IS NOT NULL)",
            name="ck_nts_record_hash_triple",
        ),
        # Shape only. The digest itself is never computed in SQL.
        CheckConstraint(
            "content_hash IS NULL OR content_hash ~ '^[0-9a-f]{64}$'",
            name="ck_nts_record_hash_format",
        ),
        CheckConstraint(
            "canonicalization_version IS NULL OR canonicalization_version >= 1",
            name="ck_nts_record_canon_version",
        ),
        CheckConstraint(
            "(supersedes_record_id IS NULL) = (supersession_reason IS NULL)",
            name="ck_nts_record_supersession_pair",
        ),
        CheckConstraint(
            "supersedes_record_id IS DISTINCT FROM id",
            name="ck_nts_record_no_self_supersede",
        ),
        # Target of the composite FK from nts_findings: makes a finding
        # whose norm_version differs from its record's impossible.
        UniqueConstraint("id", "norm_version", name="uq_nts_record_id_norm_version"),
        # At most one draft per patient per norm version.
        Index(
            "uq_nts_record_one_draft",
            "clinic_id",
            "patient_id",
            "norm_version",
            unique=True,
            postgresql_where=sa_text("status = 'draft'"),
        ),
        # Linear correction chain: at most one finalized successor per
        # record, so "which record is current?" always has one answer.
        Index(
            "uq_nts_record_linear_chain",
            "supersedes_record_id",
            unique=True,
            postgresql_where=sa_text("status = 'finalized' AND supersedes_record_id IS NOT NULL"),
        ),
        Index("idx_nts_records_clinic_patient", "clinic_id", "patient_id"),
        Index("idx_nts_records_patient_status", "patient_id", "status"),
    )


class NtsFinding(Base):
    """One observed clinical finding citing one catalog rule.

    No link to ``Treatment``, no persisted colour and no free-text notes:
    a finding is not a procedure (NTS §5.8), colour is derived from the
    catalog, and prose belongs to Especificaciones/Observaciones.
    """

    __tablename__ = "nts_findings"

    id: Mapped[UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid4)
    # No standalone FK on record_id: the composite `fk_nts_finding_record_norm`
    # below already guarantees parent existence, norm_version equality and the
    # cascade. Both columns are NOT NULL, so MATCH SIMPLE never short-circuits
    # and a second constraint would only duplicate the check, split the ORM
    # join into two paths and widen the migration surface.
    record_id: Mapped[UUID] = mapped_column(UUID(as_uuid=True), nullable=False)
    # Carried physically for indexing; the composite FK pins it to the
    # record's own norm_version.
    norm_version: Mapped[str] = mapped_column(String(50), nullable=False)

    rule_id: Mapped[str] = mapped_column(String(20), nullable=False)
    attributes: Mapped[dict] = mapped_column(JSONB, nullable=False, default=dict)

    provenance: Mapped[str] = mapped_column(String(20), nullable=False)
    source_finding_id: Mapped[UUID | None] = mapped_column(
        UUID(as_uuid=True), ForeignKey("nts_findings.id", ondelete="RESTRICT")
    )

    sequence: Mapped[int] = mapped_column(Integer, nullable=False)

    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    created_by: Mapped[UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("users.id"), nullable=False
    )

    record: Mapped[NtsOdontogramRecord] = relationship(back_populates="findings")
    targets: Mapped[list[NtsFindingTarget]] = relationship(
        back_populates="finding", cascade="all, delete-orphan"
    )

    __table_args__ = (
        ForeignKeyConstraint(
            ["record_id", "norm_version"],
            ["nts_odontogram_records.id", "nts_odontogram_records.norm_version"],
            name="fk_nts_finding_record_norm",
            ondelete="CASCADE",
        ),
        CheckConstraint(
            sql_in_clause("provenance", FindingProvenance),
            name="ck_nts_finding_provenance",
        ),
        CheckConstraint(
            "jsonb_typeof(attributes) = 'object'",
            name="ck_nts_finding_attributes_object",
        ),
        CheckConstraint("sequence >= 0", name="ck_nts_finding_sequence_nonneg"),
        UniqueConstraint("record_id", "sequence", name="uq_nts_finding_record_sequence"),
        # Target of the composite FK from nts_record_specifications.
        UniqueConstraint("id", "record_id", name="uq_nts_finding_id_record"),
        Index("idx_nts_findings_rule", "record_id", "rule_id"),
        Index("idx_nts_findings_source", "source_finding_id"),
    )


class NtsFindingTarget(Base):
    """What a finding is about, and what merely positions it.

    ``participation`` is binary on purpose. The direct/relational
    distinction belongs to the rule's ``scope`` in the catalog and is
    derived at query time, never stored here.
    """

    __tablename__ = "nts_finding_targets"

    id: Mapped[UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid4)
    finding_id: Mapped[UUID] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("nts_findings.id", ondelete="CASCADE"),
        nullable=False,
    )

    # One finding may cover disjoint stretches of the arch (6.1.31).
    group_index: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    position: Mapped[int] = mapped_column(Integer, nullable=False, default=0)

    participation: Mapped[str] = mapped_column(String(20), nullable=False)
    role: Mapped[str | None] = mapped_column(String(30))

    target_kind: Mapped[str] = mapped_column(String(20), nullable=False)
    tooth_number: Mapped[int | None] = mapped_column(Integer)
    arch: Mapped[str | None] = mapped_column(String(10))
    local_ordinal: Mapped[int | None] = mapped_column(Integer)

    # Reserved. GEOMETRY CONTRACT PENDING: the column exists so the shape is
    # settled, but `ck_nts_target_geometry_pending` keeps it NULL until the
    # coordinate contract and canonicalization version 2 land.
    #
    # none_as_null: without it SQLAlchemy stores Python None as the JSON
    # value `null`, which is not SQL NULL — `geometry IS NULL` would then be
    # false and the CHECK above would reject a target that set the field
    # explicitly.
    geometry: Mapped[dict | None] = mapped_column(JSONB(none_as_null=True))

    finding: Mapped[NtsFinding] = relationship(back_populates="targets")

    __table_args__ = (
        CheckConstraint(
            sql_in_clause("participation", TargetParticipation),
            name="ck_nts_target_participation",
        ),
        CheckConstraint(sql_in_clause("target_kind", TargetKind), name="ck_nts_target_kind"),
        # Per-kind column coherence. No FDI sentinels: an unnumbered subject
        # has tooth_number NULL, never 0 or 99.
        CheckConstraint(
            "(target_kind = 'fdi_tooth' AND tooth_number IS NOT NULL "
            "AND arch IS NULL AND local_ordinal IS NULL) OR "
            "(target_kind = 'unnumbered_tooth' AND tooth_number IS NULL "
            "AND arch IS NULL) OR "
            "(target_kind = 'arch' AND tooth_number IS NULL "
            "AND arch IS NOT NULL AND local_ordinal IS NULL)",
            name="ck_nts_target_kind_columns",
        ),
        CheckConstraint(
            f"tooth_number IS NULL OR ({_FDI_TOOTH_EXPRESSION})",
            name="ck_nts_target_fdi",
        ),
        CheckConstraint(
            sql_in_clause("arch", Arch) + " OR arch IS NULL",
            name="ck_nts_target_arch_value",
        ),
        CheckConstraint("group_index >= 0", name="ck_nts_target_group_index_nonneg"),
        CheckConstraint("position >= 0", name="ck_nts_target_position_nonneg"),
        CheckConstraint(
            "local_ordinal IS NULL OR local_ordinal >= 1",
            name="ck_nts_target_local_ordinal",
        ),
        # GEOMETRY CONTRACT PENDING. While canonicalization version 1 is the
        # only one implemented, a stored shape would be unhashable and
        # therefore unfinalizable — so persisting one is refused at write
        # time rather than at finalize. A future migration drops this CHECK
        # together with the arrival of version 2.
        CheckConstraint("geometry IS NULL", name="ck_nts_target_geometry_pending"),
        UniqueConstraint(
            "finding_id", "group_index", "position", name="uq_nts_target_finding_slot"
        ),
        Index("idx_nts_targets_tooth", "tooth_number", "participation"),
    )


class NtsRecordSpecification(Base):
    """NTS §5.14 *Especificaciones* — data the norm sends outside the boxes.

    Never concatenated with *Observaciones*, which is global Text on the
    record. ``finding_id`` is nullable so a general specification is
    possible, but when set it is guaranteed to belong to the same record by
    the composite foreign key.
    """

    __tablename__ = "nts_record_specifications"

    id: Mapped[UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid4)
    record_id: Mapped[UUID] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("nts_odontogram_records.id", ondelete="CASCADE"),
        nullable=False,
    )
    finding_id: Mapped[UUID | None] = mapped_column(UUID(as_uuid=True))
    text: Mapped[str] = mapped_column(Text, nullable=False)
    sequence: Mapped[int] = mapped_column(Integer, nullable=False)

    record: Mapped[NtsOdontogramRecord] = relationship(back_populates="specifications")

    __table_args__ = (
        # MATCH SIMPLE: with finding_id NULL the constraint is satisfied, so
        # a general specification stays legal; with finding_id set, both
        # columns must match one finding row — which forbids pointing at a
        # finding of another record without any normative logic in SQL.
        ForeignKeyConstraint(
            ["finding_id", "record_id"],
            ["nts_findings.id", "nts_findings.record_id"],
            name="fk_nts_spec_finding_same_record",
            ondelete="CASCADE",
        ),
        CheckConstraint("sequence >= 0", name="ck_nts_spec_sequence_nonneg"),
        UniqueConstraint("record_id", "sequence", name="uq_nts_spec_record_sequence"),
    )


class NtsRecordAuditEvent(Base):
    """Append-only trail of every persisted change, from the first write.

    Mirrors the repo's ``{entity}_history`` pattern with two deliberate
    deviations (ADR 0022 §5): ``ON DELETE RESTRICT`` instead of
    ``CASCADE``, because a clinical audit must not be destructible, and the
    added ``record_version``.

    NTS-04B.1 creates the table and its invariants only; automatic event
    generation from clinical operations belongs to the service layer.
    """

    __tablename__ = "nts_record_audit_events"

    id: Mapped[UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid4)
    clinic_id: Mapped[UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("clinics.id"), nullable=False
    )
    record_id: Mapped[UUID] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("nts_odontogram_records.id", ondelete="RESTRICT"),
        nullable=False,
    )
    # The record's version *after* the change this event describes.
    record_version: Mapped[int] = mapped_column(Integer, nullable=False)

    entity_type: Mapped[str] = mapped_column(String(20), nullable=False)
    entity_id: Mapped[UUID | None] = mapped_column(UUID(as_uuid=True))

    action: Mapped[str] = mapped_column(String(40), nullable=False)

    # none_as_null so "no previous state" is SQL NULL and stays findable with
    # `IS NULL`, rather than the JSON value `null`.
    previous_state: Mapped[dict | None] = mapped_column(JSONB(none_as_null=True))
    new_state: Mapped[dict | None] = mapped_column(JSONB(none_as_null=True))

    changed_by: Mapped[UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("users.id"), nullable=False
    )
    changed_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    notes: Mapped[str | None] = mapped_column(Text)

    __table_args__ = (
        CheckConstraint(
            sql_in_clause("entity_type", AuditEntityType),
            name="ck_nts_audit_entity_type",
        ),
        CheckConstraint(sql_in_clause("action", AuditAction), name="ck_nts_audit_action"),
        CheckConstraint("record_version >= 1", name="ck_nts_audit_record_version"),
        Index("idx_nts_audit_record_time", "record_id", "changed_at"),
        Index("idx_nts_audit_clinic_time", "clinic_id", "changed_at"),
    )


# ---------------------------------------------------------------------------
# Structural triggers
#
# These are the first triggers in the repository. They are intentionally
# tiny, carry no clinical logic and fabricate nothing: each only refuses an
# operation. They are attached to ``create_all`` here so the test database
# has them, and re-declared verbatim in migration ``odo_0004`` so that
# migration stays a frozen, self-contained snapshot.
# ---------------------------------------------------------------------------

#: One statement per DDL object: asyncpg prepares each statement and
#: refuses a multi-command string, so function and trigger are separate.
#:
#: The messages are built with ``USING MESSAGE =`` and concatenation rather
#: than ``RAISE ... , arg``: a literal ``%`` would be consumed as a printf
#: placeholder by SQLAlchemy's ``DDL`` construct, and keeping the SQL free of
#: ``%`` lets the migration reuse the exact same text.

RECORD_GUARD_FUNCTION_SQL = """
CREATE OR REPLACE FUNCTION nts_records_guard() RETURNS trigger AS $$
BEGIN
    IF TG_OP = 'DELETE' THEN
        RAISE EXCEPTION USING
            MESSAGE = 'NTS record ' || OLD.id || ' cannot be deleted',
            ERRCODE = 'restrict_violation';
    END IF;
    IF OLD.status <> 'draft' THEN
        RAISE EXCEPTION USING
            MESSAGE = 'NTS record ' || OLD.id || ' is ' || OLD.status
                      || ' and immutable',
            ERRCODE = 'restrict_violation';
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql
"""

RECORD_GUARD_TRIGGER_SQL = """
CREATE TRIGGER trg_nts_records_guard
BEFORE UPDATE OR DELETE ON nts_odontogram_records
FOR EACH ROW EXECUTE FUNCTION nts_records_guard()
"""

AUDIT_APPEND_ONLY_FUNCTION_SQL = """
CREATE OR REPLACE FUNCTION nts_audit_append_only() RETURNS trigger AS $$
BEGIN
    RAISE EXCEPTION USING
        MESSAGE = 'nts_record_audit_events is append-only (' || TG_OP
                  || ' refused)',
        ERRCODE = 'restrict_violation';
END;
$$ LANGUAGE plpgsql
"""

AUDIT_APPEND_ONLY_TRIGGER_SQL = """
CREATE TRIGGER trg_nts_audit_append_only
BEFORE UPDATE OR DELETE ON nts_record_audit_events
FOR EACH ROW EXECUTE FUNCTION nts_audit_append_only()
"""

for _table, _statements in (
    (NtsOdontogramRecord, (RECORD_GUARD_FUNCTION_SQL, RECORD_GUARD_TRIGGER_SQL)),
    (
        NtsRecordAuditEvent,
        (AUDIT_APPEND_ONLY_FUNCTION_SQL, AUDIT_APPEND_ONLY_TRIGGER_SQL),
    ),
):
    for _statement in _statements:
        event.listen(_table.__table__, "after_create", DDL(_statement))
