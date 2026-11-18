"""DP-33 cleanup for patient-scoped communications."""

from uuid import UUID

from sqlalchemy import delete
from sqlalchemy.ext.asyncio import AsyncSession

from .models import CommunicationMessage, NotificationPreference


async def on_patient_permanent_delete(data: dict, *, db: AsyncSession) -> None:
    if data.get("phase") != "clinical":
        return
    clinic_id, patient_id = UUID(data["clinic_id"]), UUID(data["patient_id"])
    await db.execute(
        delete(CommunicationMessage).where(
            CommunicationMessage.clinic_id == clinic_id,
            CommunicationMessage.patient_id == patient_id,
        )
    )
    await db.execute(
        delete(NotificationPreference).where(
            NotificationPreference.clinic_id == clinic_id,
            NotificationPreference.patient_id == patient_id,
        )
    )
