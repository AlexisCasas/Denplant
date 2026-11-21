"""INFRA-01 — the guard that keeps pytest off the development database.

Pure unit tests: no database, no fixtures. They assert the decision table in
``tests/db_isolation`` directly, which is the part that must never regress —
a silent fallback here destroys a developer's working schema.
"""

from __future__ import annotations

import pytest

from tests.db_isolation import (
    DatabaseIsolationError,
    assert_safe_to_destroy,
    is_same_database,
    looks_like_test_database,
    resolve_test_database_url,
)

DEV_URL = "postgresql+asyncpg://dental:pw@db:5432/dental_clinic"
TEST_URL = "postgresql+asyncpg://dental:pw@db:5432/dental_clinic_test"


# ---------------------------------------------------------------------------
# A — TEST_DATABASE_URL == DATABASE_URL must abort
# ---------------------------------------------------------------------------


def test_aborts_when_test_url_is_the_development_database():
    with pytest.raises(DatabaseIsolationError, match="same database"):
        resolve_test_database_url(DEV_URL, {"TEST_DATABASE_URL": DEV_URL})


def test_aborts_when_test_url_is_the_dev_database_under_another_driver():
    """Same physical DB, different driver/credentials — still the same DB."""
    disguised = "postgresql://someone_else:other@db:5432/dental_clinic"
    with pytest.raises(DatabaseIsolationError, match="same database"):
        resolve_test_database_url(DEV_URL, {"TEST_DATABASE_URL": disguised})


# ---------------------------------------------------------------------------
# B — a missing TEST_DATABASE_URL must not fall back to development
# ---------------------------------------------------------------------------


def test_aborts_when_unset_and_dev_database_is_not_a_test_database():
    with pytest.raises(DatabaseIsolationError, match="not set"):
        resolve_test_database_url(DEV_URL, {})


def test_aborts_when_set_to_blank():
    with pytest.raises(DatabaseIsolationError, match="not set"):
        resolve_test_database_url(DEV_URL, {"TEST_DATABASE_URL": "   "})


def test_never_returns_the_development_url():
    """The whole point: no input may yield the dev database back."""
    for env in ({}, {"TEST_DATABASE_URL": ""}, {"TEST_DATABASE_URL": DEV_URL}):
        with pytest.raises(DatabaseIsolationError):
            resolve_test_database_url(DEV_URL, env)


# ---------------------------------------------------------------------------
# C — a valid test URL is accepted
# ---------------------------------------------------------------------------


def test_uses_the_configured_test_database():
    assert resolve_test_database_url(DEV_URL, {"TEST_DATABASE_URL": TEST_URL}) == TEST_URL


def test_allows_ci_style_ephemeral_database_without_the_variable():
    """CI has no TEST_DATABASE_URL: its whole Postgres service is disposable
    and its only database is already named ``*_test``."""
    ci_url = "postgresql+asyncpg://dental:testpass@localhost:5432/dental_clinic_test"
    assert resolve_test_database_url(ci_url, {}) == ci_url


# ---------------------------------------------------------------------------
# Defensive last-line check used right before create_all / drop_all
# ---------------------------------------------------------------------------


def test_assert_safe_to_destroy_accepts_a_test_database():
    assert_safe_to_destroy(TEST_URL, DEV_URL)


def test_assert_safe_to_destroy_rejects_the_development_database():
    with pytest.raises(DatabaseIsolationError, match="development database"):
        assert_safe_to_destroy(DEV_URL, DEV_URL)


def test_assert_safe_to_destroy_rejects_a_non_test_name_even_without_dev_url():
    with pytest.raises(DatabaseIsolationError, match="not named as a test database"):
        assert_safe_to_destroy("postgresql+asyncpg://u:p@db:5432/production", None)


# ---------------------------------------------------------------------------
# Identity helpers
# ---------------------------------------------------------------------------


def test_is_same_database_ignores_driver_and_credentials():
    assert is_same_database(DEV_URL, "postgresql://other:pw@db:5432/dental_clinic")
    assert not is_same_database(DEV_URL, TEST_URL)


def test_is_same_database_distinguishes_host_and_port():
    assert not is_same_database(DEV_URL, "postgresql+asyncpg://dental:pw@other:5432/dental_clinic")
    assert not is_same_database(DEV_URL, "postgresql+asyncpg://dental:pw@db:5433/dental_clinic")


def test_looks_like_test_database():
    assert looks_like_test_database(TEST_URL)
    assert not looks_like_test_database(DEV_URL)
