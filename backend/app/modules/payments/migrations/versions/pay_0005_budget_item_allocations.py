"""Add explicit budget-item targets to payment allocations.

Historical allocations are deliberately left untouched: their existing
``budget`` / ``on_account`` shapes still satisfy the widened constraint.
"""

from collections.abc import Sequence

import sqlalchemy as sa

from alembic import op

revision: str = "pay_0005"
down_revision: str | None = "pay_0004"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.add_column("payment_allocations", sa.Column("budget_item_id", sa.UUID(), nullable=True))
    op.create_foreign_key(
        "fk_payment_allocations_budget_item_id",
        "payment_allocations",
        "budget_items",
        ["budget_item_id"],
        ["id"],
        ondelete="RESTRICT",
    )
    op.create_index(
        "idx_alloc_clinic_budget_item",
        "payment_allocations",
        ["clinic_id", "budget_item_id"],
    )
    op.drop_constraint("ck_alloc_target_consistency", "payment_allocations", type_="check")
    op.create_check_constraint(
        "ck_alloc_target_consistency",
        "payment_allocations",
        "(target_type = 'budget' AND budget_id IS NOT NULL AND budget_item_id IS NULL) "
        "OR (target_type = 'budget_item' AND budget_id IS NOT NULL AND budget_item_id IS NOT NULL) "
        "OR (target_type = 'on_account' AND budget_id IS NULL AND budget_item_id IS NULL)",
    )


def downgrade() -> None:
    op.drop_constraint("ck_alloc_target_consistency", "payment_allocations", type_="check")
    op.create_check_constraint(
        "ck_alloc_target_consistency",
        "payment_allocations",
        "(target_type = 'budget' AND budget_id IS NOT NULL) "
        "OR (target_type = 'on_account' AND budget_id IS NULL)",
    )
    op.drop_index("idx_alloc_clinic_budget_item", table_name="payment_allocations")
    op.drop_constraint(
        "fk_payment_allocations_budget_item_id", "payment_allocations", type_="foreignkey"
    )
    op.drop_column("payment_allocations", "budget_item_id")
