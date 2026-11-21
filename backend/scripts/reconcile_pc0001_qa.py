#!/usr/bin/env python3
"""Safely reconcile the historical ``pc_0001`` Alembic ledger entry in QA.

This is deliberately a one-purpose, clone-only utility.  It never invokes
Alembic migration operations or executes DDL.  Instead it evaluates the
``pc_0001`` migration against an in-memory SQLAlchemy ``MetaData`` object,
reflects the target database, and requires an exact match before inserting the
missing revision row.  The transaction preserves every existing Alembic head.

The database name must start with ``denplant_clinical_qa_``.  This guard makes
the tool refuse production and any unlabelled database by default.
"""

from __future__ import annotations

import argparse
import asyncio
import importlib.util
import json
from pathlib import Path
from typing import Any

import sqlalchemy as sa
from sqlalchemy.dialects import postgresql
from sqlalchemy.ext.asyncio import create_async_engine

REVISION = "pc_0001"
QA_DATABASE_PREFIX = "denplant_clinical_qa_"
ROOT = Path(__file__).resolve().parents[1]
MIGRATION = ROOT / "app/modules/patients_clinical/migrations/versions/pc_0001_initial.py"


class SchemaMismatchError(RuntimeError):
    """The physical schema is not exactly the schema declared by pc_0001."""


class CaptureOperations:
    """Minimal Alembic ``op`` replacement that records the migration metadata."""

    def __init__(self) -> None:
        self.metadata = sa.MetaData()

    @staticmethod
    def f(name: str) -> str:
        return name

    def create_table(self, name: str, *items: Any, **_: Any) -> sa.Table:
        return sa.Table(name, self.metadata, *items)

    def create_index(
        self,
        name: str,
        table_name: str,
        columns: list[str],
        *,
        unique: bool = False,
        **_: Any,
    ) -> sa.Index:
        table = self.metadata.tables[table_name]
        return sa.Index(name, *(table.c[column] for column in columns), unique=unique)


def expected_metadata() -> sa.MetaData:
    """Build the exact pc_0001 schema from its source without a DB connection."""
    spec = importlib.util.spec_from_file_location("pc_0001_schema", MIGRATION)
    if spec is None or spec.loader is None:
        raise RuntimeError(f"Cannot load migration: {MIGRATION}")
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    if module.revision != REVISION:
        raise RuntimeError(f"Unexpected migration revision: {module.revision!r}")
    ops = CaptureOperations()
    module.op = ops
    module.upgrade()
    return ops.metadata


def _type_name(column: sa.Column[Any]) -> str:
    return column.type.compile(dialect=postgresql.dialect()).lower()


def _types_match(declared: sa.Column[Any], physical: Any) -> bool:
    """Compare PostgreSQL types while retaining relevant declared detail."""
    declared_type = declared.type
    if isinstance(declared_type, sa.String):
        return isinstance(physical, sa.String) and declared_type.length == physical.length
    if isinstance(declared_type, sa.DateTime):
        return isinstance(physical, sa.DateTime) and declared_type.timezone == physical.timezone
    # PostgreSQL reflects SQLAlchemy's generic Float() as DOUBLE PRECISION.
    if isinstance(declared_type, sa.Float):
        return isinstance(physical, sa.Float)
    return _type_name(declared) == physical.compile(dialect=postgresql.dialect()).lower()


def _default(value: Any) -> str | None:
    if value is None:
        return None
    text = getattr(value, "arg", value)
    return str(text)


def _expected_fks(table: sa.Table) -> set[tuple[tuple[str, ...], str, tuple[str, ...], str | None]]:
    result = set()
    for constraint in table.foreign_key_constraints:
        elements = list(constraint.elements)
        target_table = elements[0].target_fullname.rsplit(".", 1)[0]
        result.add(
            (
                tuple(element.parent.name for element in elements),
                target_table,
                tuple(element.target_fullname.rsplit(".", 1)[1] for element in elements),
                next((element.ondelete for element in elements if element.ondelete), None),
            )
        )
    return result


def _actual_fks(
    inspector: sa.Inspector, table: str
) -> set[tuple[tuple[str, ...], str, tuple[str, ...], str | None]]:
    return {
        (
            tuple(fk["constrained_columns"]),
            fk["referred_table"],
            tuple(fk["referred_columns"]),
            (fk.get("options") or {}).get("ondelete"),
        )
        for fk in inspector.get_foreign_keys(table)
    }


def _expected_indexes(table: sa.Table) -> set[tuple[str, tuple[str, ...], bool]]:
    return {
        (index.name, tuple(column.name for column in index.columns), index.unique)
        for index in table.indexes
    }


def _actual_indexes(inspector: sa.Inspector, table: str) -> set[tuple[str, tuple[str, ...], bool]]:
    return {
        (index["name"], tuple(index["column_names"]), bool(index["unique"]))
        for index in inspector.get_indexes(table)
    }


def _expected_uniques(table: sa.Table) -> set[tuple[str | None, tuple[str, ...]]]:
    return {
        (constraint.name, tuple(column.name for column in constraint.columns))
        for constraint in table.constraints
        if isinstance(constraint, sa.UniqueConstraint)
    }


