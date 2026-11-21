"""Prescriptions — persistence.

Three tables:

* ``prescriptions``         — one issued, dated, numbered, authored document
* ``prescription_items``    — the medications written on it
* ``prescription_counters`` — the per-clinic, per-year number sequence

An issued prescription is a clinical and legal document. It is never edited
and never deleted: the only change it admits is ``issued → voided``, and that
changes nothing but the four void columns. Two tiny triggers enforce it (the
repository's precedent is the NTS record guard, ``odo_0004``); the Python side
adds no second set of rules.

Everything that identifies a person or a place on the printed sheet is a
**snapshot** taken at issue time (``*_snapshot``). A prescription from 2026
must read the same in 2028 whatever happened to the patient, the user or the
clinic in between.

Nothing here is a ``patients_clinical.Medication``: that table records what a
patient *takes*, this one what a dentist *prescribes*. They share no key and
are never synchronised.
"""

from __future__ import annotations

from datetime import date, datetime
from uuid import UUID, uuid4

from sqlalchemy import (
    DDL,
    CheckConstraint,
    Date,
    DateTime,
    ForeignKey,
    ForeignKeyConstraint,
    Index,
    Integer,
    String,
    Text,
    UniqueConstraint,
    event,
)
from sqlalchemy import UUID as SAUUID
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.database import Base

STATUS_ISSUED = "issued"
STATUS_VOIDED = "voided"
STATUSES = (STATUS_ISSUED, STATUS_VOIDED)


class Prescription(Base):
    """An issued prescription. Immutable except for ``issued → voided``."""

    __tablename__ = "prescriptions"

    id: Mapped[UUID] = mapped_column(SAUUID(as_uuid=True), primary_key=True, default=uuid4)
    clinic_id: Mapped[UUID] = mapped_column(
        SAUUID(as_uuid=True), ForeignKey("clinics.id"), nullable=False
    )
    patient_id: Mapped[UUID] = mapped_column(
        SAUUID(as_uuid=True), ForeignKey("patients.id"), nullable=False
    )
    #: Derived from the authenticated context, never from the request.
    prescriber_user_id: Mapped[UUID] = mapped_column(
        SAUUID(as_uuid=True), ForeignKey("users.id"), nullable=False
    )

    #: ``RX-{year}-{sequence:06d}``, unique per clinic.
    number: Mapped[str] = mapped_column(String(30), nullable=False)
    sequence: Mapped[int] = mapped_column(Integer, nullable=False)
    #: The clinic-local year the number belongs to.
    year: Mapped[int] = mapped_column(Integer, nullable=False)

    issued_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    #: The calendar date in the clinic's own timezone.
    issue_date: Mapped[date] = mapped_column(Date, nullable=False)
    valid_until: Mapped[date] = mapped_column(Date, nullable=False)

    #: How many items the prescription was issued with. Immutable like every
    #: other column, and what closes the item set (see ITEM_GUARD_FUNCTION_SQL).
    item_count: Mapped[int] = mapped_column(Integer, nullable=False)

    status: Mapped[str] = mapped_column(String(20), nullable=False, default=STATUS_ISSUED)
    voided_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    voided_by: Mapped[UUID | None] = mapped_column(SAUUID(as_uuid=True), ForeignKey("users.id"))
    void_reason: Mapped[str | None] = mapped_column(Text)

    # --- snapshots, frozen at issue ---------------------------------------
    patient_name_snapshot: Mapped[str] = mapped_column(String(200), nullable=False)
    patient_national_id_snapshot: Mapped[str | None] = mapped_column(String(50))
    patient_national_id_type_snapshot: Mapped[str | None] = mapped_column(String(20))
    patient_date_of_birth_snapshot: Mapped[date] = mapped_column(Date, nullable=False)

    prescriber_name_snapshot: Mapped[str] = mapped_column(String(200), nullable=False)
    prescriber_professional_id_snapshot: Mapped[str] = mapped_column(String(50), nullable=False)

    clinic_name_snapshot: Mapped[str] = mapped_column(String(200), nullable=False)
    clinic_legal_name_snapshot: Mapped[str | None] = mapped_column(String(200))
    clinic_tax_id_snapshot: Mapped[str] = mapped_column(String(20), nullable=False)
    clinic_address_snapshot: Mapped[str | None] = mapped_column(Text)
    clinic_phone_snapshot: Mapped[str | None] = mapped_column(String(20))

    items: Mapped[list[PrescriptionItem]] = relationship(
        back_populates="prescription",
        order_by="PrescriptionItem.position",
        lazy="selectin",
        # No delete cascade: nothing here is ever deleted.
        cascade="save-update, merge",
        viewonly=False,
    )

    __table_args__ = (
        CheckConstraint("status IN ('issued', 'voided')", name="ck_prescription_status"),
        CheckConstraint(
            "(status = 'voided') = "
            "(voided_at IS NOT NULL AND voided_by IS NOT NULL AND void_reason IS NOT NULL)",
            name="ck_prescription_void_coherence",
        ),
        CheckConstraint(
            "void_reason IS NULL OR length(btrim(void_reason)) > 0",
            name="ck_prescription_void_reason_not_blank",
        ),
        CheckConstraint("valid_until >= issue_date", name="ck_prescription_valid_until"),
        CheckConstraint("sequence >= 1", name="ck_prescription_sequence_positive"),
        CheckConstraint("item_count >= 1", name="ck_prescription_item_count_positive"),
        CheckConstraint(
            "length(btrim(prescriber_professional_id_snapshot)) > 0",
            name="ck_prescription_professional_id_not_blank",
        ),
        UniqueConstraint("clinic_id", "number", name="uq_prescription_clinic_number"),
        UniqueConstraint("clinic_id", "year", "sequence", name="uq_prescription_clinic_year_seq"),
        # Target of the composite FK from the items: an item can never point at
        # a prescription of another clinic.
        UniqueConstraint("id", "clinic_id", name="uq_prescription_id_clinic"),
        Index("idx_prescriptions_clinic_patient_issued", "clinic_id", "patient_id", "issued_at"),
    )


