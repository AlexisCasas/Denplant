"""DP-33 transactional cleanup for payment-owned patient data."""

from uuid import UUID

from sqlalchemy import delete, select
from sqlalchemy.ext.asyncio import AsyncSession

from .models import PatientEarnedEntry, Payment, PaymentAllocation, PaymentHistory, Refund


async def on_patient_permanent_delete(data: dict, *, db: AsyncSession) -> None:
    if data.get("phase") != "financial":
        return
    clinic_id, patient_id = UUID(data["clinic_id"]), UUID(data["patient_id"])
    payment_ids = select(Payment.id).where(
        Payment.clinic_id == clinic_id, Payment.patient_id == patient_id
    )
    await db.execute(delete(PaymentHistory).where(PaymentHistory.payment_id.in_(payment_ids)))
    await db.execute(delete(Refund).where(Refund.payment_id.in_(payment_ids)))
    await db.execute(delete(PaymentAllocation).where(PaymentAllocation.payment_id.in_(payment_ids)))
    await db.execute(delete(Payment).where(Payment.id.in_(payment_ids)))
    await db.execute(
        delete(PatientEarnedEntry).where(
            PatientEarnedEntry.clinic_id == clinic_id, PatientEarnedEntry.patient_id == patient_id
        )
    )
