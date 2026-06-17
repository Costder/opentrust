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

        with pytest.raises(OnchainVerificationError, match="did not succeed"):
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

    def test_wrong_sender_raises_error(self, mock_web3):
        sender = "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"
        recipient = "0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb"
        mock_web3.eth.get_transaction_receipt.return_value = (
            self._make_receipt(sender, recipient, int(Decimal("25.00") * 10**6))
        )

        with pytest.raises(OnchainVerificationError, match="sender mismatch"):
            verify_usdc_transfer(
                tx_hash="0x" + "a" * 64,
                expected_sender="0xcccccccccccccccccccccccccccccccccccccccc",  # wrong sender
                expected_recipient=recipient,
                expected_amount_usdc=Decimal("25.00"),
                rpc_url="https://mainnet.base.org",
            )

    def test_wrong_recipient_raises_error(self, mock_web3):
        sender = "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"
        recipient = "0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb"
        mock_web3.eth.get_transaction_receipt.return_value = (
            self._make_receipt(sender, recipient, int(Decimal("25.00") * 10**6))
        )

        with pytest.raises(OnchainVerificationError, match="recipient mismatch"):
            verify_usdc_transfer(
                tx_hash="0x" + "a" * 64,
                expected_sender=sender,
                expected_recipient="0xdddddddddddddddddddddddddddddddddddddddd",  # wrong recipient
                expected_amount_usdc=Decimal("25.00"),
                rpc_url="https://mainnet.base.org",
            )


class TestSendUsdcTransfer:
    """send_usdc_transfer signs and broadcasts a USDC transfer on Base L2."""

    PRIVATE_KEY = "0x" + "1" * 64   # deterministic fake key for mocking
    RECIPIENT   = "0x" + "b" * 40
    AMOUNT      = Decimal("25.00")
    RPC_URL     = "https://mainnet.base.org"
    USDC        = "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913"
    TX_HASH     = b"\xab" * 32

    @pytest.fixture
    def mock_web3_send(self):
        """Patch Web3 so no real RPC calls are made."""
        with patch("api.src.services.onchain.Web3") as mock_cls:
            instance = MagicMock()
            mock_cls.return_value = instance
            mock_cls.HTTPProvider = MagicMock()
            mock_cls.to_checksum_address = lambda addr: addr

            # Simulate chain state
            instance.eth.get_transaction_count.return_value = 0
            instance.eth.chain_id = 8453  # Base L2

            # build_transaction → returns a dict; sign → raw_transaction bytes
            tx_dict = {"from": "0x" + "a" * 40, "nonce": 0, "chainId": 8453}
            contract_mock = MagicMock()
            transfer_fn = MagicMock()
            transfer_fn.build_transaction.return_value = tx_dict
            contract_mock.functions.transfer.return_value = transfer_fn
            instance.eth.contract.return_value = contract_mock

            signed = MagicMock()
            signed.raw_transaction = b"\x00" * 32
            with patch("api.src.services.onchain.EthAccount") as mock_account_cls:
                mock_account = MagicMock()
                mock_account.address = "0x" + "a" * 40
                mock_account_cls.from_key.return_value = mock_account
                mock_account.sign_transaction.return_value = signed
                instance.eth.send_raw_transaction.return_value = self.TX_HASH
                yield instance, mock_account, contract_mock

    def test_returns_0x_prefixed_tx_hash(self, mock_web3_send):
        from api.src.services.onchain import send_usdc_transfer
        instance, _, _ = mock_web3_send
        result = send_usdc_transfer(
            private_key=self.PRIVATE_KEY,
            recipient=self.RECIPIENT,
            amount_usdc=self.AMOUNT,
            rpc_url=self.RPC_URL,
            usdc_contract=self.USDC,
        )
        assert result.startswith("0x")
        assert len(result) == 66  # 0x + 64 hex chars

    def test_converts_amount_to_usdc_decimals(self, mock_web3_send):
        """25.00 USDC must be passed to transfer() as 25_000_000 (6 decimals)."""
        from api.src.services.onchain import send_usdc_transfer
        _, _, contract_mock = mock_web3_send
        send_usdc_transfer(
            private_key=self.PRIVATE_KEY,
            recipient=self.RECIPIENT,
            amount_usdc=self.AMOUNT,
            rpc_url=self.RPC_URL,
            usdc_contract=self.USDC,
        )
        args, _ = contract_mock.functions.transfer.call_args
        assert args[1] == 25_000_000  # 25.00 * 10**6

    def test_calls_transfer_with_correct_recipient(self, mock_web3_send):
        from api.src.services.onchain import send_usdc_transfer
        _, _, contract_mock = mock_web3_send
        send_usdc_transfer(
            private_key=self.PRIVATE_KEY,
            recipient=self.RECIPIENT,
            amount_usdc=self.AMOUNT,
            rpc_url=self.RPC_URL,
            usdc_contract=self.USDC,
        )
        args, _ = contract_mock.functions.transfer.call_args
        assert args[0] == self.RECIPIENT

    def test_raises_onchain_transfer_error_on_rpc_failure(self, mock_web3_send):
        from api.src.services.onchain import send_usdc_transfer, OnchainTransferError
        instance, _, _ = mock_web3_send
        instance.eth.send_raw_transaction.side_effect = Exception("connection refused")
        with pytest.raises(OnchainTransferError, match="connection refused"):
            send_usdc_transfer(
                private_key=self.PRIVATE_KEY,
                recipient=self.RECIPIENT,
                amount_usdc=self.AMOUNT,
                rpc_url=self.RPC_URL,
                usdc_contract=self.USDC,
            )