class PrescriptionItem(Base):
    """One medication on a prescription. Free text, never normalised."""

    __tablename__ = "prescription_items"

    id: Mapped[UUID] = mapped_column(SAUUID(as_uuid=True), primary_key=True, default=uuid4)
    clinic_id: Mapped[UUID] = mapped_column(
        SAUUID(as_uuid=True), ForeignKey("clinics.id"), nullable=False
    )
    prescription_id: Mapped[UUID] = mapped_column(SAUUID(as_uuid=True), nullable=False)
    #: 1-based, assigned by the service from the order of the payload.
    position: Mapped[int] = mapped_column(Integer, nullable=False)

    # --- required --------------------------------------------------------
    #: Denominación Común Internacional.
    active_ingredient: Mapped[str] = mapped_column(String(200), nullable=False)
    strength: Mapped[str] = mapped_column(String(100), nullable=False)
    pharmaceutical_form: Mapped[str] = mapped_column(String(100), nullable=False)
    dose: Mapped[str] = mapped_column(String(200), nullable=False)
    route: Mapped[str] = mapped_column(String(100), nullable=False)
    frequency: Mapped[str] = mapped_column(String(200), nullable=False)
    duration: Mapped[str] = mapped_column(String(100), nullable=False)
    total_quantity: Mapped[str] = mapped_column(String(100), nullable=False)

    # --- optional --------------------------------------------------------
    commercial_name: Mapped[str | None] = mapped_column(String(200))
    presentation: Mapped[str | None] = mapped_column(String(200))
    instructions: Mapped[str | None] = mapped_column(Text)

    prescription: Mapped[Prescription] = relationship(back_populates="items")

    __table_args__ = (
        ForeignKeyConstraint(
            ["prescription_id", "clinic_id"],
            ["prescriptions.id", "prescriptions.clinic_id"],
            name="fk_prescription_item_prescription_clinic",
            ondelete="RESTRICT",
        ),
        CheckConstraint("position >= 1", name="ck_prescription_item_position"),
        CheckConstraint(
            "length(btrim(active_ingredient)) > 0 AND length(btrim(strength)) > 0 "
            "AND length(btrim(pharmaceutical_form)) > 0 AND length(btrim(dose)) > 0 "
            "AND length(btrim(route)) > 0 AND length(btrim(frequency)) > 0 "
            "AND length(btrim(duration)) > 0 AND length(btrim(total_quantity)) > 0",
            name="ck_prescription_item_required_not_blank",
        ),
        UniqueConstraint("prescription_id", "position", name="uq_prescription_item_position"),
        Index("idx_prescription_items_prescription", "prescription_id"),
    )


class PrescriptionCounter(Base):
    """The last number issued for a clinic in a (clinic-local) year."""

    __tablename__ = "prescription_counters"

    clinic_id: Mapped[UUID] = mapped_column(
        SAUUID(as_uuid=True), ForeignKey("clinics.id"), primary_key=True
    )
    year: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=False)
    last_number: Mapped[int] = mapped_column(Integer, nullable=False)

    __table_args__ = (CheckConstraint("last_number >= 1", name="ck_prescription_counter_positive"),)


# ---------------------------------------------------------------------------
# Immutability triggers
#
# Tiny, and they only refuse: nothing is computed or fabricated. They are
# attached to ``create_all`` here so the test database has them, and
# re-declared verbatim in migration ``pres_0001`` so that migration stays a
# frozen snapshot. One statement per DDL object (asyncpg refuses
# multi-command strings), and no ``%`` anywhere: SQLAlchemy's ``DDL`` would
# read it as a placeholder.
# ---------------------------------------------------------------------------

