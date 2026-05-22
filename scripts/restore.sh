#!/usr/bin/env bash
# ── OpenTrust PostgreSQL Restore Script ─────────────────────────────────────
# Usage:
#   ./scripts/restore.sh [backup_file]
#   ./scripts/restore.sh backups/opentrust_20250101_120000.sql.gz
#
# If no backup file is specified, the most recent backup in ./backups/ is used.
# WARNING: This drops the target database before restoring!
# ────────────────────────────────────────────────────────────────────────────

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PROJECT_DIR="$(dirname "$SCRIPT_DIR")"
BACKUP_DIR="${PROJECT_DIR}/backups"

# Resolve backup file
if [ $# -ge 1 ]; then
    RESTORE_FILE="$1"
else
    RESTORE_FILE="$(ls -1t "${BACKUP_DIR}"/opentrust_*.sql.gz 2>/dev/null | head -1)"
fi

if [ -z "${RESTORE_FILE:-}" ] || [ ! -f "${RESTORE_FILE}" ]; then
    echo "[restore] ERROR: No backup file found."
    echo "Usage: $0 [path/to/backup.sql.gz]"
    exit 1
fi

# Try to load DB_URL from .env if not already set
if [ -z "${DB_URL:-}" ] && [ -f "${PROJECT_DIR}/.env" ]; then
    export "$(grep -E '^DB_URL=' "${PROJECT_DIR}/.env" | head -1)"
fi

RAW_DB_URL="${DB_URL:-postgresql+asyncpg://opentrust:opentrust_dev@localhost:5432/opentrust}"
PG_URL="${RAW_DB_URL/+asyncpg/}"

echo "[restore] Backup file: ${RESTORE_FILE}"
echo "[restore] Target database derived from DB_URL"
echo "[restore] WARNING: This will DROP and recreate the target database!"
echo -n "[restore] Continue? [y/N] "

read -r confirm
if [ "${confirm}" != "y" ] && [ "${confirm}" != "Y" ]; then
    echo "[restore] Aborted."
    exit 0
fi

# Extract database name from URL for DROP/CREATE
DB_NAME="$(echo "${PG_URL}" | sed -n 's|.*/\([^?]*\)|\1|p' | sed 's/ .*//')"
PG_CONN_URL="$(echo "${PG_URL}" | sed "s|/[^/]*$|/postgres|")"

echo "[restore] Dropping and recreating database '${DB_NAME}'..."
psql "${PG_CONN_URL}" -c "SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname='${DB_NAME}' AND pid <> pg_backend_pid();" 2>/dev/null || true
psql "${PG_CONN_URL}" -c "DROP DATABASE IF EXISTS \"${DB_NAME}\";"
psql "${PG_CONN_URL}" -c "CREATE DATABASE \"${DB_NAME}\";"
echo "[restore] Database recreated."

echo "[restore] Restoring from ${RESTORE_FILE}..."
gunzip -c "${RESTORE_FILE}" | psql "${PG_URL}" 2>&1 | tail -5
echo "[restore] Restore complete."

# Verify
echo "[restore] Verification: running a quick count query..."
psql "${PG_URL}" -c "SELECT COUNT(*) AS total_tables FROM information_schema.tables WHERE table_schema='public';" 2>/dev/null || echo "[restore] (verification skipped — non-critical)"
echo "[restore] Done."
