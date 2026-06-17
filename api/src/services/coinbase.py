"""Coinbase Commerce charge creation.

Isolated from the store so it can be mocked independently.
Never import or log api_key values in error messages.
"""

from __future__ import annotations

from decimal import Decimal

import httpx

COINBASE_CHARGES_URL = "https://api.commerce.coinbase.com/charges"
COINBASE_API_VERSION = "2018-03-22"


class CoinbaseError(Exception):
    """Raised when the Coinbase Commerce API returns an error or is unreachable."""


def create_coinbase_charge(
    *,
    api_key: str,
    name: str,
    description: str,
    amount_usdc: Decimal,
    metadata: dict,
    success_url: str = "",
    cancel_url: str = "",
) -> dict:
    """Create a Coinbase Commerce charge and return the charge data dict.

    The returned dict contains at minimum 'hosted_url' (the buyer's checkout page)
    and 'id' (the Coinbase charge ID).

    Raises CoinbaseError on any HTTP or network failure.
    """
    payload: dict = {
        "name": name,
        "description": description,
        "pricing_type": "fixed_price",
        "local_price": {"amount": str(amount_usdc), "currency": "USDC"},
        "metadata": metadata,
    }
    if success_url:
        payload["redirect_url"] = success_url
    if cancel_url:
        payload["cancel_url"] = cancel_url

    try:
        response = httpx.post(
            COINBASE_CHARGES_URL,
            json=payload,
            headers={
                "X-CC-Api-Key": api_key,
                "X-CC-Version": COINBASE_API_VERSION,
                "Content-Type": "application/json",
            },
            timeout=10.0,
        )
        response.raise_for_status()
        return response.json()["data"]
    except httpx.HTTPStatusError as exc:
        raise CoinbaseError(
            f"Coinbase API error {exc.response.status_code}: {exc.response.text}"
        ) from exc
    except Exception as exc:
        raise CoinbaseError(str(exc)) from exc
