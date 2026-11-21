"""Central appointment ownership policy for interactive agenda surfaces."""

from __future__ import annotations

from uuid import UUID

from sqlalchemy import and_, select
from sqlalchemy.sql.elements import ColumnElement

from app.core.auth.dependencies import ClinicContext

from .models import Appointment, AppointmentTreatment


class AppointmentAccessPolicy:
    """Restrict dentists to appointments assigned to themselves."""

    @staticmethod
    def predicate(ctx: ClinicContext) -> ColumnElement[bool]:
        return AppointmentAccessPolicy.predicate_for(ctx.role, ctx.clinic_id, ctx.user_id)

    @staticmethod
    def predicate_for(role: str, clinic_id: UUID, user_id: UUID) -> ColumnElement[bool]:
        conditions = [Appointment.clinic_id == clinic_id]
        if role == "dentist":
            conditions.append(Appointment.professional_id == user_id)
        return and_(*conditions)

    @classmethod
    async def can_access(cls, db, ctx: ClinicContext, appointment_id: UUID) -> bool:
        return await cls.can_access_for(db, ctx.role, ctx.clinic_id, ctx.user_id, appointment_id)

    @classmethod
    async def can_access_for(
        cls, db, role: str, clinic_id: UUID, user_id: UUID, appointment_id: UUID
    ) -> bool:
        return bool(
            await db.scalar(
                select(Appointment.id).where(
                    Appointment.id == appointment_id,
                    cls.predicate_for(role, clinic_id, user_id),
                )
            )
        )

    @classmethod
    async def can_access_treatment(
        cls, db, ctx: ClinicContext, appointment_treatment_id: UUID
    ) -> bool:
        return bool(
            await db.scalar(
                select(AppointmentTreatment.id)
                .join(Appointment, AppointmentTreatment.appointment_id == Appointment.id)
                .where(
                    AppointmentTreatment.id == appointment_treatment_id,
                    cls.predicate(ctx),
                )
            )
        )
