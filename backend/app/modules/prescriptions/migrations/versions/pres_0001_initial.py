"""prescriptions — initial.

Creates the three tables of the module and the two immutability triggers.
Additive only: no table of any other module is touched and nothing is
backfilled.

Tables:

* ``prescriptions``         — one issued, numbered, authored document
* ``prescription_items``    — its medications (free text)
* ``prescription_counters`` — per-clinic, per-year number sequence

An issued prescription is never edited or deleted. The guard triggers refuse
everything except the ``issued → voided`` transition, which may change only
``status``, ``voided_at``, ``voided_by`` and ``void_reason``; items refuse every
UPDATE and DELETE.

The item set is closed by the header's own immutable ``item_count``: an item
INSERT is accepted only on an issued prescription with ``position <=
item_count`` (``(prescription_id, position)`` is unique), and a deferred
constraint trigger checks at COMMIT that exactly ``item_count`` items exist.
After the issuing transaction commits every position is taken, so no later
INSERT can add an item. There is no draft state, no session setting and no
time window, and a rollback removes header, items and counter together.

The trigger SQL is duplicated verbatim from
``app.modules.prescriptions.models`` on purpose: a migration must stay a frozen
snapshot and must not change when application code changes.

Chained off the foundational core revision, with the ``patients`` table
guaranteed through ``depends_on`` (the same shape as ``rec_0001``).

Revision ID: pres_0001
Revises: 0001
Create Date: 2026-10-04
"""

from collections.abc import Sequence

import sqlalchemy as sa

from alembic import op

revision: str = "pres_0001"
down_revision: str | None = "0001"
branch_labels: str | Sequence[str] | None = ("prescriptions",)
depends_on: str | Sequence[str] | None = ("pat_0001",)


# One statement per execute: asyncpg prepares each statement and refuses a
# multi-command string.

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