PRESCRIPTION_GUARD_FUNCTION_SQL = """
CREATE OR REPLACE FUNCTION prescriptions_guard() RETURNS trigger AS $$
BEGIN
    IF TG_OP = 'DELETE' THEN
        RAISE EXCEPTION USING
            MESSAGE = 'prescription ' || OLD.id || ' cannot be deleted',
            ERRCODE = 'restrict_violation';
    END IF;
    IF OLD.status <> 'issued' THEN
        RAISE EXCEPTION USING
            MESSAGE = 'prescription ' || OLD.id || ' is ' || OLD.status
                      || ' and immutable',
            ERRCODE = 'restrict_violation';
    END IF;
    IF NEW.status <> 'voided' THEN
        RAISE EXCEPTION USING
            MESSAGE = 'prescription ' || OLD.id
                      || ' can only change by being voided',
            ERRCODE = 'restrict_violation';
    END IF;
    IF (to_jsonb(NEW) - 'status' - 'voided_at' - 'voided_by' - 'void_reason')
       IS DISTINCT FROM
       (to_jsonb(OLD) - 'status' - 'voided_at' - 'voided_by' - 'void_reason') THEN
        RAISE EXCEPTION USING
            MESSAGE = 'prescription ' || OLD.id
                      || ' is immutable apart from its void fields',
            ERRCODE = 'restrict_violation';
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql
"""

PRESCRIPTION_GUARD_TRIGGER_SQL = """
CREATE TRIGGER trg_prescriptions_guard
BEFORE UPDATE OR DELETE ON prescriptions
FOR EACH ROW EXECUTE FUNCTION prescriptions_guard()
"""

ITEM_GUARD_FUNCTION_SQL = """
CREATE OR REPLACE FUNCTION prescription_items_guard() RETURNS trigger AS $$
DECLARE
    parent_status text;
    declared integer;
BEGIN
    IF TG_OP = 'INSERT' THEN
        SELECT p.status, p.item_count INTO parent_status, declared
        FROM prescriptions p WHERE p.id = NEW.prescription_id;
        IF parent_status IS DISTINCT FROM 'issued' THEN
            RAISE EXCEPTION USING
                MESSAGE = 'items can only be added to an issued prescription',
                ERRCODE = 'restrict_violation';
        END IF;
        IF NEW.position > declared THEN
            RAISE EXCEPTION USING
                MESSAGE = 'prescription ' || NEW.prescription_id
                          || ' declares ' || declared || ' items; position '
                          || NEW.position || ' is outside them',
                ERRCODE = 'restrict_violation';
        END IF;
        RETURN NEW;
    END IF;
    RAISE EXCEPTION USING
        MESSAGE = 'prescription_items are immutable (' || TG_OP || ' refused)',
        ERRCODE = 'restrict_violation';
END;
$$ LANGUAGE plpgsql
"""

ITEM_GUARD_TRIGGER_SQL = """
CREATE TRIGGER trg_prescription_items_guard
BEFORE INSERT OR UPDATE OR DELETE ON prescription_items
FOR EACH ROW EXECUTE FUNCTION prescription_items_guard()
"""

#: At COMMIT a prescription must hold exactly the items it declared. With the
#: unique ``(prescription_id, position)`` and the ``position <= item_count``
#: rule above, this closes the set: once the issuing transaction commits every
#: position ``1..item_count`` is taken, so no later INSERT can add an item. No
#: transient state, no session setting and no time window: the header's own
#: (immutable) ``item_count`` is the whole mechanism, and a rollback takes the
#: header, the items and the counter away together.
PRESCRIPTION_COMPLETE_FUNCTION_SQL = """
CREATE OR REPLACE FUNCTION prescriptions_require_all_items() RETURNS trigger AS $$
DECLARE
    actual integer;
BEGIN
    SELECT count(*) INTO actual FROM prescription_items WHERE prescription_id = NEW.id;
    IF actual <> NEW.item_count THEN
        RAISE EXCEPTION USING
            MESSAGE = 'prescription ' || NEW.id || ' declares ' || NEW.item_count
                      || ' items but has ' || actual,
            ERRCODE = 'check_violation';
    END IF;
    RETURN NULL;
END;
$$ LANGUAGE plpgsql
"""

PRESCRIPTION_COMPLETE_TRIGGER_SQL = """
CREATE CONSTRAINT TRIGGER trg_prescriptions_complete
AFTER INSERT ON prescriptions
DEFERRABLE INITIALLY DEFERRED
FOR EACH ROW EXECUTE FUNCTION prescriptions_require_all_items()
"""

for _table, _statements in (
    (
        Prescription,
        (
            PRESCRIPTION_GUARD_FUNCTION_SQL,
            PRESCRIPTION_GUARD_TRIGGER_SQL,
            PRESCRIPTION_COMPLETE_FUNCTION_SQL,
            PRESCRIPTION_COMPLETE_TRIGGER_SQL,
        ),
    ),
    (PrescriptionItem, (ITEM_GUARD_FUNCTION_SQL, ITEM_GUARD_TRIGGER_SQL)),
):
    for _statement in _statements:
        event.listen(_table.__table__, "after_create", DDL(_statement))
