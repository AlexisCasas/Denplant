"""DP-33 media restore provenance and post-commit purge outbox."""

from collections.abc import Sequence

import sqlalchemy as sa

from alembic import op

revision: str = "med_0003"
down_revision: str | None = "med_0002"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.add_column(
        "documents",
        sa.Column("archived_by_patient", sa.Boolean(), nullable=False, server_default=sa.false()),
    )
    op.create_table(
        "media_purge_outbox",
        sa.Column("id", sa.UUID(), primary_key=True),
        sa.Column("storage_path", sa.String(500), nullable=False, unique=True),
        sa.Column("clinic_id", sa.UUID(), sa.ForeignKey("clinics.id"), nullable=False),
        sa.Column("patient_id", sa.UUID(), nullable=False),
        sa.Column("status", sa.String(20), nullable=False, server_default="pending"),
        sa.Column("attempts", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("last_error", sa.Text()),
        sa.Column("processed_at", sa.DateTime(timezone=True)),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
    )
    op.create_index("ix_media_purge_outbox_clinic", "media_purge_outbox", ["clinic_id"])
    op.create_index("ix_media_purge_outbox_patient", "media_purge_outbox", ["patient_id"])


def downgrade() -> None:
    op.drop_table("media_purge_outbox")
    op.drop_column("documents", "archived_by_patient")
