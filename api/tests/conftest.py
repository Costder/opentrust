"""Test fixtures for OpenTrust API tests."""

import pytest
from httpx import ASGITransport, AsyncClient

from api.src.main import app


@pytest.fixture
def async_client():
    """Provide an async HTTP client against the FastAPI app (no server needed)."""
    transport = ASGITransport(app=app)
    return AsyncClient(transport=transport, base_url="http://opentrust.test")