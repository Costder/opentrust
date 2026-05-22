#!/usr/bin/env bash
# Restore a SQLite backup into a temp DB and verify it opens.
# Safe by default: does NOT overwrite the live DB unless RESTORE_IN_PLACE=1.
set -euo pipefail

PROJECT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
BACKUP_DIR="${PROJECT_DIR}/backups"
LIVE_DB="${OPENTRUST_SQLITE_DB:-/home/joshua/.local/state/opentrust/opentrust.db}"
BACKUP_FILE="${1:-$(ls -1t "${BACKUP_DIR}"/opentrust_sqlite_*.db.gz 2>/dev/null | head -1)}"

if [ -z "${BACKUP_FILE}" ] || [ ! -f "${BACKUP_FILE}" ]; then
  echo "[restore-sqlite] ERROR: backup file not found" >&2
  exit 1
fi

if [ -f "${BACKUP_FILE}.sha256" ]; then
  sha256sum -c "${BACKUP_FILE}.sha256"
fi

if [ "${RESTORE_IN_PLACE:-0}" = "1" ]; then
  TARGET="${LIVE_DB}"
  cp "${LIVE_DB}" "${LIVE_DB}.pre_restore_$(date +%Y%m%d_%H%M%S).bak" 2>/dev/null || true
else
  TARGET="$(mktemp /tmp/opentrust_restore_drill_XXXXXX.db)"
fi

gunzip -c "${BACKUP_FILE}" > "${TARGET}"

python - <<PY
import sqlite3
path = '${TARGET}'
with sqlite3.connect(path) as conn:
    tables = conn.execute("select count(*) from sqlite_master where type='table'").fetchone()[0]
print(f"[restore-sqlite] verified database opens; tables={tables}; target={path}")
PY
