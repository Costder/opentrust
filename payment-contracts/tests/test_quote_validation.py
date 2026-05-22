"""Tests for signed payment quote validation and nonce replay protection.

Strict TDD: Write failing tests first, then implement minimal code.
"""
from __future__ import annotations

import time
from datetime import datetime, timedelta, timezone
from decimal import Decimal

import pytest
from cryptography.hazmat.primitives.asymmetric.ed25519 import Ed25519PrivateKey

from payment_contracts.models import PaymentQuote


# ---------------------------------------------------------------------------
# Fixtures
# ---------------------------------------------------------------------------

@pytest.fixture
def signer_keys():
    """Generate a fresh Ed25519 key pair for each test."""
    private_key = Ed25519PrivateKey.generate()
    public_key = private_key.public_key()
    return private_key, public_key


@pytest.fixture
def valid_quote_dict(signer_keys):
    """Return a valid unsigned quote dict (no signature yet)."""
    _, public_key = signer_keys
    return {
        "quote_id": "qt_abc123",
        "passport_slug": "github-search-mcp",
        "version_hash": "v1.0.0",
        "amount": Decimal("19.00"),
        "currency": "USDC",
        "chain": "base",
        "recipient_wallet": "0x1234567890abcdef1234567890abcdef12345678",
        "expires_at": datetime.now(timezone.utc) + timedelta(hours=1),
        "nonce": "nonce-001",
        "terms_hash": "sha256:abc123def456",
        "signature": "",
    }


@pytest.fixture
def signed_quote(valid_quote_dict, signer_keys):
    """Create a fully signed PaymentQuote."""
    private_key, public_key = signer_keys
    quote = PaymentQuote(**valid_quote_dict)
    message = quote.signing_payload().encode("utf-8")
    sig = private_key.sign(message)
    quote.signature = sig.hex()
    return quote, public_key


# ---------------------------------------------------------------------------
# Model tests
# ---------------------------------------------------------------------------

class TestPaymentQuoteModel:
    """PaymentQuote Pydantic model construction."""

    def test_minimal_quote_construction(self, valid_quote_dict):
        """A quote with all required fields can be constructed."""
        quote = PaymentQuote(**valid_quote_dict)
        assert quote.quote_id == "qt_abc123"
        assert quote.passport_slug == "github-search-mcp"
        assert quote.amount == Decimal("19.00")
        assert quote.currency == "USDC"
        assert quote.chain == "base"

    def test_default_values(self):
        """Defaults: currency='USDC', chain='base'."""
        now = datetime.now(timezone.utc)
        quote = PaymentQuote(
            quote_id="qt_1",
            passport_slug="slug",
            version_hash="v1",
            amount=Decimal("10"),
            recipient_wallet="0xabc",
            expires_at=now,
            nonce="n1",
        )
        assert quote.currency == "USDC"
        assert quote.chain == "base"
        assert quote.terms_hash is None
        assert quote.signature == ""

    def test_amount_must_be_positive(self):
        """Amount must be >= 0."""
        now = datetime.now(timezone.utc)
        with pytest.raises(ValueError):
            PaymentQuote(
                quote_id="qt_1",
                passport_slug="slug",
                version_hash="v1",
                amount=Decimal("-1"),
                recipient_wallet="0xabc",
                expires_at=now,
                nonce="n1",
            )

    def test_expires_at_must_be_future(self, valid_quote_dict):
        """Model allows past expires_at — validation is separate."""
        past = datetime.now(timezone.utc) - timedelta(hours=1)
        quote = PaymentQuote(
            quote_id="qt_1",
            passport_slug="slug",
            version_hash="v1",
            amount=Decimal("10"),
            recipient_wallet="0xabc",
            expires_at=past,
            nonce="n1",
        )
        assert quote.expires_at < datetime.now(timezone.utc)

    def test_signing_payload_is_deterministic(self, valid_quote_dict):
        """Same data produces same signing payload."""
        q1 = PaymentQuote(**valid_quote_dict)
        q2 = PaymentQuote(**valid_quote_dict)
        assert q1.signing_payload() == q2.signing_payload()

    def test_signing_payload_excludes_signature(self, valid_quote_dict):
        """signing_payload must NOT include the signature field."""
        q1 = PaymentQuote(**valid_quote_dict)
        q1.signature = ""
        q2 = PaymentQuote(**valid_quote_dict)
        q2.signature = "DEADBEEF"
        assert q1.signing_payload() == q2.signing_payload()

    def test_signing_payload_format(self, valid_quote_dict):
        """signing_payload returns a canonical JSON string."""
        quote = PaymentQuote(**valid_quote_dict)
        payload = quote.signing_payload()
        assert isinstance(payload, str)
        assert len(payload) > 0
        # Should contain key fields
        assert "qt_abc123" in payload
        assert "github-search-mcp" in payload
        assert "nonce-001" in payload

    def test_sign_and_verify_roundtrip(self, valid_quote_dict, signer_keys):
        """Sign a quote and verify it using the signer's public key."""
        private_key, public_key = signer_keys
        quote = PaymentQuote(**valid_quote_dict)
        message = quote.signing_payload().encode("utf-8")
        sig = private_key.sign(message)
        quote.signature = sig.hex()
        public_key.verify(sig, message)
        assert quote.signature == sig.hex()


