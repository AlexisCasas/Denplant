"""odontogram — preserve a treatment's configured therapeutic rendering.

Adds a nullable JSONB snapshot to existing ``treatments`` rows.  Existing
clinical history is deliberately not backfilled: ``NULL`` means the treatment
predates visual snapshots or was validly created without a catalog mapping.

Revision ID: odo_0005
Revises: odo_0004
Create Date: 2026-10-08
"""

from collections.abc import Sequence

import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

from alembic import op

revision: str = "odo_0005"
down_revision: str | None = "odo_0004"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.add_column(
        "treatments",
        sa.Column("visualization_snapshot", postgresql.JSONB(astext_type=sa.Text()), nullable=True),
    )


def downgrade() -> None:
    op.drop_column("treatments", "visualization_snapshot")
