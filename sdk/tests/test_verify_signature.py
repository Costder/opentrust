"""Ed25519 passport signature verification in the Python SDK.

Uses the registry's own signing helper (api.src.crypto) to produce a genuinely
signed passport, then checks the SDK verifies it, rejects tampering, and honors
require_signature for unsigned passports.
"""
import pytest
from unittest.mock import AsyncMock, patch

from api.src.crypto import generate_ed25519_keypair, public_key_to_b64, sign_document

from opentrust import verify
from opentrust._verify import verify_passport_signature

BASE_PASSPORT = {
    "id": "abc123",
    "slug": "signed-tool",
    "name": "Signed Tool · ünïcøde",  # non-ASCII exercises canonical JSON parity
    "trust_status": "community_reviewed",
    "permission_manifest": {"network": True},
}


def _sign(passport: dict) -> tuple[dict, str]:
    priv, pub = generate_ed25519_keypair()
    sig = sign_document(priv, passport, key_id="test-key")
    signed = {**passport, "signature": sig}
    return signed, public_key_to_b64(pub)


def test_verify_passport_signature_accepts_valid_and_rejects_tampered():
    signed, pub_b64 = _sign(BASE_PASSPORT)
    assert verify_passport_signature(signed, pub_b64) is True

    tampered = {**signed, "trust_status": "security_checked"}  # change content post-signing
    assert verify_passport_signature(tampered, pub_b64) is False


def test_verify_passport_signature_rejects_wrong_key():
    signed, _ = _sign(BASE_PASSPORT)
    _, other_pub = generate_ed25519_keypair()
    assert verify_passport_signature(signed, public_key_to_b64(other_pub)) is False


@pytest.mark.asyncio
async def test_verify_marks_signed_passport_verified():
    signed, pub_b64 = _sign(BASE_PASSPORT)
    with patch("opentrust._client._Client.get", new_callable=AsyncMock) as m, \
         patch("opentrust._fetch_registry_key", new_callable=AsyncMock) as k:
        m.return_value = signed
        k.return_value = pub_b64
        result = await verify("signed-tool")
    assert result.verified_signature is True
    assert result.trust_status == "community_reviewed"


@pytest.mark.asyncio
async def test_verify_raises_on_tampered_signed_passport():
    signed, pub_b64 = _sign(BASE_PASSPORT)
    tampered = {**signed, "trust_status": "continuously_monitored"}
    with patch("opentrust._client._Client.get", new_callable=AsyncMock) as m, \
         patch("opentrust._fetch_registry_key", new_callable=AsyncMock) as k:
        m.return_value = tampered
        k.return_value = pub_b64
        with pytest.raises(ValueError, match="signature verification failed"):
            await verify("signed-tool")


@pytest.mark.asyncio
async def test_unsigned_passport_passes_but_marks_none():
    with patch("opentrust._client._Client.get", new_callable=AsyncMock) as m:
        m.return_value = {**BASE_PASSPORT}  # no signature block
        result = await verify("signed-tool")
    assert result.verified_signature is None


@pytest.mark.asyncio
async def test_require_signature_rejects_unsigned():
    with patch("opentrust._client._Client.get", new_callable=AsyncMock) as m:
        m.return_value = {**BASE_PASSPORT}
        with pytest.raises(ValueError, match="unsigned"):
            await verify("signed-tool", require_signature=True)
