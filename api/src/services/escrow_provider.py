"""Escrow settlement provider boundary.

The public API coordinates and verifies escrow state. Real fund movement belongs
behind this provider boundary so the OSS codebase contains no private keys.

In development/CI, get_escrow_provider() returns MockEscrowProvider (no config needed).
In production with OPENTRUST_ESCROW_ENABLED=true, set ESCROW_WALLET_PRIVATE_KEY and
ESCROW_WALLET_ADDRESS to enable CustodialEscrowProvider.
"""

from __future__ import annotations

from dataclasses import dataclass
from decimal import Decimal
from typing import Protocol

from .onchain import OnchainTransferError, send_usdc_transfer  # noqa: F401 (re-exported)


MOCK_ESCROW_ADDRESS = "0x" + "e" * 40


@dataclass(frozen=True)
class SettlementResult:
    escrow_id: str
    transaction_hash: str


class EscrowProvider(Protocol):
    """Structural interface shared by both provider implementations."""

    def deposit_address(self, escrow_id: str) -> str: ...

    def release_funds(
        self, escrow_id: str, *, recipient_address: str, amount_usdc: Decimal
    ) -> SettlementResult: ...

    def refund_buyer(
        self, escrow_id: str, *, recipient_address: str, amount_usdc: Decimal
    ) -> SettlementResult: ...


class MockEscrowProvider:
    """Deterministic local-only provider. No network calls. Safe for tests and dev."""

    def deposit_address(self, escrow_id: str) -> str:
        return MOCK_ESCROW_ADDRESS

    def release_funds(
        self, escrow_id: str, *, recipient_address: str = "", amount_usdc: Decimal = Decimal("0")
    ) -> SettlementResult:
        return SettlementResult(escrow_id=escrow_id, transaction_hash=f"mock_release_{escrow_id}")

    def refund_buyer(
        self, escrow_id: str, *, recipient_address: str = "", amount_usdc: Decimal = Decimal("0")
    ) -> SettlementResult:
        return SettlementResult(escrow_id=escrow_id, transaction_hash=f"mock_refund_{escrow_id}")


class CustodialEscrowProvider:
    """Production provider: signs and broadcasts real USDC transfers on Base L2.

    The private key is passed in from config — it is never stored in the class
    beyond the lifetime of a single request.
    """

    def __init__(
        self,
        *,
        private_key: str,
        address: str,
        rpc_url: str,
        usdc_contract: str,
    ) -> None:
        self._private_key = private_key
        self._address = address
        self._rpc_url = rpc_url
        self._usdc_contract = usdc_contract

    def deposit_address(self, escrow_id: str) -> str:
        return self._address

    def release_funds(
        self, escrow_id: str, *, recipient_address: str, amount_usdc: Decimal
    ) -> SettlementResult:
        tx_hash = send_usdc_transfer(
            private_key=self._private_key,
            recipient=recipient_address,
            amount_usdc=amount_usdc,
            rpc_url=self._rpc_url,
            usdc_contract=self._usdc_contract,
        )
        return SettlementResult(escrow_id=escrow_id, transaction_hash=tx_hash)

    def refund_buyer(
        self, escrow_id: str, *, recipient_address: str, amount_usdc: Decimal
    ) -> SettlementResult:
        tx_hash = send_usdc_transfer(
            private_key=self._private_key,
            recipient=recipient_address,
            amount_usdc=amount_usdc,
            rpc_url=self._rpc_url,
            usdc_contract=self._usdc_contract,
        )
        return SettlementResult(escrow_id=escrow_id, transaction_hash=tx_hash)


def get_escrow_provider() -> MockEscrowProvider | CustodialEscrowProvider:
    """Return the configured provider.

    Returns MockEscrowProvider when ESCROW_WALLET_PRIVATE_KEY is not set
    (safe for dev/CI — no payment config required).
    Returns CustodialEscrowProvider when both key and address are set.
    """
    from ..config import settings
    escrow_key = settings.escrow_wallet_private_key.get_secret_value().strip() if settings.escrow_wallet_private_key else ""
    if escrow_key and settings.escrow_wallet_address.strip():
        return CustodialEscrowProvider(
            private_key=escrow_key,
            address=settings.escrow_wallet_address,
            rpc_url=settings.base_rpc_url,
            usdc_contract=settings.base_usdc_contract,
        )
    return MockEscrowProvider()
