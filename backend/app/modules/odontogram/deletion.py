"""DP-33 cleanup for odontogram-owned rows."""

from uuid import UUID

from sqlalchemy import delete, select
from sqlalchemy.ext.asyncio import AsyncSession

from .models import OdontogramHistory, ToothRecord, Treatment, TreatmentTooth


async def on_patient_permanent_delete(data: dict, *, db: AsyncSession) -> None:
    if data.get("phase") != "odontogram":
        return
    clinic_id, patient_id = UUID(data["clinic_id"]), UUID(data["patient_id"])
    treatments = select(Treatment.id).where(
        Treatment.clinic_id == clinic_id, Treatment.patient_id == patient_id
    )
    await db.execute(delete(TreatmentTooth).where(TreatmentTooth.treatment_id.in_(treatments)))
    await db.execute(delete(Treatment).where(Treatment.id.in_(treatments)))
    await db.execute(
        delete(ToothRecord).where(
            ToothRecord.clinic_id == clinic_id, ToothRecord.patient_id == patient_id
        )
    )
    await db.execute(
        delete(OdontogramHistory).where(
            OdontogramHistory.clinic_id == clinic_id, OdontogramHistory.patient_id == patient_id
        )
    )
