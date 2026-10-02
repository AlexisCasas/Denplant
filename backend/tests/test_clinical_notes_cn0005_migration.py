"""cn_0005 — the ``evolution`` note type, upgrade and downgrade.

``db_session`` builds the schema from the models, i.e. the post-cn_0005
shape. The migration's own ``downgrade()`` / ``upgrade()`` are then run
against it through an Alembic ``Operations`` context, which is the same code
``alembic downgrade`` / ``alembic upgrade`` would execute.
"""

from __future__ import annotations

import importlib.util
from pathlib import Path
from uuid import UUID, uuid4

import pytest
from alembic.migration import MigrationContext
from alembic.operations import Operations
from httpx import AsyncClient
from sqlalchemy import text
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.auth.models import Clinic
from app.modules.patients.models import Patient

MIGRATION = (
    Path(__file__).resolve().parents[1]
    / "app/modules/clinical_notes/migrations/versions/cn_0005_evolution_note_type.py"
)


def _load():
    spec = importlib.util.spec_from_file_location("cn_0005", MIGRATION)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


async def _run(db_session: AsyncSession, step: str) -> None:
    migration = _load()
    await db_session.commit()
    connection = await db_session.connection()

    def _apply(sync_connection) -> None:
        with Operations.context(MigrationContext.configure(sync_connection)):
            getattr(migration, step)()

    await connection.run_sync(_apply)
    await db_session.commit()


async def _insert(
    db_session: AsyncSession,
    clinic_id: UUID,
    author_id: str,
    owner_id: UUID,
    note_type: str,
    tooth: int | None = None,
) -> None:
    await db_session.execute(
        text(
            "INSERT INTO clinical_notes (id, clinic_id, note_type, owner_type, owner_id, "
            "tooth_number, body, author_id, created_at, updated_at) VALUES "
            "(:id, :clinic, :nt, 'patient', :owner, :tooth, 'x', :author, now(), now())"
        ),
        {
            "id": uuid4(),
            "clinic": clinic_id,
            "nt": note_type,
            "owner": owner_id,
            "tooth": tooth,
            "author": UUID(author_id),
        },
    )
    await db_session.flush()


@pytest.mark.asyncio
async def test_downgrade_then_upgrade_keeps_old_notes_and_gates_evolution(
    client: AsyncClient,
    auth_headers: dict[str, str],
    db_session: AsyncSession,
    test_clinic: Clinic,
    test_patient: Patient,
) -> None:
    me = await client.get("/api/v1/auth/me", headers=auth_headers)
    author = me.json()["data"]["user"]["id"]
    clinic_id, patient_id = test_clinic.id, test_patient.id

    await _insert(db_session, clinic_id, author, patient_id, "administrative")
    await _insert(db_session, clinic_id, author, patient_id, "diagnosis", tooth=36)
    await _insert(db_session, clinic_id, author, patient_id, "evolution")
    await db_session.commit()

    # --- downgrade: the type disappears, everything older survives --------
    await _run(db_session, "downgrade")
    rows = await db_session.execute(text("SELECT note_type FROM clinical_notes ORDER BY note_type"))
    assert [r[0] for r in rows] == ["administrative", "diagnosis"]

    with pytest.raises(IntegrityError):
        await _insert(db_session, clinic_id, author, patient_id, "evolution")
    await db_session.rollback()

    # --- upgrade: evolution is legal again, with its own matrix -----------
    await _run(db_session, "upgrade")
    await _insert(db_session, clinic_id, author, patient_id, "evolution")
    await db_session.commit()

    with pytest.raises(IntegrityError):
        await _insert(db_session, clinic_id, author, patient_id, "evolution", tooth=11)
    await db_session.rollback()

    rows = await db_session.execute(
        text("SELECT note_type, tooth_number FROM clinical_notes ORDER BY note_type")
    )
    assert [tuple(r) for r in rows] == [
        ("administrative", None),
        ("diagnosis", 36),
        ("evolution", None),
    ]


def test_migration_is_chained_after_cn_0004() -> None:
    migration = _load()
    assert migration.revision == "cn_0005"
    assert migration.down_revision == "cn_0004"
    # The branch label lives on the first revision of the clinical_notes branch.
    assert migration.branch_labels is None
