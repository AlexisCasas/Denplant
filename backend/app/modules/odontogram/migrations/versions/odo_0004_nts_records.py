"""odontogram — NTS clinical record persistence foundation.

Additive only: creates the five tables of ADR 0021 plus the two structural
triggers of ADR 0022. No existing table is touched, nothing is backfilled
and no data is seeded. The Original profile (``tooth_records``,
``treatments``, ``treatment_teeth``, ``odontogram_history``) is untouched.

Tables:

* ``nts_odontogram_records``    — one dated, authored clinical document
* ``nts_findings``              — observed findings citing a catalog rule
* ``nts_finding_targets``       — what a finding is about vs what positions it
* ``nts_record_specifications`` — NTS §5.14 Especificaciones
* ``nts_record_audit_events``   — append-only change trail

Triggers (the first in this repository, deliberately tiny — each only
refuses an operation and fabricates nothing):

* ``trg_nts_records_guard``     — a finalized/discarded record is terminal;
  no NTS record is ever physically deleted.
* ``trg_nts_audit_append_only`` — the audit trail takes INSERT only.

The trigger SQL is duplicated verbatim from
``app.modules.odontogram.nts.models`` on purpose: a migration must stay a
frozen snapshot and must not change when application code changes.

Structural constraints only. Normative meaning — whether ``rule_id``
exists, whether ``attributes`` match the rule, how many anchors a scope
allows — is validated by the service against the versioned catalog and is
deliberately absent from this DDL.

Revision ID: odo_0004
Revises: odo_0003
Create Date: 2026-09-17
"""

from collections.abc import Sequence

import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

from alembic import op

revision: str = "odo_0004"
down_revision: str | None = "odo_0003"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


# One statement per execute: asyncpg prepares each statement and refuses a
# multi-command string.

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


