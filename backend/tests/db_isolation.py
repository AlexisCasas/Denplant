"""Guard that keeps pytest away from the development database (INFRA-01).

The suite creates and drops the whole schema per test
(``Base.metadata.create_all`` / ``drop_all``). Pointing that at the
development database wipes it — and because ``alembic_version`` is not part
of the metadata it survives, leaving Alembic convinced everything is applied
against a schema that no longer exists. That happened and was reproduced.

Contract
--------
``TEST_DATABASE_URL`` designates the database pytest may destroy:

* set, and pointing at a *different* physical database than ``DATABASE_URL``
  → used;
* set, but resolving to the same host/port/database as ``DATABASE_URL``
  → abort (that is exactly the footgun this module exists to prevent);
* unset → abort, **unless** ``DATABASE_URL``'s database name already ends
  with ``_test``. That escape hatch is what CI uses: its Postgres service is
  an ephemeral throwaway container whose only database is
  ``dental_clinic_test``, so the name *is* the designation there.

There is deliberately no silent fallback to ``DATABASE_URL``.

Identity is compared on the normalised ``(host, port, database)`` triple
rather than on raw strings, so two URLs that differ only in driver or
credentials (``postgresql://`` vs ``postgresql+asyncpg://``, different user)
are still recognised as the same physical database.
"""

from __future__ import annotations

from collections.abc import Mapping

from sqlalchemy.engine import make_url

TEST_DB_ENV_VAR = "TEST_DATABASE_URL"

#: Suffix that marks a database name as disposable when no explicit
#: ``TEST_DATABASE_URL`` is provided (CI's ephemeral service database).
TEST_DB_NAME_SUFFIX = "_test"


class DatabaseIsolationError(RuntimeError):
    """Raised instead of running destructive fixtures against the wrong DB."""


def database_identity(url: str) -> tuple[str | None, int | None, str | None]:
    """``(host, port, database)`` — what actually decides "same database"."""
    parsed = make_url(url)
    host = parsed.host.lower() if parsed.host else None
    database = parsed.database.lower() if parsed.database else None
    return (host, parsed.port, database)


def is_same_database(a: str, b: str) -> bool:
    """True when both URLs point at the same physical database."""
    return database_identity(a) == database_identity(b)


def looks_like_test_database(url: str) -> bool:
    """True when the database name itself designates a disposable DB."""
    database = database_identity(url)[2]
    return bool(database and database.endswith(TEST_DB_NAME_SUFFIX))


def resolve_test_database_url(dev_url: str, env: Mapping[str, str]) -> str:
    """Return the URL pytest may create/drop schema in, or raise.

    ``dev_url`` is the configured ``DATABASE_URL`` (the developer's working
    database); ``env`` is the process environment.
    """
    configured = (env.get(TEST_DB_ENV_VAR) or "").strip()

    if configured:
        if is_same_database(configured, dev_url):
            raise DatabaseIsolationError(
                f"{TEST_DB_ENV_VAR} points at the same database as DATABASE_URL "
                f"({database_identity(dev_url)[2]!r}). The test suite drops every "
                "table it creates, so this would destroy the development schema. "
                f"Point {TEST_DB_ENV_VAR} at a dedicated database — see "
                "scripts/create-test-db.sh."
            )
        return configured

    if looks_like_test_database(dev_url):
        # CI path: the whole Postgres service is a throwaway whose only
        # database is already the test one.
        return dev_url

    raise DatabaseIsolationError(
        f"{TEST_DB_ENV_VAR} is not set and DATABASE_URL points at "
        f"{database_identity(dev_url)[2]!r}, which is not a test database. "
        "Refusing to run the suite: it would drop every table in it. "
        "Create the test database once with scripts/create-test-db.sh and set "
        f"{TEST_DB_ENV_VAR} (see .env.example)."
    )


#: Populated by :func:`redirect_to_test_database` at conftest import time.
DEV_DATABASE_URL: str = ""
TEST_DATABASE_URL: str = ""


def redirect_to_test_database(settings: object) -> str:
    """Point ``settings`` at the test database and return that URL.

    Called from ``conftest`` *before* ``app.database`` is imported: that module
    builds the shared engine from ``settings.DATABASE_URL`` at import time and
    event handlers write through it, so redirecting only the fixtures would
    leave those writes hitting the development database.

    Raises :class:`DatabaseIsolationError` rather than falling back.
    """
    global DEV_DATABASE_URL, TEST_DATABASE_URL

    import os

    DEV_DATABASE_URL = settings.DATABASE_URL  # type: ignore[attr-defined]
    TEST_DATABASE_URL = resolve_test_database_url(DEV_DATABASE_URL, os.environ)
    settings.DATABASE_URL = TEST_DATABASE_URL  # type: ignore[attr-defined]
    return TEST_DATABASE_URL


def assert_safe_to_destroy(url: str, dev_url: str | None) -> None:
    """Last-line check, called right before ``create_all`` / ``drop_all``.

    Cheap, and it catches a fixture that was handed a URL by some path other
    than :func:`resolve_test_database_url`.
    """
    if dev_url and is_same_database(url, dev_url):
        raise DatabaseIsolationError(
            "Refusing to create/drop schema: the engine points at the "
            f"development database ({database_identity(url)[2]!r})."
        )
    if not looks_like_test_database(url):
        raise DatabaseIsolationError(
            "Refusing to create/drop schema: "
            f"{database_identity(url)[2]!r} is not named as a test database "
            f"(expected a name ending in {TEST_DB_NAME_SUFFIX!r})."
        )
