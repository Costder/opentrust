"""Tests for Coinbase Commerce charge creation service."""

from decimal import Decimal
from unittest.mock import patch, MagicMock

import pytest
import httpx


class TestCreateCoinbaseCharge:
    API_KEY  = "test_api_key"
    AMOUNT   = Decimal("49.00")
    METADATA = {"checkout_id": "chk_abc"}

    def _call(self, **overrides):
        from api.src.services.coinbase import create_coinbase_charge
        kwargs = dict(
            api_key=self.API_KEY,
            name="Verified Badge",
            description="OpenTrust verified_badge",
            amount_usdc=self.AMOUNT,
            metadata=self.METADATA,
            success_url="https://opentrust.sh/success",
            cancel_url="https://opentrust.sh/cancel",
        )
        kwargs.update(overrides)
        return create_coinbase_charge(**kwargs)

    def _mock_response(self, hosted_url="https://commerce.coinbase.com/charges/abc123"):
        resp = MagicMock()
        resp.json.return_value = {"data": {"id": "abc123", "hosted_url": hosted_url}}
        resp.raise_for_status = MagicMock()
        return resp

    def test_returns_charge_data_with_hosted_url(self):
        with patch("api.src.services.coinbase.httpx.post") as mock_post:
            mock_post.return_value = self._mock_response()
            result = self._call()
        assert result["hosted_url"] == "https://commerce.coinbase.com/charges/abc123"
        assert result["id"] == "abc123"

    def test_sends_correct_api_key_header(self):
        with patch("api.src.services.coinbase.httpx.post") as mock_post:
            mock_post.return_value = self._mock_response()
            self._call()
        _, kwargs = mock_post.call_args
        assert kwargs["headers"]["X-CC-Api-Key"] == self.API_KEY

    def test_sends_correct_amount_and_currency(self):
        with patch("api.src.services.coinbase.httpx.post") as mock_post:
            mock_post.return_value = self._mock_response()
            self._call()
        _, kwargs = mock_post.call_args
        price = kwargs["json"]["local_price"]
        assert price["amount"] == "49.00"
        assert price["currency"] == "USDC"

    def test_embeds_metadata_in_payload(self):
        with patch("api.src.services.coinbase.httpx.post") as mock_post:
            mock_post.return_value = self._mock_response()
            self._call()
        _, kwargs = mock_post.call_args
        assert kwargs["json"]["metadata"] == self.METADATA

    def test_raises_coinbase_error_on_http_4xx(self):
        from api.src.services.coinbase import CoinbaseError
        with patch("api.src.services.coinbase.httpx.post") as mock_post:
            err_resp = MagicMock()
            err_resp.status_code = 401
            err_resp.text = "Unauthorized"
            mock_post.return_value = err_resp
            err_resp.raise_for_status.side_effect = httpx.HTTPStatusError(
                "401", request=MagicMock(), response=err_resp
            )
            with pytest.raises(CoinbaseError, match="401"):
                self._call()

    def test_raises_coinbase_error_on_network_failure(self):
        from api.src.services.coinbase import CoinbaseError
        with patch("api.src.services.coinbase.httpx.post") as mock_post:
            mock_post.side_effect = httpx.ConnectError("timeout")
            with pytest.raises(CoinbaseError, match="timeout"):
                self._call()
