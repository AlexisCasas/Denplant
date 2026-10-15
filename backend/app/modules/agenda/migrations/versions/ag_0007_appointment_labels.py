"""Add clinic-scoped configurable appointment labels.

Revision ID: ag_0007
Revises: ag_0006
"""

from collections.abc import Sequence

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

revision: str = "ag_0007"
down_revision: str | None = "ag_0006"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.create_table(
        "appointment_labels",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True),
        sa.Column("clinic_id", postgresql.UUID(as_uuid=True), sa.ForeignKey("clinics.id"), nullable=False),
        sa.Column("name", sa.String(length=40), nullable=False),
        sa.Column("color", sa.String(length=7), nullable=False),
        sa.Column("is_active", sa.Boolean(), nullable=False, server_default=sa.text("true")),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.text("now()")),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.text("now()")),
    )
    op.create_index("ix_appointment_labels_clinic_id", "appointment_labels", ["clinic_id"])
    op.create_index("uq_appointment_label_clinic_name_ci", "appointment_labels", ["clinic_id", sa.text("lower(name)")], unique=True)
    op.add_column("appointments", sa.Column("appointment_label_id", postgresql.UUID(as_uuid=True), nullable=True))
    op.create_foreign_key("fk_appointments_appointment_label", "appointments", "appointment_labels", ["appointment_label_id"], ["id"], ondelete="SET NULL")
    op.create_index("ix_appointments_appointment_label_id", "appointments", ["appointment_label_id"])


def downgrade() -> None:
    op.drop_index("ix_appointments_appointment_label_id", table_name="appointments")
    op.drop_constraint("fk_appointments_appointment_label", "appointments", type_="foreignkey")
    op.drop_column("appointments", "appointment_label_id")
    op.drop_index("uq_appointment_label_clinic_name_ci", table_name="appointment_labels")
    op.drop_index("ix_appointment_labels_clinic_id", table_name="appointment_labels")
    op.drop_table("appointment_labels")
