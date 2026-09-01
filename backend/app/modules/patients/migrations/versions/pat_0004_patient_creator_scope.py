"""patients: store the server-side patient creator for dentist scope."""

from collections.abc import Sequence

import sqlalchemy as sa

from alembic import op

revision: str = "pat_0004"
down_revision: str | None = "pat_0003"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.add_column("patients", sa.Column("created_by_user_id", sa.UUID(), nullable=True))
    op.create_foreign_key(
        "fk_patients_created_by_user_id_users",
        "patients",
        "users",
        ["created_by_user_id"],
        ["id"],
        ondelete="SET NULL",
    )
    op.create_index("ix_patients_created_by_user_id", "patients", ["created_by_user_id"])


def downgrade() -> None:
    op.drop_index("ix_patients_created_by_user_id", table_name="patients")
    op.drop_constraint("fk_patients_created_by_user_id_users", "patients", type_="foreignkey")
    op.drop_column("patients", "created_by_user_id")
