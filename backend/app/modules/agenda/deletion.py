"""DP-33 cleanup for appointment-owned patient data."""

from uuid import UUID

from sqlalchemy import delete, select
from sqlalchemy.ext.asyncio import AsyncSession

from .models import (
    Appointment,
    AppointmentCabinetEvent,
    AppointmentStatusEvent,
    AppointmentTreatment,
)


async def on_patient_permanent_delete(data: dict, *, db: AsyncSession) -> None:
    if data.get("phase") != "appointments":
        return
    clinic_id, patient_id = UUID(data["clinic_id"]), UUID(data["patient_id"])
    ids = select(Appointment.id).where(
        Appointment.clinic_id == clinic_id, Appointment.patient_id == patient_id
    )
    await db.execute(
        delete(AppointmentTreatment).where(AppointmentTreatment.appointment_id.in_(ids))
    )
    await db.execute(
        delete(AppointmentStatusEvent).where(AppointmentStatusEvent.appointment_id.in_(ids))
    )
    await db.execute(
        delete(AppointmentCabinetEvent).where(AppointmentCabinetEvent.appointment_id.in_(ids))
    )
    await db.execute(delete(Appointment).where(Appointment.id.in_(ids)))
