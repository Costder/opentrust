.PHONY: install dev test lint migrate seed docker-up docker-down

install:
	python -m pip install -r api/requirements.txt
	python -m pip install -e cli
	python -m pip install -e payment-contracts
	cd web && npm install

dev:
	docker compose up --build

test:
	pytest api/tests payment-contracts/tests cli/tests
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
