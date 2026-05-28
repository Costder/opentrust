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


def _to_hex(value: object) -> str:
    """Normalise a HexBytes, bytes, or str value to a lowercase 0x-prefixed hex string.

    web3.py v6+ returns topics and data as HexBytes (bytes subclass), not str.
    This helper ensures both forms work identically.
    """
    if isinstance(value, (bytes, bytearray)):
        return "0x" + value.hex()
    return str(value).lower()


def _extract_address(topic: object, label: str) -> str:
    """Extract a 20-byte EVM address from a 32-byte padded topic.

    Raises OnchainVerificationError for malformed topics rather than silently
    producing garbage addresses.

    Returns a lowercase 0x-prefixed address (NOT EIP-55 checksummed).
    """
    hex_topic = _to_hex(topic)
    if len(hex_topic) < 42:
        raise OnchainVerificationError(
            f"malformed topic for {label}: expected 66-char hex, got {hex_topic!r}"
        )
    return "0x" + hex_topic[-40:]


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

    if receipt.get("status") != 1:
        raise OnchainVerificationError(
            f"transaction {tx_hash} did not succeed (status={receipt.get('status')!r})"
        )

    # Find USDC Transfer log
    transfer_log = None
    for log in receipt.get("logs", []):
        topics = log.get("topics", [])
        if (
            len(topics) >= 3
            and _to_hex(topics[0]) == TRANSFER_TOPIC.lower()
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
    actual_sender = _extract_address(transfer_log["topics"][1], "sender")
    actual_recipient = _extract_address(transfer_log["topics"][2], "recipient")

    # Decode amount from data (hex-encoded uint256)
    raw_data = _to_hex(transfer_log.get("data") or "0x0")
    if raw_data in ("0x", ""):
        raw_data = "0x0"
    try:
        amount_raw = int(raw_data, 16)
    except (ValueError, TypeError) as exc:
        raise OnchainVerificationError(
            f"could not decode transfer amount from data field {raw_data!r}: {exc}"
        ) from exc
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
