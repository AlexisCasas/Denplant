"""PatientService — business logic for patient CRUD.

Moved from ``app.modules.clinical.service`` in Fase B.1 chunk 2.
"""

from __future__ import annotations

from datetime import UTC, datetime
from uuid import UUID

from fastapi import HTTPException, status
from sqlalchemy import and_, column, func, or_, select, table, text
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.sql.elements import ColumnElement

from app.core.events import EventType, event_bus
from app.core.list_query import parse_sort

from .models import Patient, PatientPermanentDeletionAudit

# Public field name → SQL column. Decouples the URL from internal naming
# and prevents callers from sorting by arbitrary columns.
#
# ``last_visit`` is handled out-of-band (see ``list_patients``) because it
# lives in the ``agenda.appointments`` table and ``patients`` is foundational
# (``depends=[]``) — same workaround as ``get_recent_patients``.
_SORT_ALLOW = {
    "last_name": Patient.last_name,
    "first_name": Patient.first_name,
    "created_at": Patient.created_at,
    "updated_at": Patient.updated_at,
}
_SORT_DEFAULT = "last_visit:desc"
_SORT_LAST_VISIT = "last_visit"

# Lightweight reference to the agenda ``appointments`` table — avoids
# importing ``Appointment`` from the agenda module while keeping the
# query in SQLAlchemy Core rather than raw text(). The table name is
# the only contract; agenda renames must be coordinated here.
_appointments_t = table(
    "appointments",
    column("patient_id"),
    column("clinic_id"),
    column("start_time"),
)


# Fields a free-text search term is matched against. Concatenated
# ``first_name || ' ' || last_name`` is added per-term so a single term
# can span the name boundary (e.g. matching "an Sm" against "Juan Smith").
_SEARCH_FIELDS = (
    Patient.first_name,
    Patient.last_name,
    Patient.phone,
    Patient.email,
    Patient.national_id,
)
_FULL_NAME = func.concat(Patient.first_name, " ", Patient.last_name)


def _search_condition(search: str | None):
    """Build the WHERE clause for a free-text patient search.

    The query is split on whitespace into terms. A patient matches when
    **every** term matches **some** field (AND across terms, OR across
    fields). This makes "first last" — and the reversed "last first" —
    find a patient whose name is split across ``first_name`` and
    ``last_name``, which a single substring ILIKE could never do.
    """
    if not search or not search.strip():
        return None
    terms = search.split()
    per_term = []
    for term in terms:
        like = f"%{term}%"
        per_term.append(
            or_(
                *(field.ilike(like) for field in _SEARCH_FIELDS),
                _FULL_NAME.ilike(like),
            )
        )
    return and_(*per_term)


