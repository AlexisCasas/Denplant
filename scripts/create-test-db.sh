#!/bin/bash
# Create the dedicated pytest database (INFRA-01).
# Usage: ./scripts/create-test-db.sh [db_name]
#
# The test suite creates and drops the whole schema on every test, so it must
# never run against the development database. This provisions a separate,
# disposable one (default: dental_clinic_test) next to it in the same local
# Postgres container.
#
# Idempotent: re-running it on an existing database is a no-op. It never
# touches the development database.

set -e

TEST_DB="${1:-dental_clinic_test}"
DB_USER="${POSTGRES_USER:-dental}"
DEV_DB="${POSTGRES_DB:-dental_clinic}"

if [ "$TEST_DB" = "$DEV_DB" ]; then
  echo "Refusing to use '$TEST_DB': that is the development database." >&2
  exit 1
fi

echo "Ensuring test database '$TEST_DB' exists..."

# `CREATE DATABASE` cannot run inside a transaction or with IF NOT EXISTS,
# so check first and create only when missing.
EXISTS=$(docker compose exec -T db psql -U "$DB_USER" -d postgres -tA \
  -c "SELECT 1 FROM pg_database WHERE datname = '$TEST_DB';" | tr -d '[:space:]')

if [ "$EXISTS" = "1" ]; then
  echo "  already exists — nothing to do."
else
  docker compose exec -T db psql -U "$DB_USER" -d postgres \
    -c "CREATE DATABASE $TEST_DB OWNER $DB_USER;"
  echo "  created."
fi

echo ""
echo "Test database ready. Point pytest at it with:"
echo ""
echo "  TEST_DATABASE_URL=postgresql+asyncpg://$DB_USER:<password>@db:5432/$TEST_DB"
echo ""
echo "Add it to .env (see .env.example). Schema is created and dropped by the"
echo "test fixtures themselves — no migrations needed here."
