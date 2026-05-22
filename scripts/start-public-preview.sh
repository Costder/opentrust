#!/usr/bin/env bash
# Start OpenTrust locally for a no-domain public HTTPS preview.
# Expose the web server with: cloudflared tunnel --url http://localhost:3001
set -euo pipefail

PROJECT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
ENV_FILE="${PROJECT_DIR}/.env.production.local"

if [ ! -f "${ENV_FILE}" ]; then
  echo "Missing ${ENV_FILE}" >&2
  exit 1
fi

set -a
# shellcheck disable=SC1090
source "${ENV_FILE}"
set +a

mkdir -p /home/joshua/.local/state/opentrust
chmod 700 /home/joshua/.local/state/opentrust

cd "${PROJECT_DIR}"
. .venv/bin/activate

python - <<'PY'
import asyncio
from api.src.database import engine
from api.src.models.passport import Base
import api.src.models.user  # noqa: F401
import api.src.models.review  # noqa: F401
import api.src.models.subscription  # noqa: F401

async def main():
    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)

asyncio.run(main())
print("[opentrust] database tables ready")
PY

exec uvicorn api.src.main:app --host 127.0.0.1 --port 8000
