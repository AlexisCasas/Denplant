"""DP-33 cleanup for periodontal snapshots."""

from uuid import UUID

from sqlalchemy import delete, select
from sqlalchemy.ext.asyncio import AsyncSession

from .models import PeriodontogramSite, PeriodontogramSnapshot, PeriodontogramTooth


async def on_patient_permanent_delete(data: dict, *, db: AsyncSession) -> None:
    if data.get("phase") != "clinical":
        return
    clinic_id, patient_id = UUID(data["clinic_id"]), UUID(data["patient_id"])
    snapshots = select(PeriodontogramSnapshot.id).where(
        PeriodontogramSnapshot.clinic_id == clinic_id,
        PeriodontogramSnapshot.patient_id == patient_id,
    )
    teeth = select(PeriodontogramTooth.id).where(PeriodontogramTooth.snapshot_id.in_(snapshots))
    await db.execute(delete(PeriodontogramSite).where(PeriodontogramSite.tooth_id.in_(teeth)))
    await db.execute(delete(PeriodontogramTooth).where(PeriodontogramTooth.id.in_(teeth)))
    await db.execute(delete(PeriodontogramSnapshot).where(PeriodontogramSnapshot.id.in_(snapshots)))
