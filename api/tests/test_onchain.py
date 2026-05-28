"""Tests for on-chain USDC verification.

Uses unittest.mock to avoid hitting real RPC nodes.
"""

import pytest
from decimal import Decimal
from unittest.mock import patch, MagicMock
from api.src.services.onchain import verify_usdc_transfer, UsdcTransferResult, OnchainVerificationError


class TestVerifyUsdcTransfer:
    @pytest.fixture
    def mock_web3(self):
        """Patch Web3 at the module level so no real RPC calls are made."""
        with patch("api.src.services.onchain.Web3") as mock_cls:
            instance = MagicMock()
            mock_cls.return_value = instance
            mock_cls.HTTPProvider = MagicMock()
            instance.is_connected.return_value = True
            yield instance

    def _make_receipt(self, sender, recipient, amount_raw, success=True):
        """Build a fake transaction receipt with a USDC Transfer log."""
        TRANSFER_TOPIC = "0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef"
        return {
            "status": 1 if success else 0,
            "logs": [
                {
                    "address": "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913",
                    "topics": [
                        TRANSFER_TOPIC,
                        "0x" + "0" * 24 + sender[2:],    # padded from
                        "0x" + "0" * 24 + recipient[2:], # padded to
                    ],
                    "data": hex(amount_raw),
                }
            ],
        }

    def test_valid_transfer_returns_result(self, mock_web3):
        sender = "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"
        recipient = "0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb"
        amount_usdc = Decimal("25.00")
        amount_raw = int(amount_usdc * 10**6)

        mock_web3.eth.get_transaction_receipt.return_value = (
            self._make_receipt(sender, recipient, amount_raw)
        )

        result = verify_usdc_transfer(
            tx_hash="0x" + "a" * 64,
            expected_sender=sender,
            expected_recipient=recipient,
            expected_amount_usdc=amount_usdc,
            rpc_url="https://mainnet.base.org",
        )

        assert result.verified is True
        assert result.amount_usdc == amount_usdc
        assert result.sender.lower() == sender.lower()
        assert result.recipient.lower() == recipient.lower()

    def test_wrong_amount_raises_error(self, mock_web3):
        sender = "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"
        recipient = "0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb"
        # Receipt shows 10 USDC but we expect 25
        mock_web3.eth.get_transaction_receipt.return_value = (
            self._make_receipt(sender, recipient, int(Decimal("10.00") * 10**6))
        )

        with pytest.raises(OnchainVerificationError, match="amount mismatch"):
            verify_usdc_transfer(
                tx_hash="0x" + "a" * 64,
                expected_sender=sender,
                expected_recipient=recipient,
                expected_amount_usdc=Decimal("25.00"),
                rpc_url="https://mainnet.base.org",
            )

    def test_failed_transaction_raises_error(self, mock_web3):
        sender = "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"
        recipient = "0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb"
        mock_web3.eth.get_transaction_receipt.return_value = (
            self._make_receipt(sender, recipient, int(Decimal("25.00") * 10**6), success=False)
        )

        with pytest.raises(OnchainVerificationError, match="reverted"):
            verify_usdc_transfer(
                tx_hash="0x" + "a" * 64,
                expected_sender=sender,
                expected_recipient=recipient,
                expected_amount_usdc=Decimal("25.00"),
                rpc_url="https://mainnet.base.org",
            )

    def test_no_usdc_transfer_log_raises_error(self, mock_web3):
        mock_web3.eth.get_transaction_receipt.return_value = {"status": 1, "logs": []}

        with pytest.raises(OnchainVerificationError, match="no USDC transfer"):
            verify_usdc_transfer(
                tx_hash="0x" + "a" * 64,
                expected_sender="0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
                expected_recipient="0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
                expected_amount_usdc=Decimal("25.00"),
                rpc_url="https://mainnet.base.org",
            )

    def test_tx_not_found_raises_error(self, mock_web3):
        mock_web3.eth.get_transaction_receipt.return_value = None

        with pytest.raises(OnchainVerificationError, match="not found"):
            verify_usdc_transfer(
                tx_hash="0x" + "a" * 64,
                expected_sender="0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
                expected_recipient="0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
                expected_amount_usdc=Decimal("25.00"),
                rpc_url="https://mainnet.base.org",
            )