def upgrade() -> None:
    op.create_table(
        "nts_odontogram_records",
        sa.Column("id", sa.UUID(), nullable=False),
        sa.Column("clinic_id", sa.UUID(), nullable=False),
        sa.Column("patient_id", sa.UUID(), nullable=False),
        sa.Column("norm_version", sa.String(length=50), nullable=False),
        sa.Column("stage", sa.String(length=20), nullable=False),
        sa.Column("stage_label", sa.String(length=200), nullable=True),
        sa.Column("status", sa.String(length=20), nullable=False),
        sa.Column("version", sa.Integer(), nullable=False),
        sa.Column("observations", sa.Text(), nullable=True),
        sa.Column("recorded_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("recorded_by", sa.UUID(), nullable=False),
        sa.Column("finalized_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("finalized_by", sa.UUID(), nullable=True),
        sa.Column("discarded_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("discarded_by", sa.UUID(), nullable=True),
        sa.Column("discard_reason", sa.Text(), nullable=True),
        sa.Column("recorded_by_name", sa.String(length=200), nullable=True),
        sa.Column("recorded_by_role", sa.String(length=30), nullable=True),
        sa.Column("recorded_by_professional_id", sa.String(length=50), nullable=True),
        sa.Column("supersedes_record_id", sa.UUID(), nullable=True),
        sa.Column("supersession_reason", sa.Text(), nullable=True),
        sa.Column("content_hash", sa.String(length=64), nullable=True),
        sa.Column("hash_algorithm", sa.String(length=20), nullable=True),
        sa.Column("canonicalization_version", sa.Integer(), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
        sa.PrimaryKeyConstraint("id"),
        sa.ForeignKeyConstraint(["clinic_id"], ["clinics.id"]),
        sa.ForeignKeyConstraint(["patient_id"], ["patients.id"]),
        sa.ForeignKeyConstraint(["recorded_by"], ["users.id"]),
        sa.ForeignKeyConstraint(["finalized_by"], ["users.id"]),
        sa.ForeignKeyConstraint(["discarded_by"], ["users.id"]),
        sa.ForeignKeyConstraint(["supersedes_record_id"], ["nts_odontogram_records.id"]),
        sa.CheckConstraint(
            "status IN ('draft', 'discarded', 'finalized')",
            name="ck_nts_record_status",
        ),
        sa.CheckConstraint(
            "stage IN ('diagnosis', 'evolution', 'discharge', 'other')",
            name="ck_nts_record_stage",
        ),
        sa.CheckConstraint(
            "stage <> 'other' OR stage_label IS NOT NULL",
            name="ck_nts_record_stage_label",
        ),
        sa.CheckConstraint("version >= 1", name="ck_nts_record_version_positive"),
        sa.CheckConstraint(
            "(status = 'finalized') = (finalized_at IS NOT NULL AND finalized_by IS NOT NULL)",
            name="ck_nts_record_finalized_pair",
        ),
        sa.CheckConstraint(
            "(status = 'discarded') = "
            "(discarded_at IS NOT NULL AND discarded_by IS NOT NULL "
            "AND discard_reason IS NOT NULL)",
            name="ck_nts_record_discarded_triple",
        ),
        sa.CheckConstraint(
            "(status = 'finalized') = "
            "(content_hash IS NOT NULL AND hash_algorithm IS NOT NULL "
            "AND canonicalization_version IS NOT NULL)",
            name="ck_nts_record_hash_triple",
        ),
        sa.CheckConstraint(
            "content_hash IS NULL OR content_hash ~ '^[0-9a-f]{64}$'",
            name="ck_nts_record_hash_format",
        ),
        sa.CheckConstraint(
            "canonicalization_version IS NULL OR canonicalization_version >= 1",
            name="ck_nts_record_canon_version",
        ),
        sa.CheckConstraint(
            "(supersedes_record_id IS NULL) = (supersession_reason IS NULL)",
            name="ck_nts_record_supersession_pair",
        ),
        sa.CheckConstraint(
            "supersedes_record_id IS DISTINCT FROM id",
            name="ck_nts_record_no_self_supersede",
        ),
        sa.UniqueConstraint("id", "norm_version", name="uq_nts_record_id_norm_version"),
    )
    op.create_index(
        "uq_nts_record_one_draft",
        "nts_odontogram_records",
        ["clinic_id", "patient_id", "norm_version"],
        unique=True,
        postgresql_where=sa.text("status = 'draft'"),
    )
    op.create_index(
        "uq_nts_record_linear_chain",
        "nts_odontogram_records",
        ["supersedes_record_id"],
        unique=True,
        postgresql_where=sa.text("status = 'finalized' AND supersedes_record_id IS NOT NULL"),
    )
    op.create_index(
        "idx_nts_records_clinic_patient",
        "nts_odontogram_records",
        ["clinic_id", "patient_id"],
    )
    op.create_index(
        "idx_nts_records_patient_status",
        "nts_odontogram_records",
        ["patient_id", "status"],
    )

    op.create_table(
        "nts_findings",
        sa.Column("id", sa.UUID(), nullable=False),
        sa.Column("record_id", sa.UUID(), nullable=False),
        sa.Column("norm_version", sa.String(length=50), nullable=False),
        sa.Column("rule_id", sa.String(length=20), nullable=False),
        sa.Column("attributes", postgresql.JSONB(), nullable=False),
        sa.Column("provenance", sa.String(length=20), nullable=False),
        sa.Column("source_finding_id", sa.UUID(), nullable=True),
        sa.Column("sequence", sa.Integer(), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("created_by", sa.UUID(), nullable=False),
        sa.PrimaryKeyConstraint("id"),
        # Single parent constraint. The composite FK already guarantees parent
        # existence, norm_version equality and the cascade; both columns are
        # NOT NULL so MATCH SIMPLE never short-circuits. A separate FK on
        # record_id alone would only duplicate the check and split the ORM
        # join into two paths.
        sa.ForeignKeyConstraint(
            ["record_id", "norm_version"],
            ["nts_odontogram_records.id", "nts_odontogram_records.norm_version"],
            name="fk_nts_finding_record_norm",
            ondelete="CASCADE",
        ),
        sa.ForeignKeyConstraint(["source_finding_id"], ["nts_findings.id"], ondelete="RESTRICT"),
        sa.ForeignKeyConstraint(["created_by"], ["users.id"]),
        sa.CheckConstraint(
            "provenance IN ('observed', 'carried_forward')",
            name="ck_nts_finding_provenance",
        ),
        sa.CheckConstraint(
            "jsonb_typeof(attributes) = 'object'",
            name="ck_nts_finding_attributes_object",
        ),
        sa.CheckConstraint("sequence >= 0", name="ck_nts_finding_sequence_nonneg"),
        sa.UniqueConstraint("record_id", "sequence", name="uq_nts_finding_record_sequence"),
        sa.UniqueConstraint("id", "record_id", name="uq_nts_finding_id_record"),
    )
    op.create_index("idx_nts_findings_rule", "nts_findings", ["record_id", "rule_id"])
    op.create_index("idx_nts_findings_source", "nts_findings", ["source_finding_id"])

    op.create_table(
        "nts_finding_targets",
        sa.Column("id", sa.UUID(), nullable=False),
        sa.Column("finding_id", sa.UUID(), nullable=False),
        sa.Column("group_index", sa.Integer(), nullable=False),
        sa.Column("position", sa.Integer(), nullable=False),
        sa.Column("participation", sa.String(length=20), nullable=False),
        sa.Column("role", sa.String(length=30), nullable=True),
        sa.Column("target_kind", sa.String(length=20), nullable=False),
        sa.Column("tooth_number", sa.Integer(), nullable=True),
        sa.Column("arch", sa.String(length=10), nullable=True),
        sa.Column("local_ordinal", sa.Integer(), nullable=True),
        # Reserved. GEOMETRY CONTRACT PENDING — canonicalization version 1
        # refuses a non-null value, so nothing can be stored here yet.
        sa.Column("geometry", postgresql.JSONB(), nullable=True),
        sa.PrimaryKeyConstraint("id"),
        sa.ForeignKeyConstraint(["finding_id"], ["nts_findings.id"], ondelete="CASCADE"),
        sa.CheckConstraint(
            "participation IN ('subject', 'anchor')",
            name="ck_nts_target_participation",
        ),
        sa.CheckConstraint(
            "target_kind IN ('fdi_tooth', 'unnumbered_tooth', 'arch')",
            name="ck_nts_target_kind",
        ),
        sa.CheckConstraint(
            "(target_kind = 'fdi_tooth' AND tooth_number IS NOT NULL "
            "AND arch IS NULL AND local_ordinal IS NULL) OR "
            "(target_kind = 'unnumbered_tooth' AND tooth_number IS NULL "
            "AND arch IS NULL) OR "
            "(target_kind = 'arch' AND tooth_number IS NULL "
            "AND arch IS NOT NULL AND local_ordinal IS NULL)",
            name="ck_nts_target_kind_columns",
        ),
        # FDI "Sistema Dígito Dos": quadrants 1-4 carry teeth 1-8
        # (permanent), quadrants 5-8 carry teeth 1-5 (deciduous). No
        # sentinel value (0, 99) can pass.
        sa.CheckConstraint(
            "tooth_number IS NULL OR ("
            "((tooth_number / 10) BETWEEN 1 AND 4 "
            "AND (tooth_number % 10) BETWEEN 1 AND 8) OR "
            "((tooth_number / 10) BETWEEN 5 AND 8 "
            "AND (tooth_number % 10) BETWEEN 1 AND 5))",
            name="ck_nts_target_fdi",
        ),
        sa.CheckConstraint(
            "arch IN ('upper', 'lower') OR arch IS NULL",
            name="ck_nts_target_arch_value",
        ),
        sa.CheckConstraint("group_index >= 0", name="ck_nts_target_group_index_nonneg"),
        sa.CheckConstraint("position >= 0", name="ck_nts_target_position_nonneg"),
        sa.CheckConstraint(
            "local_ordinal IS NULL OR local_ordinal >= 1",
            name="ck_nts_target_local_ordinal",
        ),
        # GEOMETRY CONTRACT PENDING: canonicalization version 1 defines no
        # geometry, so a stored shape could never be hashed or finalized.
        # The future migration that introduces version 2 drops this CHECK.
        sa.CheckConstraint("geometry IS NULL", name="ck_nts_target_geometry_pending"),
        sa.UniqueConstraint(
            "finding_id", "group_index", "position", name="uq_nts_target_finding_slot"
        ),
    )
    op.create_index(
        "idx_nts_targets_tooth",
        "nts_finding_targets",
        ["tooth_number", "participation"],
    )

    op.create_table(
        "nts_record_specifications",
        sa.Column("id", sa.UUID(), nullable=False),
        sa.Column("record_id", sa.UUID(), nullable=False),
        sa.Column("finding_id", sa.UUID(), nullable=True),
        sa.Column("text", sa.Text(), nullable=False),
        sa.Column("sequence", sa.Integer(), nullable=False),
        sa.PrimaryKeyConstraint("id"),
        sa.ForeignKeyConstraint(["record_id"], ["nts_odontogram_records.id"], ondelete="CASCADE"),
        # MATCH SIMPLE: with finding_id NULL the constraint is satisfied, so
        # a general specification stays legal; with finding_id set, both
        # columns must match one finding row, which forbids pointing at a
        # finding of another record.
        sa.ForeignKeyConstraint(
            ["finding_id", "record_id"],
            ["nts_findings.id", "nts_findings.record_id"],
            name="fk_nts_spec_finding_same_record",
            ondelete="CASCADE",
        ),
        sa.CheckConstraint("sequence >= 0", name="ck_nts_spec_sequence_nonneg"),
        sa.UniqueConstraint("record_id", "sequence", name="uq_nts_spec_record_sequence"),
    )

    op.create_table(
        "nts_record_audit_events",
        sa.Column("id", sa.UUID(), nullable=False),
        sa.Column("clinic_id", sa.UUID(), nullable=False),
        sa.Column("record_id", sa.UUID(), nullable=False),
        sa.Column("record_version", sa.Integer(), nullable=False),
        sa.Column("entity_type", sa.String(length=20), nullable=False),
        sa.Column("entity_id", sa.UUID(), nullable=True),
        sa.Column("action", sa.String(length=40), nullable=False),
        sa.Column("previous_state", postgresql.JSONB(), nullable=True),
        sa.Column("new_state", postgresql.JSONB(), nullable=True),
        sa.Column("changed_by", sa.UUID(), nullable=False),
        sa.Column("changed_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("notes", sa.Text(), nullable=True),
        sa.PrimaryKeyConstraint("id"),
        sa.ForeignKeyConstraint(["clinic_id"], ["clinics.id"]),
        # RESTRICT, not CASCADE: a clinical audit trail must not be
        # destructible along with its subject (ADR 0022 §5).
        sa.ForeignKeyConstraint(["record_id"], ["nts_odontogram_records.id"], ondelete="RESTRICT"),
        sa.ForeignKeyConstraint(["changed_by"], ["users.id"]),
        sa.CheckConstraint(
            "entity_type IN ('record', 'finding', 'target', 'specification')",
            name="ck_nts_audit_entity_type",
        ),
        sa.CheckConstraint(
            "action IN ('record_created', 'record_metadata_updated', "
            "'finding_created', 'finding_updated', 'finding_removed', "
            "'target_changed', 'specification_changed', 'carried_forward', "
            "'carried_forward_confirmed', 'discarded', 'finalized', "
            "'supersession_recorded')",
            name="ck_nts_audit_action",
        ),
        sa.CheckConstraint("record_version >= 1", name="ck_nts_audit_record_version"),
    )
    op.create_index(
        "idx_nts_audit_record_time",
        "nts_record_audit_events",
        ["record_id", "changed_at"],
    )
    op.create_index(
        "idx_nts_audit_clinic_time",
        "nts_record_audit_events",
        ["clinic_id", "changed_at"],
    )

    op.execute(RECORD_GUARD_FUNCTION_SQL)
    op.execute(RECORD_GUARD_TRIGGER_SQL)
    op.execute(AUDIT_APPEND_ONLY_FUNCTION_SQL)
    op.execute(AUDIT_APPEND_ONLY_TRIGGER_SQL)


def downgrade() -> None:
    op.execute("DROP TRIGGER IF EXISTS trg_nts_audit_append_only ON nts_record_audit_events")
    op.execute("DROP FUNCTION IF EXISTS nts_audit_append_only()")
    op.execute("DROP TRIGGER IF EXISTS trg_nts_records_guard ON nts_odontogram_records")
    op.execute("DROP FUNCTION IF EXISTS nts_records_guard()")

    op.drop_index("idx_nts_audit_clinic_time", table_name="nts_record_audit_events")
    op.drop_index("idx_nts_audit_record_time", table_name="nts_record_audit_events")
    op.drop_table("nts_record_audit_events")

    op.drop_table("nts_record_specifications")

    op.drop_index("idx_nts_targets_tooth", table_name="nts_finding_targets")
    op.drop_table("nts_finding_targets")

    op.drop_index("idx_nts_findings_source", table_name="nts_findings")
    op.drop_index("idx_nts_findings_rule", table_name="nts_findings")
    op.drop_table("nts_findings")

    op.drop_index("idx_nts_records_patient_status", table_name="nts_odontogram_records")
    op.drop_index("idx_nts_records_clinic_patient", table_name="nts_odontogram_records")
    op.drop_index("uq_nts_record_linear_chain", table_name="nts_odontogram_records")
    op.drop_index("uq_nts_record_one_draft", table_name="nts_odontogram_records")
    op.drop_table("nts_odontogram_records")
