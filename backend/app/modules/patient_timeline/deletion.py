"""DP-33 cleanup for derived patient timeline rows."""

from uuid import UUID

from sqlalchemy import delete
from sqlalchemy.ext.asyncio import AsyncSession

from .models import PatientTimeline


async def on_patient_permanent_delete(data: dict, *, db: AsyncSession) -> None:
    if data.get("phase") != "clinical":
        return
    await db.execute(
        delete(PatientTimeline).where(
            PatientTimeline.clinic_id == UUID(data["clinic_id"]),
            PatientTimeline.patient_id == UUID(data["patient_id"]),
        )
    )