class PatientService:
    """Service for patient CRUD."""

    @staticmethod
    async def get_recent_patients(
        db: AsyncSession,
        clinic_id: UUID,
        limit: int = 8,
        *,
        access_predicate: ColumnElement[bool] | None = None,
    ) -> list[Patient]:
        """Patients ordered by last visit, falling back to newest created.

        ``last_visit`` lives in the consumer ``agenda.appointments``
        table. ``patients`` is foundational (``depends=[]``) so we
        cannot import the ``Appointment`` model — instead we read the
        table through a raw SQL fragment. The table name is the only
        contract; agenda renames must be coordinated here.
        """
        last_visit_conditions = [
            _appointments_t.c.clinic_id == clinic_id,
            _appointments_t.c.patient_id.is_not(None),
        ]
        if access_predicate is not None:
            last_visit_conditions.append(Patient.id == _appointments_t.c.patient_id)

        last_visit_rows = (
            await db.execute(
                select(
                    _appointments_t.c.patient_id,
                    func.max(_appointments_t.c.start_time).label("last_visit"),
                )
                .select_from(_appointments_t)
                .join(Patient, Patient.id == _appointments_t.c.patient_id)
                .where(
                    *last_visit_conditions,
                    *([access_predicate] if access_predicate is not None else []),
                )
                .group_by(_appointments_t.c.patient_id)
                .order_by(func.max(_appointments_t.c.start_time).desc())
                .limit(limit)
            )
        ).all()

        ordered_ids: list[UUID] = [row.patient_id for row in last_visit_rows]

        if not ordered_ids:
            result = await db.execute(
                select(Patient)
                .where(
                    Patient.clinic_id == clinic_id,
                    Patient.status != "archived",
                    *([access_predicate] if access_predicate is not None else []),
                )
                .order_by(Patient.created_at.desc())
                .limit(limit)
            )
            return list(result.scalars().all())

        result = await db.execute(
            select(Patient).where(
                Patient.clinic_id == clinic_id,
                Patient.id.in_(ordered_ids),
                Patient.status != "archived",
                *([access_predicate] if access_predicate is not None else []),
            )
        )
        by_id = {p.id: p for p in result.scalars().all()}
        # Preserve the visit-ordered ranking from the raw query.
        return [by_id[i] for i in ordered_ids if i in by_id]

    @staticmethod
    async def list_patients(
        db: AsyncSession,
        clinic_id: UUID,
        search: str | None = None,
        page: int = 1,
        page_size: int = 20,
        *,
        patient_ids: list[UUID] | None = None,
        city: str | None = None,
        do_not_contact: bool | None = None,
        statuses: list[str] | None = None,
        include_archived: bool = False,
        sort: str | None = None,
        access_predicate: ColumnElement[bool] | None = None,
    ) -> tuple[list[Patient], int]:
        """List patients with optional search + filters + sort.

        ``patient_ids`` is used by cross-module intersections (e.g.
        "Patients with debt > 0" comes from the payments module). Empty
        list short-circuits to an empty result so callers can pass the
        payments-side result without extra branching.
        """
        page_size = min(max(page_size, 1), 100)
        page = max(page, 1)
        offset = (page - 1) * page_size

        # Empty intersection set → no rows. Don't query.
        if patient_ids is not None and not patient_ids:
            return [], 0

        conditions = [Patient.clinic_id == clinic_id]
        if access_predicate is not None:
            conditions.append(access_predicate)
        if statuses is not None:
            allowed_statuses = {"active", "archived"}
            invalid_statuses = set(statuses) - allowed_statuses
            if invalid_statuses:
                raise HTTPException(
                    status.HTTP_422_UNPROCESSABLE_ENTITY,
                    detail="Invalid patient status filter.",
                )
            if not statuses:
                return [], 0
            conditions.append(Patient.status.in_(statuses))
        elif not include_archived:
            conditions.append(Patient.status != "archived")

        if patient_ids:
            conditions.append(Patient.id.in_(patient_ids))

        if city:
            # JSONB ->> 'city' ilike. address may be null.
            conditions.append(Patient.address["city"].astext.ilike(f"%{city}%"))

        if do_not_contact is not None:
            conditions.append(Patient.do_not_contact.is_(do_not_contact))

        search_clause = _search_condition(search)
        if search_clause is not None:
            conditions.append(search_clause)

        total = (await db.execute(select(func.count(Patient.id)).where(*conditions))).scalar() or 0

        sort_raw = (sort or _SORT_DEFAULT).strip()
        sort_field, _, sort_dir = sort_raw.partition(":")
        sort_field = sort_field.strip()
        sort_dir = (sort_dir or "asc").strip().lower()

        if sort_field == _SORT_LAST_VISIT:
            if sort_dir not in ("asc", "desc"):
                raise HTTPException(
                    status.HTTP_422_UNPROCESSABLE_ENTITY,
                    detail=f"Invalid sort direction {sort_dir!r}. Use 'asc' or 'desc'.",
                )
            last_visit_sq = (
                select(
                    _appointments_t.c.patient_id.label("patient_id"),
                    func.max(_appointments_t.c.start_time).label("last_visit"),
                )
                .where(
                    _appointments_t.c.clinic_id == clinic_id,
                    _appointments_t.c.patient_id.is_not(None),
                )
                .group_by(_appointments_t.c.patient_id)
                .subquery()
            )
            last_visit_col = last_visit_sq.c.last_visit
            order_clause = (
                last_visit_col.desc().nulls_last()
                if sort_dir == "desc"
                else last_visit_col.asc().nulls_last()
            )
            query = (
                select(Patient)
                .outerjoin(last_visit_sq, last_visit_sq.c.patient_id == Patient.id)
                .where(*conditions)
                .order_by(order_clause, Patient.last_name, Patient.first_name)
                .offset(offset)
                .limit(page_size)
            )
        else:
            query = (
                select(Patient)
                .where(*conditions)
                .order_by(parse_sort(sort, _SORT_ALLOW, _SORT_DEFAULT), Patient.first_name)
                .offset(offset)
                .limit(page_size)
            )

        result = await db.execute(query)
        return list(result.scalars().all()), total

    @staticmethod
    async def get_patient(
        db: AsyncSession,
        clinic_id: UUID,
        patient_id: UUID,
        *,
        access_predicate: ColumnElement[bool] | None = None,
    ) -> Patient | None:
        conditions = [Patient.id == patient_id, Patient.clinic_id == clinic_id]
        if access_predicate is not None:
            conditions.append(access_predicate)
        result = await db.execute(select(Patient).where(*conditions))
        return result.scalar_one_or_none()

    @staticmethod
    async def create_patient(
        db: AsyncSession, clinic_id: UUID, data: dict, *, created_by_user_id: UUID | None = None
    ) -> Patient:
        patient = Patient(clinic_id=clinic_id, created_by_user_id=created_by_user_id, **data)
        db.add(patient)
        await db.flush()

        await event_bus.publish(
            EventType.PATIENT_CREATED,
            {"patient_id": str(patient.id), "clinic_id": str(clinic_id)},
            db=db,
        )
        return patient

    @staticmethod
    async def update_patient(db: AsyncSession, patient: Patient, data: dict) -> Patient:
        """Update an existing patient.

        ``data`` should come from ``model_dump(exclude_unset=True)`` so
        unspecified fields are preserved and explicit ``None`` clears.
        """
        for key, value in data.items():
            setattr(patient, key, value)

        await db.flush()

        await event_bus.publish(
            EventType.PATIENT_UPDATED,
            {
                "patient_id": str(patient.id),
                "clinic_id": str(patient.clinic_id),
                "changes": list(data.keys()),
            },
        )
        return patient

    @staticmethod
    async def archive_patient(
        db: AsyncSession, patient: Patient, *, archived_by: UUID | None = None
    ) -> Patient:
        patient.status = "archived"
        patient.archived_at = datetime.now(UTC)
        patient.archived_by = archived_by
        await db.flush()

        await event_bus.publish(
            EventType.PATIENT_ARCHIVED,
            {"patient_id": str(patient.id), "clinic_id": str(patient.clinic_id)},
            db=db,
        )
        return patient

    @staticmethod
    async def restore_patient(db: AsyncSession, patient: Patient, *, restored_by: UUID) -> Patient:
        if patient.status != "archived":
            raise HTTPException(status.HTTP_409_CONFLICT, detail="Patient is not archived")
        patient.status = "active"
        patient.restored_at = datetime.now(UTC)
        patient.restored_by = restored_by
        await db.flush()
        await event_bus.publish(
            EventType.PATIENT_RESTORED,
            {
                "patient_id": str(patient.id),
                "clinic_id": str(patient.clinic_id),
                "restored_by": str(restored_by),
            },
            db=db,
        )
        return patient

    @staticmethod
    async def permanently_delete_patient(
        db: AsyncSession, patient: Patient, *, deleted_by: UUID
    ) -> None:
        """Delete module-owned data through transactional event handlers.

        The caller has already resolved the patient by ``clinic_id``.  The
        audit insert and every subscriber share this session, so any raised
        error rolls all database work back in ``get_db``.
        """
        # Fiscal records are immutable by policy.  This preflight happens
        # before creating even the deletion audit, so a 409 changes nothing.
        fiscal = await db.scalar(
            text(
                "SELECT EXISTS (SELECT 1 FROM invoices i "
                "LEFT JOIN verifactu_records vr ON vr.invoice_id = i.id "
                "WHERE i.patient_id = :patient_id AND i.clinic_id = :clinic_id "
                "AND (vr.id IS NOT NULL OR i.invoice_number IS NOT NULL OR i.status <> 'draft'))"
            ),
            {"patient_id": patient.id, "clinic_id": patient.clinic_id},
        )
        if fiscal:
            raise HTTPException(
                status.HTTP_409_CONFLICT,
                detail="El paciente posee documentos fiscales que impiden su eliminación definitiva.",
            )
        audit = PatientPermanentDeletionAudit(
            old_patient_id=patient.id,
            clinic_id=patient.clinic_id,
            patient_name=patient.full_name,
            deleted_by=deleted_by,
            deleted_at=datetime.now(UTC),
            action="patient.permanently_deleted",
        )
        db.add(audit)
        await db.flush()
        payload = {
            "patient_id": str(patient.id),
            "clinic_id": str(patient.clinic_id),
            "deleted_by": str(deleted_by),
        }
        # A fixed phase sequence removes dependent rows before their parents;
        # each subscriber only acts in the phase it owns.
        for phase in (
            "financial",
            "notes",
            "appointments",
            "plans",
            "budgets",
            "odontogram",
            "clinical",
        ):
            await event_bus.publish(
                EventType.PATIENT_PERMANENT_DELETE_REQUESTED,
                {**payload, "phase": phase},
                db=db,
            )
        await db.delete(patient)
        await db.flush()
