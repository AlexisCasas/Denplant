"""Pure SQL coverage for the archived-patient list scope."""

from uuid import uuid4

from app.modules.patients.access import PatientAccessPolicy


def _sql(role: str, *, include_archived: bool) -> str:
    predicate = PatientAccessPolicy.list_predicate_for(
        role,
        uuid4(),
        uuid4(),
        include_archived=include_archived,
    )
    return str(predicate)


def test_non_dentist_list_scope_keeps_clinic_isolation_and_status_filter() -> None:
    active_sql = _sql("receptionist", include_archived=False)
    archived_sql = _sql("receptionist", include_archived=True)

    assert "patients.clinic_id" in active_sql
    assert "patients.status" in active_sql
    assert "patients.status" not in archived_sql


def test_dentist_archived_list_keeps_creator_or_appointment_scope() -> None:
    archived_sql = _sql("dentist", include_archived=True)

    assert "patients.clinic_id" in archived_sql
    assert "patients.created_by_user_id" in archived_sql
    assert "appointments" in archived_sql
    assert "patients.status" not in archived_sql
