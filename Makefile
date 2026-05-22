.PHONY: install dev test lint migrate seed docker-up docker-down \
        docker-prod-up docker-prod-down prod-check backup restore

install:
	python -m pip install -r api/requirements.txt
	python -m pip install -e cli
	python -m pip install -e payment-contracts
	cd web && npm install

dev:
	docker compose up --build

test:
	python -m pytest api/tests payment-contracts/tests cli/tests
	cd web && npm test

lint:
	python -m compileall api/src cli/src payment-contracts
	cd web && npm run lint

migrate:
	sh scripts/migrate.sh

seed:
	sh scripts/seed-tools.sh

docker-up:
	docker compose up --build

docker-down:
	docker compose down

# ── Production targets ────────────────────────────────────────────────────

docker-prod-up:
	docker compose -f docker-compose.yml -f docker-compose.prod.yml up --build -d

docker-prod-down:
	docker compose -f docker-compose.yml -f docker-compose.prod.yml down

# Validate production config without starting the server
prod-check:
	python -c "
import os
os.environ['ENVIRONMENT'] = 'production'
os.environ['DB_URL'] = os.environ.get('DB_URL', 'postgresql+asyncpg://opentrust:test@localhost:5432/test')
os.environ['JWT_SECRET'] = os.environ.get('JWT_SECRET', '')
from api.src.config import run_config_validation
run_config_validation()
"

# Backup/restore (requires pg_dump/psql on PATH or in Docker)
backup:
	sh scripts/backup.sh

restore:
	sh scripts/restore.sh

# Docker-based backup (runs pg_dump inside the db container)
docker-backup:
	docker compose exec -T db pg_dump -U opentrust -d opentrust --compress=9 > backups/opentrust_$$(date +%Y%m%d_%H%M%S).sql.gz
