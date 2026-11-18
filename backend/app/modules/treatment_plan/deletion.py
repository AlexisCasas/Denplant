"""DP-33 cleanup for treatment-plan-owned rows."""

from uuid import UUID

from sqlalchemy import delete, select
from sqlalchemy.ext.asyncio import AsyncSession

from .models import PlannedTreatmentItem, PlannedTreatmentItemSession, TreatmentPlan


async def on_patient_permanent_delete(data: dict, *, db: AsyncSession) -> None:
    if data.get("phase") != "plans":
        return
    clinic_id, patient_id = UUID(data["clinic_id"]), UUID(data["patient_id"])
    ids = select(TreatmentPlan.id).where(
        TreatmentPlan.clinic_id == clinic_id, TreatmentPlan.patient_id == patient_id
    )
    item_ids = select(PlannedTreatmentItem.id).where(
        PlannedTreatmentItem.treatment_plan_id.in_(ids)
    )
    await db.execute(
        delete(PlannedTreatmentItemSession).where(
            PlannedTreatmentItemSession.plan_item_id.in_(item_ids)
        )
    )
    await db.execute(delete(PlannedTreatmentItem).where(PlannedTreatmentItem.id.in_(item_ids)))
    await db.execute(delete(TreatmentPlan).where(TreatmentPlan.id.in_(ids)))