# ---------------------------------------------------------------------------
# Quote validation tests
# ---------------------------------------------------------------------------

class TestQuoteSignatureValidation:
    """Verify Ed25519 signature on PaymentQuote."""

    def test_valid_signature_passes(self, signed_quote):
        """A correctly signed quote passes signature validation."""
        quote, public_key = signed_quote
        from payment_contracts.models import validate_quote_signature
        result = validate_quote_signature(quote, public_key)
        assert result is True

    def test_invalid_signature_fails(self, signed_quote):
        """A quote with a tampered signature fails."""
        quote, public_key = signed_quote
        quote.signature = "deadbeef" * 8  # garbage
        from payment_contracts.models import validate_quote_signature
        result = validate_quote_signature(quote, public_key)
        assert result is False

    def test_tampered_payload_fails(self, signed_quote):
        """A quote whose data was altered after signing fails validation."""
        quote, public_key = signed_quote
        quote.amount = Decimal("999.99")  # tamper
        from payment_contracts.models import validate_quote_signature
        result = validate_quote_signature(quote, public_key)
        assert result is False

    def test_missing_signature_fails(self, valid_quote_dict, signer_keys):
        """A quote with empty signature fails."""
        _, public_key = signer_keys
        quote = PaymentQuote(**valid_quote_dict)
        quote.signature = ""
        from payment_contracts.models import validate_quote_signature
        result = validate_quote_signature(quote, public_key)
        assert result is False

    def test_wrong_public_key_fails(self, signed_quote):
        """Verifying with a different public key fails."""
        quote, _ = signed_quote
        wrong_key = Ed25519PrivateKey.generate().public_key()
        from payment_contracts.models import validate_quote_signature
        result = validate_quote_signature(quote, wrong_key)
        assert result is False


