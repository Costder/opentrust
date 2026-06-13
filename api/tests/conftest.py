"""Test fixtures for OpenTrust API tests."""

import pytest
from httpx import ASGITransport, AsyncClient

from api.src.config import settings
from api.src.main import app

# Party-auth (wallet session tokens) and admin-token flows need a real signing
# secret. Provide a stable one for the whole test run; individual tests that
# probe empty/weak-secret behavior save and restore it themselves.
_TEST_JWT_SECRET = "test-jwt-secret-0123456789abcdef0123456789abcdef"
settings.jwt_secret = _TEST_JWT_SECRET


@pytest.fixture(autouse=True)
def _ensure_jwt_secret():
    settings.jwt_secret = _TEST_JWT_SECRET
    yield


@pytest.fixture
def async_client():
    """Provide an async HTTP client against the FastAPI app (no server needed)."""
    transport = ASGITransport(app=app)
    return AsyncClient(transport=transport, base_url="http://opentrust.test")