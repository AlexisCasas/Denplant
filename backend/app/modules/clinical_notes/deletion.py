"""DP-33 cleanup for polymorphic clinical notes."""

from uuid import UUID

from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession


async def on_patient_permanent_delete(data: dict, *, db: AsyncSession) -> None:
    if data.get("phase") != "notes":
        return
    await db.execute(
        text("""
        DELETE FROM clinical_notes
        WHERE clinic_id = :clinic_id AND (
          (owner_type = 'patient' AND owner_id = :patient_id)
          OR (owner_type = 'appointment' AND owner_id IN (SELECT id FROM appointments WHERE patient_id = :patient_id AND clinic_id = :clinic_id))
          OR (owner_type = 'plan' AND owner_id IN (SELECT id FROM treatment_plans WHERE patient_id = :patient_id AND clinic_id = :clinic_id))
          OR (owner_type = 'treatment' AND owner_id IN (SELECT id FROM treatments WHERE patient_id = :patient_id AND clinic_id = :clinic_id))
        )
    """),
        {"clinic_id": UUID(data["clinic_id"]), "patient_id": UUID(data["patient_id"])},
    )
