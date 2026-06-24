"""Tests for EscrowProvider implementations and the factory."""

from decimal import Decimal
from unittest.mock import patch, MagicMock

import pytest

SELLER_ADDRESS = "0x" + "c" * 40
BUYER_ADDRESS  = "0x" + "b" * 40
ESCROW_ID      = "escrow_test"
AMOUNT         = Decimal("25.00")
FAKE_TX_HASH   = "0x" + "f" * 64


class TestMockEscrowProvider:
    def test_deposit_address_returns_mock_address(self):
        from api.src.services.escrow_provider import MockEscrowProvider, MOCK_ESCROW_ADDRESS
        p = MockEscrowProvider()
        assert p.deposit_address(ESCROW_ID) == MOCK_ESCROW_ADDRESS

    def test_release_funds_returns_mock_hash(self):
        from api.src.services.escrow_provider import MockEscrowProvider
        p = MockEscrowProvider()
        result = p.release_funds(ESCROW_ID, recipient_address=SELLER_ADDRESS, amount_usdc=AMOUNT)
        assert result.transaction_hash.startswith("mock_release_")
        assert result.escrow_id == ESCROW_ID

    def test_refund_buyer_returns_mock_hash(self):
        from api.src.services.escrow_provider import MockEscrowProvider
        p = MockEscrowProvider()
        result = p.refund_buyer(ESCROW_ID, recipient_address=BUYER_ADDRESS, amount_usdc=AMOUNT)
        assert result.transaction_hash.startswith("mock_refund_")
        assert result.escrow_id == ESCROW_ID


class TestCustodialEscrowProvider:
    WALLET_KEY  = "0x" + "1" * 64
    WALLET_ADDR = "0x" + "a" * 40
    RPC_URL     = "https://mainnet.base.org"
    USDC        = "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913"

    def _make_provider(self):
        from api.src.services.escrow_provider import CustodialEscrowProvider
        return CustodialEscrowProvider(
            private_key=self.WALLET_KEY,
            address=self.WALLET_ADDR,
            rpc_url=self.RPC_URL,
            usdc_contract=self.USDC,
        )

    def test_deposit_address_returns_configured_address(self):
        p = self._make_provider()
        assert p.deposit_address(ESCROW_ID) == self.WALLET_ADDR

    def test_release_funds_calls_send_usdc_transfer_with_seller_address(self):
        p = self._make_provider()
        with patch("api.src.services.escrow_provider.send_usdc_transfer") as mock_send:
            mock_send.return_value = FAKE_TX_HASH
            result = p.release_funds(ESCROW_ID, recipient_address=SELLER_ADDRESS, amount_usdc=AMOUNT)
        mock_send.assert_called_once_with(
            private_key=self.WALLET_KEY,
            recipient=SELLER_ADDRESS,
            amount_usdc=AMOUNT,
            rpc_url=self.RPC_URL,
            usdc_contract=self.USDC,
        )
        assert result.transaction_hash == FAKE_TX_HASH
        assert result.escrow_id == ESCROW_ID

    def test_refund_buyer_calls_send_usdc_transfer_with_buyer_address(self):
        p = self._make_provider()
        with patch("api.src.services.escrow_provider.send_usdc_transfer") as mock_send:
            mock_send.return_value = FAKE_TX_HASH
            result = p.refund_buyer(ESCROW_ID, recipient_address=BUYER_ADDRESS, amount_usdc=AMOUNT)
        mock_send.assert_called_once_with(
            private_key=self.WALLET_KEY,
            recipient=BUYER_ADDRESS,
            amount_usdc=AMOUNT,
            rpc_url=self.RPC_URL,
            usdc_contract=self.USDC,
        )
        assert result.transaction_hash == FAKE_TX_HASH

    def test_send_error_propagates_as_onchain_transfer_error(self):
        from api.src.services.onchain import OnchainTransferError
        p = self._make_provider()
        with patch("api.src.services.escrow_provider.send_usdc_transfer") as mock_send:
            mock_send.side_effect = OnchainTransferError("nonce too low")
            with pytest.raises(OnchainTransferError, match="nonce too low"):
                p.release_funds(ESCROW_ID, recipient_address=SELLER_ADDRESS, amount_usdc=AMOUNT)


class TestGetEscrowProviderFactory:
    def test_returns_mock_when_no_wallet_key_configured(self):
        from api.src.services.escrow_provider import get_escrow_provider, MockEscrowProvider
        import api.src.config as cfg
        from pydantic import SecretStr
        orig_key  = cfg.settings.escrow_wallet_private_key
        orig_addr = cfg.settings.escrow_wallet_address
        cfg.settings.escrow_wallet_private_key = SecretStr("")
        cfg.settings.escrow_wallet_address = ""
        try:
            provider = get_escrow_provider()
            assert isinstance(provider, MockEscrowProvider)
        finally:
            cfg.settings.escrow_wallet_private_key = orig_key
            cfg.settings.escrow_wallet_address = orig_addr

    def test_returns_custodial_when_wallet_key_and_address_configured(self):
        from api.src.services.escrow_provider import get_escrow_provider, CustodialEscrowProvider
        import api.src.config as cfg
        from pydantic import SecretStr
        orig_key  = cfg.settings.escrow_wallet_private_key
        orig_addr = cfg.settings.escrow_wallet_address
        cfg.settings.escrow_wallet_private_key = SecretStr("0x" + "1" * 64)
        cfg.settings.escrow_wallet_address = "0x" + "a" * 40
        try:
            provider = get_escrow_provider()
            assert isinstance(provider, CustodialEscrowProvider)
        finally:
            cfg.settings.escrow_wallet_private_key = orig_key
            cfg.settings.escrow_wallet_address = orig_addr
