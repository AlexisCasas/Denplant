"""DP-33 recall suspension provenance."""

from collections.abc import Sequence

import sqlalchemy as sa

from alembic import op

revision: str = "rec_0002"
down_revision: str | None = "rec_0001"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.add_column("recalls", sa.Column("status_before_patient_archive", sa.String(30)))
    op.add_column(
        "recalls",
        sa.Column(
            "suspended_by_patient_archive", sa.Boolean(), nullable=False, server_default=sa.false()
        ),
    )


def downgrade() -> None:
    op.drop_column("recalls", "suspended_by_patient_archive")
    op.drop_column("recalls", "status_before_patient_archive")