def _actual_uniques(inspector: sa.Inspector, table: str) -> set[tuple[str | None, tuple[str, ...]]]:
    return {
        (constraint["name"], tuple(constraint["column_names"]))
        for constraint in inspector.get_unique_constraints(table)
    }


def compare_schema(connection: sa.Connection, expected: sa.MetaData) -> list[str]:
    """Return every difference between pc_0001 and the physical schema."""
    inspector = sa.inspect(connection)
    expected_names = set(expected.tables)
    actual_names = {
        name for name in inspector.get_table_names() if name.startswith("patients_clinical_")
    }
    problems: list[str] = []
    for name in sorted(expected_names - actual_names):
        problems.append(f"missing table: {name}")
    for name in sorted(actual_names - expected_names):
        problems.append(f"unexpected clinical table: {name}")

    for name in sorted(expected_names & actual_names):
        table = expected.tables[name]
        columns = {column["name"]: column for column in inspector.get_columns(name)}
        expected_columns = {column.name: column for column in table.columns}
        for column_name in sorted(expected_columns.keys() - columns.keys()):
            problems.append(f"{name}: missing column {column_name}")
        for column_name in sorted(columns.keys() - expected_columns.keys()):
            problems.append(f"{name}: unexpected column {column_name}")
        for column_name in sorted(expected_columns.keys() & columns.keys()):
            declared = expected_columns[column_name]
            physical = columns[column_name]
            physical_type = physical["type"].compile(dialect=postgresql.dialect()).lower()
            if not _types_match(declared, physical["type"]):
                problems.append(
                    f"{name}.{column_name}: type {_type_name(declared)!r} != {physical_type!r}"
                )
            if declared.nullable != physical["nullable"]:
                problems.append(
                    f"{name}.{column_name}: nullable {declared.nullable} != {physical['nullable']}"
                )
            if _default(declared.server_default) != _default(physical.get("default")):
                problems.append(f"{name}.{column_name}: default differs")

        expected_pk = tuple(column.name for column in table.primary_key.columns)
        actual_pk = tuple(
            (inspector.get_pk_constraint(name) or {}).get("constrained_columns") or ()
        )
        if expected_pk != actual_pk:
            problems.append(f"{name}: primary key {expected_pk!r} != {actual_pk!r}")
        if _expected_fks(table) != _actual_fks(inspector, name):
            problems.append(f"{name}: foreign keys differ")
        if _expected_indexes(table) != _actual_indexes(inspector, name):
            problems.append(f"{name}: indexes differ")
        if _expected_uniques(table) != _actual_uniques(inspector, name):
            problems.append(f"{name}: unique constraints differ")
    return problems


async def run(database_url: str, verify_only: bool) -> dict[str, Any]:
    expected = expected_metadata()
    engine = create_async_engine(database_url)
    try:
        async with engine.begin() as async_connection:
            database_name = await async_connection.scalar(sa.text("SELECT current_database()"))
            if not database_name.startswith(QA_DATABASE_PREFIX):
                raise RuntimeError(
                    f"Refusing database {database_name!r}; expected prefix {QA_DATABASE_PREFIX!r}"
                )

            def validate(sync_connection: sa.Connection) -> list[str]:
                return compare_schema(sync_connection, expected)

            problems = await async_connection.run_sync(validate)
            if problems:
                raise SchemaMismatchError("\n".join(problems))
            exists = await async_connection.scalar(
                sa.text("SELECT to_regclass('alembic_version') IS NOT NULL")
            )
            if not exists:
                raise RuntimeError("alembic_version does not exist")
            before = list(
                (
                    await async_connection.scalars(
                        sa.text("SELECT version_num FROM alembic_version ORDER BY version_num")
                    )
                ).all()
            )
            if "pc_0002" in before:
                raise RuntimeError(
                    "pc_0002 is already recorded; this reconciler is only for pc_0001"
                )
            inserted = False
            if REVISION not in before and not verify_only:
                await async_connection.execute(
                    sa.text("INSERT INTO alembic_version (version_num) VALUES (:revision)"),
                    {"revision": REVISION},
                )
                inserted = True
            after = list(
                (
                    await async_connection.scalars(
                        sa.text("SELECT version_num FROM alembic_version ORDER BY version_num")
                    )
                ).all()
            )
            expected_after = sorted(set(before) | ({REVISION} if not verify_only else set()))
            if after != expected_after:
                raise RuntimeError(
                    "alembic_version verification failed; transaction will roll back"
                )
            return {
                "database": database_name,
                "validated_tables": len(expected.tables),
                "validated_columns": sum(len(table.columns) for table in expected.tables.values()),
                "inserted_pc_0001": inserted,
                "before": before,
                "after": after,
                "verify_only": verify_only,
            }
    finally:
        await engine.dispose()


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--database-url", required=True)
    parser.add_argument("--verify-only", action="store_true")
    args = parser.parse_args()
    print(
        json.dumps(asyncio.run(run(args.database_url, args.verify_only)), indent=2, sort_keys=True)
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