class TestQuoteExpirationValidation:
    """Reject expired quotes."""

    def test_future_quote_passes(self, signed_quote):
        """A quote expiring in the future passes."""
        quote, _ = signed_quote
        from payment_contracts.models import validate_quote_expiration
        result = validate_quote_expiration(quote)
        assert result is True

    def test_expired_quote_fails(self, valid_quote_dict, signer_keys):
        """A quote whose expires_at is in the past fails."""
        private_key, _ = signer_keys
        past = datetime.now(timezone.utc) - timedelta(seconds=1)
        valid_quote_dict["expires_at"] = past
        quote = PaymentQuote(**valid_quote_dict)
        message = quote.signing_payload().encode("utf-8")
        sig = private_key.sign(message)
        quote.signature = sig.hex()
        from payment_contracts.models import validate_quote_expiration
        result = validate_quote_expiration(quote)
        assert result is False

    def test_just_expired_quote_fails(self, valid_quote_dict, signer_keys):
        """A quote that expired 1 second ago fails."""
        private_key, _ = signer_keys
        just_past = datetime.now(timezone.utc) - timedelta(seconds=1)
        valid_quote_dict["expires_at"] = just_past
        quote = PaymentQuote(**valid_quote_dict)
        message = quote.signing_payload().encode("utf-8")
        sig = private_key.sign(message)
        quote.signature = sig.hex()
        from payment_contracts.models import validate_quote_expiration
        result = validate_quote_expiration(quote)
        assert result is False

    def test_near_future_quote_passes(self, valid_quote_dict, signer_keys):
        """A quote expiring just slightly in the future passes."""
        private_key, _ = signer_keys
        near_future = datetime.now(timezone.utc) + timedelta(seconds=5)
        valid_quote_dict["expires_at"] = near_future
        quote = PaymentQuote(**valid_quote_dict)
        message = quote.signing_payload().encode("utf-8")
        sig = private_key.sign(message)
        quote.signature = sig.hex()
        from payment_contracts.models import validate_quote_expiration
        result = validate_quote_expiration(quote)
        assert result is True


class TestNonceReplayProtection:
    """Reject replayed nonces."""

    @pytest.fixture
    def nonce_store(self):
        """Simple in-memory nonce store."""
        from payment_contracts.models import InMemoryNonceStore
        return InMemoryNonceStore()

    def test_fresh_nonce_passes(self, signed_quote, nonce_store):
        """A never-before-seen nonce passes."""
        quote, _ = signed_quote
        from payment_contracts.models import validate_quote_nonce
        result = validate_quote_nonce(quote, nonce_store)
        assert result is True

    def test_replayed_nonce_fails(self, signed_quote, nonce_store):
        """The same nonce used twice fails."""
        quote, _ = signed_quote
        from payment_contracts.models import validate_quote_nonce
        # First use — should pass
        assert validate_quote_nonce(quote, nonce_store) is True
        # Second use — should fail (replay)
        result = validate_quote_nonce(quote, nonce_store)
        assert result is False

    def test_different_nonces_pass(self, valid_quote_dict, signer_keys, nonce_store):
        """Different nonces are allowed."""
        private_key, _ = signer_keys
        from payment_contracts.models import validate_quote_nonce

        for i in range(3):
            d = dict(valid_quote_dict)
            d["nonce"] = f"nonce-{i:03d}"
            quote = PaymentQuote(**d)
            message = quote.signing_payload().encode("utf-8")
            sig = private_key.sign(message)
            quote.signature = sig.hex()
            assert validate_quote_nonce(quote, nonce_store) is True

    def test_nonce_store_persistence(self, signed_quote, nonce_store):
        """Nonce remains seen across calls."""
        quote, _ = signed_quote
        from payment_contracts.models import validate_quote_nonce
        assert validate_quote_nonce(quote, nonce_store) is True
        assert validate_quote_nonce(quote, nonce_store) is False

    def test_seen_method_on_store(self, signed_quote, nonce_store):
        """NonceStore.seen() correctly reports nonce state."""
        quote, _ = signed_quote
        from payment_contracts.models import validate_quote_nonce
        assert nonce_store.seen(quote.nonce) is False
        validate_quote_nonce(quote, nonce_store)
        assert nonce_store.seen(quote.nonce) is True


class TestQuoteWalletValidation:
    """Wallet must match expected recipient."""

    def test_wallet_matches_passes(self, signed_quote):
        """When recipient_wallet matches expected, passes."""
        quote, _ = signed_quote
        from payment_contracts.models import validate_quote_wallet
        result = validate_quote_wallet(quote, quote.recipient_wallet)
        assert result is True

    def test_wallet_mismatch_fails(self, signed_quote):
        """When recipient_wallet differs from expected, fails."""
        quote, _ = signed_quote
        from payment_contracts.models import validate_quote_wallet
        result = validate_quote_wallet(quote, "0x9999999999999999999999999999999999999999")
        assert result is False

    def test_case_sensitive_wallet_check(self, signed_quote):
        """Wallet check is case-sensitive."""
        quote, _ = signed_quote
        from payment_contracts.models import validate_quote_wallet
        wrong_case = quote.recipient_wallet.upper()
        if wrong_case != quote.recipient_wallet:
            result = validate_quote_wallet(quote, wrong_case)
            assert result is False


