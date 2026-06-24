.PHONY: install dev test lint

install:
	python -m pip install -e cli
	python -m pip install -e "sdk[mcp]"
	cd sdk-ts && npm install
	cd packages/opentrust-gateway && npm install

test:
	python -m pytest cli/tests sdk/tests
	cd sdk-ts && npm test
	cd packages/opentrust-gateway && npm test

lint:
	python -m compileall cli/src sdk/src
	cd sdk-ts && npm run typecheck
	cd packages/opentrust-gateway && npm run typecheck