def upgrade() -> None:
    op.create_table(
        "prescriptions",
        sa.Column("id", sa.UUID(), nullable=False),
        sa.Column("clinic_id", sa.UUID(), nullable=False),
        sa.Column("patient_id", sa.UUID(), nullable=False),
        sa.Column("prescriber_user_id", sa.UUID(), nullable=False),
        sa.Column("number", sa.String(length=30), nullable=False),
        sa.Column("sequence", sa.Integer(), nullable=False),
        sa.Column("year", sa.Integer(), nullable=False),
        sa.Column("issued_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("issue_date", sa.Date(), nullable=False),
        sa.Column("valid_until", sa.Date(), nullable=False),
        sa.Column("item_count", sa.Integer(), nullable=False),
        sa.Column("status", sa.String(length=20), nullable=False),
        sa.Column("voided_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("voided_by", sa.UUID(), nullable=True),
        sa.Column("void_reason", sa.Text(), nullable=True),
        sa.Column("patient_name_snapshot", sa.String(length=200), nullable=False),
        sa.Column("patient_national_id_snapshot", sa.String(length=50), nullable=True),
        sa.Column("patient_national_id_type_snapshot", sa.String(length=20), nullable=True),
        sa.Column("patient_date_of_birth_snapshot", sa.Date(), nullable=False),
        sa.Column("prescriber_name_snapshot", sa.String(length=200), nullable=False),
        sa.Column("prescriber_professional_id_snapshot", sa.String(length=50), nullable=False),
        sa.Column("clinic_name_snapshot", sa.String(length=200), nullable=False),
        sa.Column("clinic_legal_name_snapshot", sa.String(length=200), nullable=True),
        sa.Column("clinic_tax_id_snapshot", sa.String(length=20), nullable=False),
        sa.Column("clinic_address_snapshot", sa.Text(), nullable=True),
        sa.Column("clinic_phone_snapshot", sa.String(length=20), nullable=True),
        sa.PrimaryKeyConstraint("id"),
        sa.ForeignKeyConstraint(["clinic_id"], ["clinics.id"]),
        sa.ForeignKeyConstraint(["patient_id"], ["patients.id"]),
        sa.ForeignKeyConstraint(["prescriber_user_id"], ["users.id"]),
        sa.ForeignKeyConstraint(["voided_by"], ["users.id"]),
        sa.CheckConstraint("status IN ('issued', 'voided')", name="ck_prescription_status"),
        sa.CheckConstraint(
            "(status = 'voided') = "
            "(voided_at IS NOT NULL AND voided_by IS NOT NULL AND void_reason IS NOT NULL)",
            name="ck_prescription_void_coherence",
        ),
        sa.CheckConstraint(
            "void_reason IS NULL OR length(btrim(void_reason)) > 0",
            name="ck_prescription_void_reason_not_blank",
        ),
        sa.CheckConstraint("valid_until >= issue_date", name="ck_prescription_valid_until"),
        sa.CheckConstraint("sequence >= 1", name="ck_prescription_sequence_positive"),
        sa.CheckConstraint("item_count >= 1", name="ck_prescription_item_count_positive"),
        sa.CheckConstraint(
            "length(btrim(prescriber_professional_id_snapshot)) > 0",
            name="ck_prescription_professional_id_not_blank",
        ),
        sa.UniqueConstraint("clinic_id", "number", name="uq_prescription_clinic_number"),
        sa.UniqueConstraint(
            "clinic_id", "year", "sequence", name="uq_prescription_clinic_year_seq"
        ),
        sa.UniqueConstraint("id", "clinic_id", name="uq_prescription_id_clinic"),
    )
    op.create_index(
        "idx_prescriptions_clinic_patient_issued",
        "prescriptions",
        ["clinic_id", "patient_id", "issued_at"],
    )

    op.create_table(
        "prescription_items",
        sa.Column("id", sa.UUID(), nullable=False),
        sa.Column("clinic_id", sa.UUID(), nullable=False),
        sa.Column("prescription_id", sa.UUID(), nullable=False),
        sa.Column("position", sa.Integer(), nullable=False),
        sa.Column("active_ingredient", sa.String(length=200), nullable=False),
        sa.Column("strength", sa.String(length=100), nullable=False),
        sa.Column("pharmaceutical_form", sa.String(length=100), nullable=False),
        sa.Column("dose", sa.String(length=200), nullable=False),
        sa.Column("route", sa.String(length=100), nullable=False),
        sa.Column("frequency", sa.String(length=200), nullable=False),
        sa.Column("duration", sa.String(length=100), nullable=False),
        sa.Column("total_quantity", sa.String(length=100), nullable=False),
        sa.Column("commercial_name", sa.String(length=200), nullable=True),
        sa.Column("presentation", sa.String(length=200), nullable=True),
        sa.Column("instructions", sa.Text(), nullable=True),
        sa.PrimaryKeyConstraint("id"),
        sa.ForeignKeyConstraint(["clinic_id"], ["clinics.id"]),
        sa.ForeignKeyConstraint(
            ["prescription_id", "clinic_id"],
            ["prescriptions.id", "prescriptions.clinic_id"],
            name="fk_prescription_item_prescription_clinic",
            ondelete="RESTRICT",
        ),
        sa.CheckConstraint("position >= 1", name="ck_prescription_item_position"),
        sa.CheckConstraint(
            "length(btrim(active_ingredient)) > 0 AND length(btrim(strength)) > 0 "
            "AND length(btrim(pharmaceutical_form)) > 0 AND length(btrim(dose)) > 0 "
            "AND length(btrim(route)) > 0 AND length(btrim(frequency)) > 0 "
            "AND length(btrim(duration)) > 0 AND length(btrim(total_quantity)) > 0",
            name="ck_prescription_item_required_not_blank",
        ),
        sa.UniqueConstraint("prescription_id", "position", name="uq_prescription_item_position"),
    )
    op.create_index(
        "idx_prescription_items_prescription", "prescription_items", ["prescription_id"]
    )

    op.create_table(
        "prescription_counters",
        sa.Column("clinic_id", sa.UUID(), nullable=False),
        sa.Column("year", sa.Integer(), autoincrement=False, nullable=False),
        sa.Column("last_number", sa.Integer(), nullable=False),
        sa.PrimaryKeyConstraint("clinic_id", "year"),
        sa.ForeignKeyConstraint(["clinic_id"], ["clinics.id"]),
        sa.CheckConstraint("last_number >= 1", name="ck_prescription_counter_positive"),
    )

    op.execute(PRESCRIPTION_GUARD_FUNCTION_SQL)
    op.execute(PRESCRIPTION_GUARD_TRIGGER_SQL)
    op.execute(ITEM_GUARD_FUNCTION_SQL)
    op.execute(ITEM_GUARD_TRIGGER_SQL)
    op.execute(PRESCRIPTION_COMPLETE_FUNCTION_SQL)
    op.execute(PRESCRIPTION_COMPLETE_TRIGGER_SQL)


def downgrade() -> None:
    # Triggers first, then the tables that depend on one another, then the
    # functions the triggers used. DROP TABLE does not fire row triggers.
    op.execute("DROP TRIGGER IF EXISTS trg_prescriptions_complete ON prescriptions")
    op.execute("DROP TRIGGER IF EXISTS trg_prescription_items_guard ON prescription_items")
    op.execute("DROP TRIGGER IF EXISTS trg_prescriptions_guard ON prescriptions")
    op.drop_table("prescription_counters")
    op.drop_index("idx_prescription_items_prescription", table_name="prescription_items")
    op.drop_table("prescription_items")
    op.drop_index("idx_prescriptions_clinic_patient_issued", table_name="prescriptions")
    op.drop_table("prescriptions")
    op.execute("DROP FUNCTION IF EXISTS prescriptions_require_all_items()")
    op.execute("DROP FUNCTION IF EXISTS prescription_items_guard()")
    op.execute("DROP FUNCTION IF EXISTS prescriptions_guard()")