# ---------------------------------------------------------------------------
# Full validation pipeline tests
# ---------------------------------------------------------------------------

class TestFullQuoteValidation:
    """End-to-end validation combining all checks."""

    @pytest.fixture
    def nonce_store(self):
        from payment_contracts.models import InMemoryNonceStore
        return InMemoryNonceStore()

    def test_complete_valid_quote_passes(self, signed_quote, nonce_store):
        """A fully valid quote passes all checks."""
        quote, public_key = signed_quote
        from payment_contracts.models import validate_quote
        errors = validate_quote(
            quote=quote,
            public_key=public_key,
            nonce_store=nonce_store,
            expected_wallet=quote.recipient_wallet,
        )
        assert errors == []

    def test_expired_quote_rejected(self, valid_quote_dict, signer_keys, nonce_store):
        """Expired quote fails full validation."""
        private_key, public_key = signer_keys
        past = datetime.now(timezone.utc) - timedelta(minutes=5)
        valid_quote_dict["expires_at"] = past
        quote = PaymentQuote(**valid_quote_dict)
        message = quote.signing_payload().encode("utf-8")
        sig = private_key.sign(message)
        quote.signature = sig.hex()

        from payment_contracts.models import validate_quote
        errors = validate_quote(
            quote=quote,
            public_key=public_key,
            nonce_store=nonce_store,
            expected_wallet=quote.recipient_wallet,
        )
        assert "expired" in " ".join(errors).lower()

    def test_bad_signature_rejected(self, valid_quote_dict, signer_keys, nonce_store):
        """Tampered signature fails full validation."""
        _, public_key = signer_keys
        quote = PaymentQuote(**valid_quote_dict)
        quote.signature = "bad" * 20
        from payment_contracts.models import validate_quote
        errors = validate_quote(
            quote=quote,
            public_key=public_key,
            nonce_store=nonce_store,
            expected_wallet=quote.recipient_wallet,
        )
        assert "signature" in " ".join(errors).lower()

    def test_replayed_nonce_rejected(self, signed_quote, nonce_store):
        """Replayed nonce fails full validation."""
        quote, public_key = signed_quote
        from payment_contracts.models import validate_quote
        # First use
        errors1 = validate_quote(
            quote=quote,
            public_key=public_key,
            nonce_store=nonce_store,
            expected_wallet=quote.recipient_wallet,
        )
        assert errors1 == []
        # Second use (replay)
        errors2 = validate_quote(
            quote=quote,
            public_key=public_key,
            nonce_store=nonce_store,
            expected_wallet=quote.recipient_wallet,
        )
        assert "nonce" in " ".join(errors2).lower()

    def test_wallet_mismatch_rejected(self, signed_quote, nonce_store):
        """Wrong wallet fails full validation."""
        quote, public_key = signed_quote
        from payment_contracts.models import validate_quote
        errors = validate_quote(
            quote=quote,
            public_key=public_key,
            nonce_store=nonce_store,
            expected_wallet="0x0000000000000000000000000000000000000000",
        )
        assert "wallet" in " ".join(errors).lower()

    def test_multiple_failures_reported(self, valid_quote_dict, signer_keys, nonce_store):
        """Multiple validation errors are reported together."""
        private_key, public_key = signer_keys
        past = datetime.now(timezone.utc) - timedelta(hours=2)
        valid_quote_dict["expires_at"] = past
        quote = PaymentQuote(**valid_quote_dict)
        message = quote.signing_payload().encode("utf-8")
        sig = private_key.sign(message)
        quote.signature = sig.hex()
        quote.signature = "bad" * 20  # Also tamper signature

        from payment_contracts.models import validate_quote
        errors = validate_quote(
            quote=quote,
            public_key=public_key,
            nonce_store=nonce_store,
            expected_wallet="wrong_wallet",
        )
        assert len(errors) >= 2
