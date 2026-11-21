"""Add the ``evolution`` note type.

``evolution`` is a patient-owned, tooth-less, longitudinal clinical entry
(the "Evolución" tab of the clinical record). It is **not** a diagnosis, so
it gets its own discriminator rather than reusing ``diagnosis``.

Only the two CHECK constraints change. ``note_type`` is already VARCHAR(40)
(cn_0004) and no existing row is rewritten, so every earlier note stays valid.

Downgrade restores the cn_0003 constraints. Rows with ``note_type =
'evolution'`` cannot satisfy them, so they are removed first, together with
their attachment links — the same loss any rollback of a new type implies.

Revision ID: cn_0005
Revises: cn_0004
Create Date: 2026-10-02

"""

from collections.abc import Sequence

from alembic import op

revision: str = "cn_0005"
down_revision: str | None = "cn_0004"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


_NOTE_TYPE_NEW = (
    "note_type IN ('administrative', 'diagnosis', 'evolution', 'treatment', "
    "'treatment_plan', 'appointment_clinical', 'appointment_administrative')"
)
_NOTE_TYPE_OLD = (
    "note_type IN ('administrative', 'diagnosis', 'treatment', "
    "'treatment_plan', 'appointment_clinical', 'appointment_administrative')"
)

_MATRIX_OLD = (
    "(note_type = 'administrative' AND owner_type = 'patient' AND tooth_number IS NULL) "
    "OR (note_type = 'diagnosis' AND owner_type = 'patient') "
    "OR (note_type = 'treatment' AND owner_type = 'treatment' AND tooth_number IS NULL) "
    "OR (note_type = 'treatment_plan' AND owner_type = 'plan' "
    "AND tooth_number IS NULL) "
    "OR (note_type = 'appointment_clinical' AND owner_type = 'appointment' "
    "AND tooth_number IS NULL) "
    "OR (note_type = 'appointment_administrative' AND owner_type = 'appointment' "
    "AND tooth_number IS NULL)"
)
_MATRIX_NEW = _MATRIX_OLD.replace(
    "OR (note_type = 'treatment' ",
    "OR (note_type = 'evolution' AND owner_type = 'patient' AND tooth_number IS NULL) "
    "OR (note_type = 'treatment' ",
    1,
)


def _swap(note_type_sql: str, matrix_sql: str) -> None:
    op.drop_constraint("ck_clinical_notes_type_owner_matrix", "clinical_notes", type_="check")
    op.drop_constraint("ck_clinical_notes_note_type", "clinical_notes", type_="check")
    op.create_check_constraint("ck_clinical_notes_note_type", "clinical_notes", note_type_sql)
    op.create_check_constraint("ck_clinical_notes_type_owner_matrix", "clinical_notes", matrix_sql)


def upgrade() -> None:
    _swap(_NOTE_TYPE_NEW, _MATRIX_NEW)


def downgrade() -> None:
    # Attachments of an evolution note live in ``media`` and point at it as
    # ``owner_type = 'clinical_note'``; drop those links before the notes.
    op.execute(
        "DELETE FROM media_attachments WHERE owner_type = 'clinical_note' "
        "AND owner_id IN (SELECT id FROM clinical_notes WHERE note_type = 'evolution')"
    )
    op.execute("DELETE FROM clinical_notes WHERE note_type = 'evolution'")
    _swap(_NOTE_TYPE_OLD, _MATRIX_OLD)
