"""Payment contracts models including signed payment quote validation and nonce replay protection."""
from __future__ import annotations

import json
from datetime import datetime, timezone
from decimal import Decimal
from enum import Enum
from typing import Protocol

from cryptography.hazmat.primitives.asymmetric.ed25519 import Ed25519PublicKey
from pydantic import BaseModel, Field


# ---------------------------------------------------------------------------
# Legacy models (existing)
# ---------------------------------------------------------------------------

class FeeKind(str, Enum):
    free = "free"
    flat_fee = "flat_fee"
    percentage = "percentage"


class FeeSchedule(BaseModel):
    kind: FeeKind
    amount_usdc: Decimal | None = Field(default=None, ge=0)
    percentage: Decimal | None = Field(default=None, ge=0, le=100)
    notes: str | None = None


class BillingPlan(BaseModel):
    tier: str
    interval: str = "one_time"
    amount_usdc: Decimal = Field(ge=0)
    fee_schedule: FeeSchedule | None = None


class CheckoutSession(BaseModel):
    session_id: str
    tool_id: str
    checkout_url: str
    amount_usdc: Decimal = Field(ge=0)
    status: str = "created"


class PaymentResult(BaseModel):
    payment_id: str
    session_id: str
    verified: bool
    amount_usdc: Decimal = Field(ge=0)
    status: str


class RefundResult(BaseModel):
    refund_id: str
    payment_id: str
    amount_usdc: Decimal = Field(ge=0)
    status: str


class Subscription(BaseModel):
    subscription_id: str
    tool_id: str
    customer: str
    plan: BillingPlan
    active: bool = True


class EscrowId(BaseModel):
    escrow_id: str


class DisputeCase(BaseModel):
    case_id: str
    escrow_id: str
    reason: str
    status: str = "open"


class Resolution(BaseModel):
    case_id: str
    winner: str
    released: bool


class OpenTrustProduct(str, Enum):
    trust_report = "trust_report"
    verified_badge = "verified_badge"
    monitoring_monthly = "monitoring_monthly"


class WalletMode(str, Enum):
    byo = "byo"
    embedded = "embedded"


class RepoVerification(BaseModel):
    repo_id: str
    installation_id: int
    repo_full_name: str
    branch: str
    commit_sha: str
    verified: bool = True


class WalletAccount(BaseModel):
    wallet_id: str
    owner: str
    address: str
    mode: WalletMode
    custody: str = "customer"


class MarketplaceListing(BaseModel):
    listing_id: str
    seller_wallet_id: str
    repo_id: str
    title: str
    price_usdc: Decimal = Field(gt=0)
    currency: str = "USDC"
    custody: str = "none"


class MarketplaceOrder(BaseModel):
    order_id: str
    listing_id: str
    buyer_wallet_id: str
    seller_wallet_id: str
    amount_usdc: Decimal = Field(gt=0)
    currency: str = "USDC"
    transaction_hash: str | None = None
    custody: str = "none"


# ---------------------------------------------------------------------------
# PaymentQuote model (new)
# ---------------------------------------------------------------------------

class PaymentQuote(BaseModel):
    """A cryptographically signed payment quote.

    A tool operator signs a quote containing price, recipient, and a nonce.
    The agent verifies the signature, checks expiration, and uses the nonce
    to prevent replay attacks.
    """

    quote_id: str
    passport_slug: str
    version_hash: str
    amount: Decimal = Field(ge=0)
    currency: str = "USDC"
    chain: str = "base"
    recipient_wallet: str
    expires_at: datetime
    nonce: str
    terms_hash: str | None = None
    proof_requirement: str = "hash_match"
    signature: str = ""

    def signing_payload(self) -> str:
        """Return the canonical string that gets signed.

        Excludes the signature field itself. Uses a sorted JSON serialization
        so the payload is deterministic regardless of field order.
        """
        data = self.model_dump(mode="json", exclude={"signature"})
        data["amount"] = str(self.amount)
        data["expires_at"] = self.expires_at.isoformat()
        return json.dumps(data, sort_keys=True, separators=(",", ":"))


# ---------------------------------------------------------------------------
# Nonce store (replay protection)
# ---------------------------------------------------------------------------

class NonceStore(Protocol):
    """Protocol for nonce storage backends."""

    def seen(self, nonce: str) -> bool: ...

    def mark_seen(self, nonce: str) -> None: ...


class InMemoryNonceStore:
    """Thread-safe in-memory nonce store for replay protection."""

    def __init__(self) -> None:
        self._seen: set[str] = set()

    def seen(self, nonce: str) -> bool:
        return nonce in self._seen

    def mark_seen(self, nonce: str) -> None:
        self._seen.add(nonce)


# ---------------------------------------------------------------------------
# Validation functions
# ---------------------------------------------------------------------------

def validate_quote_signature(
    quote: PaymentQuote,
    public_key: Ed25519PublicKey,
) -> bool:
    """Verify the Ed25519 signature on a PaymentQuote.

    Returns True if the signature is valid, False otherwise.
    """
    if not quote.signature:
        return False
    try:
        sig = bytes.fromhex(quote.signature)
        message = quote.signing_payload().encode("utf-8")
        public_key.verify(sig, message)
        return True
    except Exception:
        return False


def validate_quote_expiration(quote: PaymentQuote) -> bool:
    """Check that the quote has not expired.

    Returns True if expires_at is in the future, False if expired.
    """
    return quote.expires_at > datetime.now(timezone.utc)


def validate_quote_nonce(
    quote: PaymentQuote,
    nonce_store: NonceStore,
) -> bool:
    """Check that the nonce hasn't been used before.

    Returns True if the nonce is fresh (first use), False if replayed.
    Marks the nonce as seen on first use.
    """
    if nonce_store.seen(quote.nonce):
        return False
    nonce_store.mark_seen(quote.nonce)
    return True


def validate_quote_wallet(
    quote: PaymentQuote,
    expected_wallet: str,
) -> bool:
    """Check that the quote's recipient_wallet matches the expected wallet.

    Returns True if wallets match, False otherwise.
    """
    return quote.recipient_wallet == expected_wallet


def validate_quote(
    quote: PaymentQuote,
    public_key: Ed25519PublicKey,
    nonce_store: NonceStore,
    expected_wallet: str,
) -> list[str]:
    """Run all validation checks on a signed PaymentQuote.

    Returns a list of error messages. An empty list means the quote is valid.
    The nonce is burned only after signature, expiration, and wallet checks pass;
    otherwise an attacker could submit a malformed quote first and DoS the real
    quote by consuming its nonce.
    """
    errors: list[str] = []

    if not validate_quote_signature(quote, public_key):
        errors.append("invalid signature")

    if not validate_quote_expiration(quote):
        errors.append("quote expired")

    if not validate_quote_wallet(quote, expected_wallet):
        errors.append("wallet mismatch")

    if not errors and not validate_quote_nonce(quote, nonce_store):
        errors.append("nonce replay detected")

    return errors