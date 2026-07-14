import copy
import json
from pathlib import Path

import pytest
import pytest_asyncio
from httpx import ASGITransport, AsyncClient
from sqlalchemy import select
from sqlalchemy.exc import SQLAlchemyError
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker, create_async_engine

from api.src.database import get_session
from api.src.main import app
from api.src.models.passport import Base
from api.src.routes import passports
from api.src.services.passport_generator import draft_passport_from_metadata
from manifest_validator import validate_passport


EXAMPLE = Path(__file__).resolve().parents[2] / "passport-schema" / "examples" / "example-passport.json"


@pytest_asyncio.fixture
async def client(tmp_path):
    engine = create_async_engine(f"sqlite+aiosqlite:///{tmp_path / 'passports.db'}")
    session_factory = async_sessionmaker(engine, expire_on_commit=False)

    async with engine.begin() as connection:
        await connection.run_sync(Base.metadata.create_all)

    async def override_get_session():
        async with session_factory() as session:
            yield session

    app.dependency_overrides[passports.get_session] = override_get_session
    try:
        async with AsyncClient(
            transport=ASGITransport(app=app),
            base_url="http://testserver",
        ) as api_client:
            api_client.session_factory = session_factory
            yield api_client
    finally:
        app.dependency_overrides.pop(passports.get_session, None)
        async with engine.begin() as connection:
            await connection.run_sync(Base.metadata.drop_all)
        await engine.dispose()


def passport_payload() -> dict:
    payload = json.loads(EXAMPLE.read_text(encoding="utf-8"))
    payload.update(
        {
            "description": "Registry-specific description retained outside the protocol document.",
            "billing_plan": {"tier": "pro", "interval": "monthly", "amount_usdc": 19},
            "fee_schedule": {"kind": "platform", "percent": 5},
        }
    )
    return payload


def assert_round_trip(response: dict, expected: dict) -> None:
    for key, value in expected.items():
        assert response[key] == value, key


@pytest.mark.asyncio
async def test_post_put_and_get_round_trip_every_protocol_and_api_metadata_field(client):
    created_payload = passport_payload()
    created = await client.post("/api/v1/tools", json=created_payload)

    assert created.status_code == 201, created.json()
    assert_round_trip(created.json(), created_payload)

    updated_payload = copy.deepcopy(created_payload)
    updated_payload["tool_identity"]["name"] = "Updated Example Tool"
    updated_payload["tool_identity"]["slug"] = "updated-example-tool"
    updated_payload["dependencies"] = [{"slug": "requests", "min_version": "2.32.0"}]
    updated_payload["sunset"] = {
        "deprecated_at": "2027-01-01T00:00:00Z",
        "successor_slug": "replacement-tool",
    }
    updated_payload["description"] = "Updated registry metadata."
    updated_payload["billing_plan"] = {"tier": "enterprise", "interval": "annual", "amount_usdc": 999}

    original_slug = created_payload["tool_identity"]["slug"]
    updated = await client.put(f"/api/v1/tools/{original_slug}", json=updated_payload)
    assert updated.status_code == 200, updated.json()
    assert_round_trip(updated.json(), updated_payload)

    fetched = await client.get("/api/v1/tools/updated-example-tool")
    assert fetched.status_code == 200, fetched.json()
    assert_round_trip(fetched.json(), updated_payload)


@pytest.mark.asyncio
async def test_read_uses_protocol_document_when_protocol_projection_is_stale(client):
    payload = passport_payload()
    created = await client.post("/api/v1/tools", json=payload)
    assert created.status_code == 201, created.json()

    async with client.session_factory() as session:
        row = (
            await session.execute(
                select(passports.Passport).where(passports.Passport.slug == payload["tool_identity"]["slug"])
            )
        ).scalar_one()
        row.trust_status = "disputed"
        row.capabilities = ["stale-projection"]
        await session.commit()

    response = await client.get(f"/api/v1/tools/{payload['tool_identity']['slug']}")
    assert response.status_code == 200, response.json()
    assert response.json()["trust_status"] == payload["trust_status"]
    assert response.json()["capabilities"] == payload["capabilities"]


@pytest.mark.asyncio
async def test_commit_failure_after_flush_rolls_back_canonical_document_and_projections(client, monkeypatch):
    original_payload = passport_payload()
    created = await client.post("/api/v1/tools", json=original_payload)
    assert created.status_code == 201, created.json()

    updated_payload = copy.deepcopy(original_payload)
    updated_payload["trust_status"] = "disputed"
    updated_payload["capabilities"] = ["partially-persisted-capability"]
    updated_payload["tool_identity"]["name"] = "Partially Persisted Name"

    async def fail_after_flush(session):
        await session.flush()
        raise SQLAlchemyError("forced persistence failure")

    monkeypatch.setattr(AsyncSession, "commit", fail_after_flush)

    async with AsyncClient(
        transport=ASGITransport(app=app, raise_app_exceptions=False),
        base_url="http://testserver",
    ) as failing_client:
        response = await failing_client.put(
            f"/api/v1/tools/{original_payload['tool_identity']['slug']}",
            json=updated_payload,
        )

    assert response.status_code == 500
    async with client.session_factory() as session:
        row = (
            await session.execute(
                select(passports.Passport).where(
                    passports.Passport.slug == original_payload["tool_identity"]["slug"]
                )
            )
        ).scalar_one()

    expected_document = copy.deepcopy(original_payload)
    for metadata_field in ("description", "billing_plan", "fee_schedule"):
        expected_document.pop(metadata_field)
    assert row.protocol_document == expected_document
    assert row.trust_status == original_payload["trust_status"]
    assert row.capabilities == original_payload["capabilities"]
    assert row.tool_identity == original_payload["tool_identity"]


@pytest.mark.asyncio
async def test_protocol_and_transport_validation_errors_have_distinct_stable_shapes(client):
    protocol_invalid = passport_payload()
    protocol_invalid["trust_status"] = "seller_confirmed"

    protocol_response = await client.post("/api/v1/tools", json=protocol_invalid)
    assert protocol_response.status_code == 422
    protocol_detail = protocol_response.json()["detail"]
    assert protocol_detail["type"] == "protocol_validation"
    assert any(
        error["code"] == "schema.enum" and error["path"] == "/trust_status"
        for error in protocol_detail["validation"]["errors"]
    )

    transport_invalid = passport_payload()
    transport_invalid["description"] = 42
    transport_response = await client.post("/api/v1/tools", json=transport_invalid)
    assert transport_response.status_code == 422
    assert transport_response.json()["detail"] == {
        "type": "transport_validation",
        "errors": [
            {
                "code": "transport.invalid_description",
                "path": "/description",
                "message": "description must be a string",
            }
        ],
    }


def test_api_draft_generator_produces_a_protocol_valid_passport():
    draft = draft_passport_from_metadata("Example Tool", "https://github.com/example/example")

    assert validate_passport(draft).valid, validate_passport(draft).to_dict()
