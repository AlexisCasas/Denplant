"""Central SQL access policy for dentist-scoped patient records."""

from __future__ import annotations

from uuid import UUID

from sqlalchemy import and_, column, exists, or_, select, table
from sqlalchemy.sql.elements import ColumnElement

from app.core.auth.dependencies import ClinicContext

from .models import Patient

# ``patients`` is foundational and cannot import the agenda module.  The
# appointment table is an established database contract, queried as Core.
_appointments = table(
    "appointments",
    column("clinic_id"),
    column("patient_id"),
    column("professional_id"),
    column("status"),
)


class PatientAccessPolicy:
    """Restrict dentists to patients they created or actively attended."""

    @staticmethod
    def predicate(ctx: ClinicContext) -> ColumnElement[bool]:
        return PatientAccessPolicy.predicate_for(ctx.role, ctx.clinic_id, ctx.user_id)

    @staticmethod
    def predicate_for(role: str, clinic_id: UUID, user_id: UUID) -> ColumnElement[bool]:
        if role != "dentist":
            return and_(Patient.clinic_id == clinic_id, Patient.status != "archived")
        assigned = exists(
            select(1).where(
                _appointments.c.clinic_id == clinic_id,
                _appointments.c.patient_id == Patient.id,
                _appointments.c.professional_id == user_id,
                _appointments.c.status != "cancelled",
            )
        )
        return and_(
            Patient.clinic_id == clinic_id,
            Patient.status != "archived",
            or_(Patient.created_by_user_id == user_id, assigned),
        )

    @staticmethod
    def sql_predicate(role: str, *, patient_alias: str, user_id: UUID) -> tuple[str, dict]:
        """Return the central policy as a bound fragment for aggregate SQL queries."""
        if role != "dentist":
            return "", {}
        return (
            f""" AND (
                {patient_alias}.created_by_user_id = :patient_scope_user_id
                OR EXISTS (
                    SELECT 1 FROM appointments patient_scope_appointment
                    WHERE patient_scope_appointment.clinic_id = :clinic_id
                      AND patient_scope_appointment.patient_id = {patient_alias}.id
                      AND patient_scope_appointment.professional_id = :patient_scope_user_id
                      AND patient_scope_appointment.status != 'cancelled'
                )
            )""",
            {"patient_scope_user_id": user_id},
        )

    @classmethod
    async def can_access(cls, db, ctx: ClinicContext, patient_id: UUID) -> bool:
        return await cls.can_access_for(db, ctx.role, ctx.clinic_id, ctx.user_id, patient_id)

    @classmethod
    async def can_access_for(
        cls, db, role: str, clinic_id: UUID, user_id: UUID, patient_id: UUID
    ) -> bool:
        return bool(
            await db.scalar(
                select(Patient.id).where(
                    Patient.id == patient_id, cls.predicate_for(role, clinic_id, user_id)
                )
            )
        )
