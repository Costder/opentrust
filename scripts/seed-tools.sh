#!/usr/bin/env sh
set -eu
psql "${DB_URL:-postgresql://postgres:postgres@localhost:5432/opentrust}" -f passport-schema/migrations/002_seed_tools.sql
