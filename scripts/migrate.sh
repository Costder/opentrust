#!/usr/bin/env sh
set -eu
for migration in passport-schema/migrations/*.sql; do
  psql "${DB_URL:-postgresql://postgres:postgres@localhost:5432/opentrust}" -f "$migration"
done
