"""On-chain USDC verification for Base L2.

Uses web3.py to read transaction receipts and verify USDC Transfer events.
No transactions are sent — this module is read-only.
"""

from __future__ import annotations

from dataclasses import dataclass
from decimal import Decimal

from web3 import Web3

# keccak256("Transfer(address,address,uint256)")
TRANSFER_TOPIC = "0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef"
USDC_DECIMALS = 6


class OnchainVerificationError(Exception):
    """Raised when a transaction cannot be verified as a valid USDC transfer."""


@dataclass
class UsdcTransferResult:
    verified: bool
    tx_hash: str
    sender: str
    recipient: str
    amount_usdc: Decimal
    block_number: int | None = None


def verify_usdc_transfer(
    *,
    tx_hash: str,
    expected_sender: str,
    expected_recipient: str,
    expected_amount_usdc: Decimal,
    rpc_url: str,
    usdc_contract: str = "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913",
    tolerance_usdc: Decimal = Decimal("0.01"),
) -> UsdcTransferResult:
    """Verify that tx_hash is a USDC transfer of at least expected_amount_usdc from sender to recipient.

    Raises OnchainVerificationError with a human-readable message on any mismatch.
    """
    w3 = Web3(Web3.HTTPProvider(rpc_url))

    receipt = w3.eth.get_transaction_receipt(tx_hash)
    if receipt is None:
        raise OnchainVerificationError(f"transaction {tx_hash} not found on chain")

    if receipt.get("status") == 0:
        raise OnchainVerificationError(f"transaction {tx_hash} reverted (status=0)")

    # Find USDC Transfer log
    transfer_log = None
    for log in receipt.get("logs", []):
        topics = log.get("topics", [])
        if (
            len(topics) >= 3
            and topics[0].lower() == TRANSFER_TOPIC.lower()
            and log.get("address", "").lower() == usdc_contract.lower()
        ):
            transfer_log = log
            break

    if transfer_log is None:
        raise OnchainVerificationError(
            f"no USDC transfer log found in transaction {tx_hash}. "
            "Verify the transaction is a USDC transfer on the correct contract."
        )

    # Decode from/to addresses from indexed topics (padded to 32 bytes)
    raw_from = transfer_log["topics"][1]
    raw_to = transfer_log["topics"][2]
    actual_sender = "0x" + (raw_from[-40:] if len(raw_from) >= 42 else raw_from[2:])
    actual_recipient = "0x" + (raw_to[-40:] if len(raw_to) >= 42 else raw_to[2:])

    # Decode amount from data (hex-encoded uint256)
    raw_data = transfer_log.get("data", "0x0")
    amount_raw = int(raw_data, 16) if isinstance(raw_data, str) else int(raw_data)
    actual_amount = Decimal(amount_raw) / Decimal(10**USDC_DECIMALS)

    # Validate sender
    if actual_sender.lower() != expected_sender.lower():
        raise OnchainVerificationError(
            f"sender mismatch: expected {expected_sender}, got {actual_sender}"
        )

    # Validate recipient
    if actual_recipient.lower() != expected_recipient.lower():
        raise OnchainVerificationError(
            f"recipient mismatch: expected {expected_recipient}, got {actual_recipient}"
        )

    # Validate amount (allow small tolerance for rounding)
    if abs(actual_amount - expected_amount_usdc) > tolerance_usdc:
        raise OnchainVerificationError(
            f"amount mismatch: expected {expected_amount_usdc} USDC, "
            f"got {actual_amount} USDC (tolerance: {tolerance_usdc})"
        )

    return UsdcTransferResult(
        verified=True,
        tx_hash=tx_hash,
        sender=actual_sender,
        recipient=actual_recipient,
        amount_usdc=actual_amount,
        block_number=receipt.get("blockNumber"),
    )
