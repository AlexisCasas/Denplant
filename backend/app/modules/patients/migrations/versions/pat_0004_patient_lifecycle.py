"""DP-33 patient lifecycle metadata and permanent-delete audit."""

from collections.abc import Sequence

import sqlalchemy as sa

from alembic import op

revision: str = "pat_0004"
down_revision: str | None = "pat_0003"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.add_column("patients", sa.Column("archived_at", sa.DateTime(timezone=True)))
    op.add_column("patients", sa.Column("archived_by", sa.UUID()))
    op.add_column("patients", sa.Column("restored_at", sa.DateTime(timezone=True)))
    op.add_column("patients", sa.Column("restored_by", sa.UUID()))
    op.create_foreign_key("fk_patients_archived_by", "patients", "users", ["archived_by"], ["id"])
    op.create_foreign_key("fk_patients_restored_by", "patients", "users", ["restored_by"], ["id"])
    op.create_table(
        "patient_permanent_deletion_audits",
        sa.Column("id", sa.UUID(), primary_key=True),
        sa.Column("old_patient_id", sa.UUID(), nullable=False),
        sa.Column("clinic_id", sa.UUID(), sa.ForeignKey("clinics.id"), nullable=False),
        sa.Column("patient_name", sa.String(201), nullable=False),
        sa.Column("deleted_by", sa.UUID(), sa.ForeignKey("users.id"), nullable=False),
        sa.Column("deleted_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("action", sa.String(64), nullable=False),
    )
    op.create_index(
        "ix_patient_delete_audit_old_patient",
        "patient_permanent_deletion_audits",
        ["old_patient_id"],
    )
    op.create_index(
        "ix_patient_delete_audit_clinic", "patient_permanent_deletion_audits", ["clinic_id"]
    )


def downgrade() -> None:
    op.drop_table("patient_permanent_deletion_audits")
    op.drop_constraint("fk_patients_restored_by", "patients", type_="foreignkey")
    op.drop_constraint("fk_patients_archived_by", "patients", type_="foreignkey")
    op.drop_column("patients", "restored_by")
    op.drop_column("patients", "restored_at")
    op.drop_column("patients", "archived_by")
    op.drop_column("patients", "archived_at")
