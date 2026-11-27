"""Add immutable cross-module clinical mutation audit."""
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql
from alembic import op

revision = "0007"
down_revision = "0006"
branch_labels = None
depends_on = ("pat_0001",)

def upgrade() -> None:
    op.create_table("clinical_audit_events",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True),
        sa.Column("clinic_id", postgresql.UUID(as_uuid=True), sa.ForeignKey("clinics.id"), nullable=False),
        # Not an FK: permanent patient deletion retains the immutable audit.
        sa.Column("patient_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("resource_type", sa.String(80), nullable=False), sa.Column("resource_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("action", sa.String(32), nullable=False), sa.Column("actor_user_id", postgresql.UUID(as_uuid=True), sa.ForeignKey("users.id")),
        sa.Column("appointment_id", postgresql.UUID(as_uuid=True)), sa.Column("before_state", postgresql.JSONB()), sa.Column("after_state", postgresql.JSONB()),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()))
    op.create_index("ix_clinical_audit_clinic_patient_created", "clinical_audit_events", ["clinic_id", "patient_id", "created_at"])
    op.create_index("ix_clinical_audit_resource", "clinical_audit_events", ["clinic_id", "resource_type", "resource_id"])

def downgrade() -> None:
    op.drop_table("clinical_audit_events")
