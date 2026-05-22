from datetime import datetime, timedelta, timezone
from decimal import Decimal

from cryptography.hazmat.primitives.asymmetric.ed25519 import Ed25519PrivateKey

from payment_contracts.models import InMemoryNonceStore, PaymentQuote, validate_quote


def _signed_quote(private_key, **overrides):
    data = {
        "quote_id": "quote-1",
        "passport_slug": "demo-tool",
        "version_hash": "sha256:abc123",
        "amount": Decimal("0.25"),
        "currency": "USDC",
        "chain": "base",
        "recipient_wallet": "0x1111111111111111111111111111111111111111",
        "expires_at": datetime.now(timezone.utc) + timedelta(minutes=5),
        "nonce": "nonce-1",
        "terms_hash": "sha256:terms",
        "proof_requirement": "hash_match",
    }
    data.update(overrides)
    quote = PaymentQuote(**data)
    signature = private_key.sign(quote.signing_payload().encode("utf-8")).hex()
    return quote.model_copy(update={"signature": signature})


def test_payment_quote_requires_delivery_proof_requirement():
    private_key = Ed25519PrivateKey.generate()
    quote = _signed_quote(private_key)

    assert quote.proof_requirement == "hash_match"


def test_invalid_quote_does_not_burn_nonce():
    private_key = Ed25519PrivateKey.generate()
    public_key = private_key.public_key()
    nonce_store = InMemoryNonceStore()
    quote = _signed_quote(private_key, nonce="nonce-dos")
    bad_quote = quote.model_copy(update={"signature": "00"})

    errors = validate_quote(
        bad_quote,
        public_key,
        nonce_store,
        expected_wallet="0x1111111111111111111111111111111111111111",
    )
    assert "invalid signature" in errors
    assert nonce_store.seen("nonce-dos") is False

    assert validate_quote(
        quote,
        public_key,
        nonce_store,
        expected_wallet="0x1111111111111111111111111111111111111111",
    ) == []
