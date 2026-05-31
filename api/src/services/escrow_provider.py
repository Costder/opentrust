"""Escrow settlement provider boundary.

The public API coordinates and verifies escrow state. Real fund movement belongs
behind this provider boundary, implemented by a reviewed contract or trusted
service. The default provider is deterministic and local-only for tests/demo.
"""

from dataclasses import dataclass


MOCK_ESCROW_ADDRESS = "0x" + "e" * 40


@dataclass(frozen=True)
class SettlementResult:
    escrow_id: str
    transaction_hash: str


class MockEscrowProvider:
    def deposit_address(self, escrow_id: str) -> str:
        return MOCK_ESCROW_ADDRESS

    def release_funds(self, escrow_id: str) -> SettlementResult:
        return SettlementResult(escrow_id=escrow_id, transaction_hash=f"mock_release_{escrow_id}")

    def refund_buyer(self, escrow_id: str) -> SettlementResult:
        return SettlementResult(escrow_id=escrow_id, transaction_hash=f"mock_refund_{escrow_id}")


def get_escrow_provider() -> MockEscrowProvider:
    return MockEscrowProvider()
