"""DP-33 cleanup for budget-owned patient data."""

from uuid import UUID

from sqlalchemy import delete, select, text, update
from sqlalchemy.ext.asyncio import AsyncSession

from .models import Budget, BudgetAccessLog, BudgetHistory, BudgetItem, BudgetSignature


async def on_patient_permanent_delete(data: dict, *, db: AsyncSession) -> None:
    if data.get("phase") != "budgets":
        return
    clinic_id, patient_id = UUID(data["clinic_id"]), UUID(data["patient_id"])
    ids = select(Budget.id).where(Budget.clinic_id == clinic_id, Budget.patient_id == patient_id)
    item_ids = select(BudgetItem.id).where(BudgetItem.budget_id.in_(ids))
    # Treatment plans may retain an optional one-to-one budget pointer.
    await db.execute(
        text(
            "UPDATE treatment_plans SET budget_id = NULL WHERE budget_id IN (SELECT id FROM budgets WHERE clinic_id = :clinic_id AND patient_id = :patient_id)"
        ),
        {"clinic_id": clinic_id, "patient_id": patient_id},
    )
    # The odontogram owns treatments but its optional budget link must be
    # detached before this module removes budget items.
    await db.execute(
        update(BudgetItem).where(BudgetItem.id.in_(item_ids)).values(treatment_id=None)
    )
    await db.execute(delete(BudgetAccessLog).where(BudgetAccessLog.budget_id.in_(ids)))
    await db.execute(delete(BudgetHistory).where(BudgetHistory.budget_id.in_(ids)))
    await db.execute(delete(BudgetSignature).where(BudgetSignature.budget_id.in_(ids)))
    await db.execute(delete(BudgetItem).where(BudgetItem.id.in_(item_ids)))
    await db.execute(delete(Budget).where(Budget.id.in_(ids)))
