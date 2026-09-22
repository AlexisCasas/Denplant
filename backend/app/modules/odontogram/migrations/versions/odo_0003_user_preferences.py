"""odontogram — per-user, per-clinic odontogram profile preference.

Additive only: creates ``odontogram_user_preferences`` so a user can pick
which odontogram format they work with inside a clinic (``original`` or
``pe_nts_188_2022``). No existing table is touched and nothing is
backfilled — absence of a row means ``original``.

Module-owned table (mirrors ``notification_preferences``) rather than a
generic settings blob on ``users`` / ``clinic_memberships``: the choice is
personal, and ``clinics.settings`` would make it clinic-wide.

Revision ID: odo_0003
Revises: odo_0002
Create Date: 2026-09-16
"""

from collections.abc import Sequence

import sqlalchemy as sa

from alembic import op

revision: str = "odo_0003"
down_revision: str | None = "odo_0002"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.create_table(
        "odontogram_user_preferences",
        sa.Column("id", sa.UUID(), nullable=False),
        sa.Column("clinic_id", sa.UUID(), nullable=False),
        sa.Column("user_id", sa.UUID(), nullable=False),
        sa.Column("profile", sa.String(length=30), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
        sa.ForeignKeyConstraint(
            ["clinic_id"],
            ["clinics.id"],
        ),
        sa.ForeignKeyConstraint(
            ["user_id"],
            ["users.id"],
        ),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("clinic_id", "user_id", name="uq_odontogram_pref_clinic_user"),
        sa.CheckConstraint(
            "profile IN ('original', 'pe_nts_188_2022')",
            name="ck_odontogram_pref_profile",
        ),
    )
    op.create_index(
        "idx_odontogram_pref_clinic",
        "odontogram_user_preferences",
        ["clinic_id"],
        unique=False,
    )
    op.create_index(
        "idx_odontogram_pref_user",
        "odontogram_user_preferences",
        ["user_id"],
        unique=False,
    )
    op.create_index(
        op.f("ix_odontogram_user_preferences_clinic_id"),
        "odontogram_user_preferences",
        ["clinic_id"],
        unique=False,
    )
    op.create_index(
        op.f("ix_odontogram_user_preferences_user_id"),
        "odontogram_user_preferences",
        ["user_id"],
        unique=False,
    )


def downgrade() -> None:
    op.drop_index(
        op.f("ix_odontogram_user_preferences_user_id"),
        table_name="odontogram_user_preferences",
    )
    op.drop_index(
        op.f("ix_odontogram_user_preferences_clinic_id"),
        table_name="odontogram_user_preferences",
    )
    op.drop_index("idx_odontogram_pref_user", table_name="odontogram_user_preferences")
    op.drop_index("idx_odontogram_pref_clinic", table_name="odontogram_user_preferences")
    op.drop_table("odontogram_user_preferences")
