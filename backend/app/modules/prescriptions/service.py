"""Prescriptions — the transactional layer.

Business rules only, no HTTP. The service **flushes but never commits**: the
transaction belongs to the caller (``get_db`` in production), which is what
makes issuing atomic — the number, the prescription and every item land
together or not at all, and a rollback hands the number back.

Three rules live here rather than in the permission table, because the
permission table cannot express them:

* **Who may issue.** Only a ``dentist`` membership with a registered
  ``professional_id``. The ``admin`` role carries a wildcard that matches
  ``prescriptions.prescribe`` too, and ``is_professional`` is true for
  hygienists as well, so neither says "this person is a dentist". An admin who
  is also a dentist cannot issue from an admin account yet; that is deliberate.
* **Who may void.** The original prescriber, or an admin.
* **Which patient.** Every operation goes through ``PatientAccessPolicy``; what
  the caller may not see is reported as not found.

The prescriber, the clinic and every snapshot come from the authenticated
context and the database, never from the request.
"""

from __future__ import annotations

from dataclasses import dataclass
from datetime import UTC, date, datetime
from uuid import UUID, uuid4
from zoneinfo import ZoneInfo, ZoneInfoNotFoundError

from sqlalchemy import func, select, update
from sqlalchemy.dialects.postgresql import insert as pg_insert
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.auth.dependencies import ClinicContext
from app.modules.patients.access import PatientAccessPolicy
from app.modules.patients.models import Patient

from .exceptions import (
    PatientNotFoundError,
    PrescriberNotEligibleError,
    PrescriptionNotFoundError,
    PrescriptionStateError,
    PrescriptionValidationError,
    VoidNotAllowedError,
)
from .models import (
    STATUS_ISSUED,
    STATUS_VOIDED,
    Prescription,
    PrescriptionCounter,
    PrescriptionItem,
)
from .schemas import PrescriptionCreate

#: The role that may issue. A constant, not a permission: see the module docstring.
PRESCRIBER_ROLE = "dentist"
VOIDER_ADMIN_ROLE = "admin"


def format_clinic_address(address: dict | None) -> str | None:
    """Flatten a clinic address into one deterministic line.

    The same keys in the same order every time (``street``, ``postal_code`` and
    ``city``, ``country``), so the stored text does not depend on dict ordering
    and a future printout reads the same however the address was typed in.
    ``None`` when there is nothing to print.
    """
    if not address:
        return None
    parts: list[str] = []
    street = _clean(address.get("street"))
    if street:
        parts.append(street)
    locality = " ".join(
        part for part in (_clean(address.get("postal_code")), _clean(address.get("city"))) if part
    )
    if locality:
        parts.append(locality)
    country = _clean(address.get("country"))
    if country:
        parts.append(country)
    return ", ".join(parts) or None


def _clean(value: object) -> str | None:
    if value is None:
        return None
    text = str(value).strip()
    return text or None


def _full_name(first: str | None, last: str | None) -> str:
    return " ".join(part for part in ((first or "").strip(), (last or "").strip()) if part)


@dataclass(frozen=True)
class SummaryRow:
    """One line of a patient's history; no items are loaded for it."""

    id: UUID
    number: str
    issued_at: datetime
    issue_date: date
    valid_until: date
    prescriber_name_snapshot: str
    item_count: int
    status: str
    voided_at: datetime | None


