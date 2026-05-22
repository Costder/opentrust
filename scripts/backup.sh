#!/usr/bin/env bash
# ── OpenTrust PostgreSQL Backup Script ──────────────────────────────────────
# Usage:
#   ./scripts/backup.sh                          # uses .env / defaults
#   DB_URL=postgresql://user:pass@host:5432/db ./scripts/backup.sh
#
# Creates timestamped dumps in ./backups/ and prunes backups older than 30 days.
# Supports both plain SQL (smaller, portable) and custom format (compressed).
# ────────────────────────────────────────────────────────────────────────────

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PROJECT_DIR="$(dirname "$SCRIPT_DIR")"
BACKUP_DIR="${PROJECT_DIR}/backups"
RETENTION_DAYS="${BACKUP_RETENTION_DAYS:-30}"
TIMESTAMP="$(date +%Y%m%d_%H%M%S)"
BACKUP_FILE="${BACKUP_DIR}/opentrust_${TIMESTAMP}.sql.gz"

# Try to load DB_URL from .env if not already set
if [ -z "${DB_URL:-}" ] && [ -f "${PROJECT_DIR}/.env" ]; then
    export "$(grep -E '^DB_URL=' "${PROJECT_DIR}/.env" | head -1)"
fi

# Parse DB_URL: postgresql+asyncpg://user:pass@host:port/db
RAW_DB_URL="${DB_URL:-postgresql+asyncpg://opentrust:opentrust_dev@localhost:5432/opentrust}"
# Strip the +asyncpg suffix for psql
PG_URL="${RAW_DB_URL/+asyncpg/}"

echo "[backup] Starting backup..."
echo "[backup] Target database from connection string"
mkdir -p "${BACKUP_DIR}"

# Run pg_dump with compression
pg_dump \
    --dbname="${PG_URL}" \
    --no-owner \
    --no-acl \
    --compress=9 \
    --file="${BACKUP_FILE}" \
    --verbose 2>&1 | tail -5

echo "[backup] Backup saved to: ${BACKUP_FILE}"

# Prune old backups
echo "[backup] Pruning backups older than ${RETENTION_DAYS} days..."
find "${BACKUP_DIR}" -name 'opentrust_*.sql.gz' -type f -mtime "+${RETENTION_DAYS}" -delete
echo "[backup] Done."

# Show summary
echo ""
echo "── Backup Summary ───────────────────────────────"
ls -lh "${BACKUP_FILE}"
echo "Available backups:"
ls -1t "${BACKUP_DIR}"/opentrust_*.sql.gz 2>/dev/null | head -5
echo "─────────────────────────────────────────────────"
