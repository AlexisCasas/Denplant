"""DP-33 cleanup and fiscal guard for billing-owned data."""

from uuid import UUID

from sqlalchemy import delete, select
from sqlalchemy.ext.asyncio import AsyncSession

from .models import Invoice, InvoiceHistory, InvoiceItem, InvoicePayment


async def on_patient_permanent_delete(data: dict, *, db: AsyncSession) -> None:
    if data.get("phase") != "financial":
        return
    clinic_id, patient_id = UUID(data["clinic_id"]), UUID(data["patient_id"])
    ids = select(Invoice.id).where(Invoice.clinic_id == clinic_id, Invoice.patient_id == patient_id)
    await db.execute(delete(InvoicePayment).where(InvoicePayment.invoice_id.in_(ids)))
    await db.execute(delete(InvoiceHistory).where(InvoiceHistory.invoice_id.in_(ids)))
    await db.execute(delete(InvoiceItem).where(InvoiceItem.invoice_id.in_(ids)))
    await db.execute(delete(Invoice).where(Invoice.id.in_(ids)))