class PrescriptionService:
    # ------------------------------------------------------------------
    # rules
    # ------------------------------------------------------------------

    @staticmethod
    def require_eligible_prescriber(ctx: ClinicContext) -> str:
        """The caller's registered ``professional_id``, or a refusal.

        Checked in addition to the permission, and before anything else, so an
        ineligible caller learns nothing about patients.
        """
        if ctx.role != PRESCRIBER_ROLE:
            raise PrescriberNotEligibleError("only a dentist may issue prescriptions")
        professional_id = (ctx.user.professional_id or "").strip()
        if not professional_id:
            raise PrescriptionValidationError(
                "prescriber_professional_id_required",
                "the prescriber has no professional registration number on file",
            )
        return professional_id

    @staticmethod
    def clinic_zone(timezone: str | None) -> ZoneInfo:
        """The clinic's timezone, or a refusal.

        Never a silent fallback: an issue date computed in a guessed zone is a
        wrong date on a legal document.
        """
        try:
            return ZoneInfo((timezone or "").strip())
        except (ZoneInfoNotFoundError, ValueError, KeyError) as exc:
            raise PrescriptionValidationError(
                "clinic_timezone_invalid",
                "the clinic has no valid timezone configured",
            ) from exc

    @staticmethod
    async def _accessible_patient(
        db: AsyncSession, ctx: ClinicContext, patient_id: UUID
    ) -> Patient:
        patient = (
            await db.execute(
                select(Patient).where(
                    Patient.id == patient_id,
                    PatientAccessPolicy.predicate(ctx),
                )
            )
        ).scalar_one_or_none()
        if patient is None:
            raise PatientNotFoundError("patient not found")
        return patient

    @staticmethod
    async def _next_sequence(db: AsyncSession, clinic_id: UUID, year: int) -> int:
        """Take the next number for this clinic and year.

        One statement does the insert-or-increment and returns the new value,
        and the row it touches stays locked until the caller's transaction
        ends. Two concurrent issues therefore take turns instead of reading the
        same maximum, and because the increment is part of the issuing
        transaction, a rollback gives the number back: the sequence has no gaps.
        """
        table = PrescriptionCounter.__table__
        statement = (
            pg_insert(table)
            .values(clinic_id=clinic_id, year=year, last_number=1)
            .on_conflict_do_update(
                index_elements=[table.c.clinic_id, table.c.year],
                set_={"last_number": table.c.last_number + 1},
            )
            .returning(table.c.last_number)
        )
        return int((await db.execute(statement)).scalar_one())

    # ------------------------------------------------------------------
    # issue
    # ------------------------------------------------------------------

    @staticmethod
    async def issue(db: AsyncSession, ctx: ClinicContext, data: PrescriptionCreate) -> Prescription:
        """Issue a prescription: number, header, snapshots and items, together."""
        professional_id = PrescriptionService.require_eligible_prescriber(ctx)
        patient = await PrescriptionService._accessible_patient(db, ctx, data.patient_id)

        if patient.date_of_birth is None:
            raise PrescriptionValidationError(
                "patient_date_of_birth_required",
                "the patient has no date of birth on file; it is needed to issue a prescription",
            )

        clinic = ctx.clinic
        zone = PrescriptionService.clinic_zone(clinic.timezone)
        issued_at = datetime.now(UTC)
        issue_date = issued_at.astimezone(zone).date()

        if patient.date_of_birth > issue_date:
            raise PrescriptionValidationError(
                "patient_date_of_birth_invalid",
                "the patient's date of birth is in the future",
            )
        if data.valid_until < issue_date:
            raise PrescriptionValidationError(
                "valid_until_before_issue_date",
                "the validity cannot end before the day of issue",
            )

        year = issue_date.year
        sequence = await PrescriptionService._next_sequence(db, ctx.clinic_id, year)

        prescription = Prescription(
            id=uuid4(),
            clinic_id=ctx.clinic_id,
            patient_id=patient.id,
            prescriber_user_id=ctx.user_id,
            number=f"RX-{year}-{sequence:06d}",
            sequence=sequence,
            year=year,
            issued_at=issued_at,
            issue_date=issue_date,
            valid_until=data.valid_until,
            item_count=len(data.items),
            status=STATUS_ISSUED,
            patient_name_snapshot=_full_name(patient.first_name, patient.last_name),
            patient_national_id_snapshot=_clean(patient.national_id),
            patient_national_id_type_snapshot=_clean(patient.national_id_type),
            patient_date_of_birth_snapshot=patient.date_of_birth,
            prescriber_name_snapshot=_full_name(ctx.user.first_name, ctx.user.last_name),
            prescriber_professional_id_snapshot=professional_id,
            clinic_name_snapshot=clinic.name,
            clinic_legal_name_snapshot=_clean(clinic.legal_name),
            clinic_tax_id_snapshot=clinic.tax_id,
            clinic_address_snapshot=format_clinic_address(clinic.address),
            clinic_phone_snapshot=_clean(clinic.phone),
        )
        prescription.items = [
            PrescriptionItem(
                clinic_id=ctx.clinic_id,
                position=position,
                **item.model_dump(),
            )
            for position, item in enumerate(data.items, start=1)
        ]
        db.add(prescription)
        await db.flush()
        return prescription

    # ------------------------------------------------------------------
    # read
    # ------------------------------------------------------------------

    @staticmethod
    async def get(
        db: AsyncSession, clinic_id: UUID, prescription_id: UUID, *, refresh: bool = False
    ) -> Prescription | None:
        """One prescription of this clinic, items by position. No patient check."""
        statement = select(Prescription).where(
            Prescription.id == prescription_id, Prescription.clinic_id == clinic_id
        )
        if refresh:
            statement = statement.execution_options(populate_existing=True)
        return (await db.execute(statement)).scalar_one_or_none()

    @staticmethod
    async def get_accessible(
        db: AsyncSession, ctx: ClinicContext, prescription_id: UUID
    ) -> Prescription:
        """The prescription, if this caller may see its patient; otherwise not found."""
        prescription = await PrescriptionService.get(db, ctx.clinic_id, prescription_id)
        if prescription is None or not await PatientAccessPolicy.can_access(
            db, ctx, prescription.patient_id
        ):
            raise PrescriptionNotFoundError("prescription not found")
        return prescription

    @staticmethod
    async def list_for_patient(
        db: AsyncSession,
        ctx: ClinicContext,
        patient_id: UUID,
        *,
        page: int = 1,
        page_size: int = 20,
    ) -> tuple[list[SummaryRow], int]:
        """A patient's history, newest first, without loading any item."""
        await PrescriptionService._accessible_patient(db, ctx, patient_id)

        filters = (
            Prescription.clinic_id == ctx.clinic_id,
            Prescription.patient_id == patient_id,
        )
        total = await db.scalar(select(func.count()).select_from(Prescription).where(*filters))
        rows = (
            await db.execute(
                select(
                    Prescription.id,
                    Prescription.number,
                    Prescription.issued_at,
                    Prescription.issue_date,
                    Prescription.valid_until,
                    Prescription.prescriber_name_snapshot,
                    Prescription.item_count,
                    Prescription.status,
                    Prescription.voided_at,
                )
                .where(*filters)
                .order_by(Prescription.issued_at.desc(), Prescription.id.desc())
                .offset((page - 1) * page_size)
                .limit(page_size)
            )
        ).all()
        return [SummaryRow(*row) for row in rows], int(total or 0)

    # ------------------------------------------------------------------
    # void
    # ------------------------------------------------------------------

    @staticmethod
    async def void(
        db: AsyncSession, ctx: ClinicContext, prescription_id: UUID, reason: str
    ) -> Prescription:
        """Void an issued prescription. Nothing else about it changes.

        One conditional ``UPDATE`` makes the transition: if two callers race,
        exactly one finds the row still ``issued`` and the other is told it is
        already voided. The database trigger refuses any other change.
        """
        reason = (reason or "").strip()
        if not reason:
            raise PrescriptionValidationError("void_reason_required", "a void reason is required")

        prescription = await PrescriptionService.get_accessible(db, ctx, prescription_id)

        is_admin = ctx.role == VOIDER_ADMIN_ROLE
        is_original_prescriber = (
            ctx.role == PRESCRIBER_ROLE and prescription.prescriber_user_id == ctx.user_id
        )
        if not (is_admin or is_original_prescriber):
            raise VoidNotAllowedError("only the original prescriber or an admin may void it")

        if prescription.status != STATUS_ISSUED:
            raise PrescriptionStateError("this prescription is already voided")

        updated = (
            await db.execute(
                update(Prescription)
                .where(
                    Prescription.id == prescription_id,
                    Prescription.clinic_id == ctx.clinic_id,
                    Prescription.status == STATUS_ISSUED,
                )
                .values(
                    status=STATUS_VOIDED,
                    voided_at=datetime.now(UTC),
                    voided_by=ctx.user_id,
                    void_reason=reason,
                )
                .returning(Prescription.id)
                .execution_options(synchronize_session=False)
            )
        ).scalar_one_or_none()
        if updated is None:
            raise PrescriptionStateError("this prescription is already voided")

        refreshed = await PrescriptionService.get(db, ctx.clinic_id, prescription_id, refresh=True)
        assert refreshed is not None
        return refreshed
