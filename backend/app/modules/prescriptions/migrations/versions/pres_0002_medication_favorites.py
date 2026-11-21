"""prescriptions — reusable medication descriptions and private favorites.

Additive only: issued prescriptions and their immutable items are untouched.
The catalog stores only reusable descriptive fields; dose, frequency, duration,
quantity and instructions remain in each prescription draft and snapshot.

Revision ID: pres_0002
Revises: pres_0001
Create Date: 2026-11-09
"""

from collections.abc import Sequence

import sqlalchemy as sa

from alembic import op

revision: str = "pres_0002"
down_revision: str | None = "pres_0001"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.create_table(
        "prescription_medications",
        sa.Column("id", sa.UUID(), nullable=False),
        sa.Column("clinic_id", sa.UUID(), nullable=False),
        sa.Column("active_ingredient", sa.String(length=200), nullable=False),
        sa.Column("commercial_name", sa.String(length=200), nullable=True),
        sa.Column("strength", sa.String(length=100), nullable=False),
        sa.Column("pharmaceutical_form", sa.String(length=100), nullable=False),
        sa.Column("presentation", sa.String(length=200), nullable=True),
        sa.Column("default_route", sa.String(length=100), nullable=False),
        sa.Column("dedupe_key", sa.String(length=64), nullable=False),
        sa.Column("active", sa.Boolean(), nullable=False, server_default=sa.true()),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
        sa.PrimaryKeyConstraint("id"),
        sa.ForeignKeyConstraint(["clinic_id"], ["clinics.id"]),
        sa.UniqueConstraint("id", "clinic_id", name="uq_rx_medication_id_clinic"),
        sa.UniqueConstraint("clinic_id", "dedupe_key", name="uq_rx_medication_clinic_dedupe"),
    )
    op.create_index(
        "idx_rx_medication_clinic_active_ingredient",
        "prescription_medications",
        ["clinic_id", "active", "active_ingredient"],
    )
    op.create_table(
        "prescription_medication_favorites",
        sa.Column("id", sa.UUID(), nullable=False),
        sa.Column("clinic_id", sa.UUID(), nullable=False),
        sa.Column("doctor_id", sa.UUID(), nullable=False),
        sa.Column("medication_id", sa.UUID(), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.PrimaryKeyConstraint("id"),
        sa.ForeignKeyConstraint(["clinic_id"], ["clinics.id"]),
        sa.ForeignKeyConstraint(["doctor_id"], ["users.id"]),
        sa.ForeignKeyConstraint(
            ["medication_id", "clinic_id"],
            ["prescription_medications.id", "prescription_medications.clinic_id"],
            name="fk_rx_favorite_medication_clinic",
            ondelete="RESTRICT",
        ),
        sa.UniqueConstraint("doctor_id", "medication_id", name="uq_rx_favorite_doctor_medication"),
    )
    op.create_index(
        "idx_rx_favorite_doctor_created",
        "prescription_medication_favorites",
        ["doctor_id", "created_at"],
    )


def downgrade() -> None:
    op.drop_index("idx_rx_favorite_doctor_created", table_name="prescription_medication_favorites")
    op.drop_table("prescription_medication_favorites")
    op.drop_index(
        "idx_rx_medication_clinic_active_ingredient", table_name="prescription_medications"
    )
    op.drop_table("prescription_medications")
