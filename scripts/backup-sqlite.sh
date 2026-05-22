#!/usr/bin/env bash
# SQLite backup for the no-domain OpenTrust public preview.
set -euo pipefail

PROJECT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
BACKUP_DIR="${PROJECT_DIR}/backups"
STATE_DIR="/home/joshua/.local/state/opentrust"
DB_PATH="${OPENTRUST_SQLITE_DB:-${STATE_DIR}/opentrust.db}"
TIMESTAMP="$(date +%Y%m%d_%H%M%S)"
BACKUP_FILE="${BACKUP_DIR}/opentrust_sqlite_${TIMESTAMP}.db"
REGISTRY_STATE="${STATE_DIR}/registry-state.json"

mkdir -p "${BACKUP_DIR}"

if [ ! -f "${DB_PATH}" ]; then
  echo "[backup-sqlite] ERROR: SQLite database not found: ${DB_PATH}" >&2
  exit 1
fi

python - <<PY
import sqlite3
from pathlib import Path
src = Path('${DB_PATH}')
dst = Path('${BACKUP_FILE}')
with sqlite3.connect(src) as source:
    with sqlite3.connect(dst) as backup:
        source.backup(backup)
PY

if [ -f "${REGISTRY_STATE}" ]; then
  cp "${REGISTRY_STATE}" "${BACKUP_FILE}.registry-state.json"
fi

gzip -f "${BACKUP_FILE}"
sha256sum "${BACKUP_FILE}.gz" > "${BACKUP_FILE}.gz.sha256"

echo "[backup-sqlite] Backup saved: ${BACKUP_FILE}.gz"
if [ -f "${BACKUP_FILE}.registry-state.json" ]; then
  echo "[backup-sqlite] Registry state saved: ${BACKUP_FILE}.registry-state.json"
fi
