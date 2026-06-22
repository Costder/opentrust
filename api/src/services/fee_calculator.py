"""Platform fee calculation for marketplace orders and job board settlements.

Fee schedule:
  - Marketplace:  5% seller-side fee on every order / escrow settlement
  - Job board:    $2 flat listing fee (charged at post time) +
                  4% settlement fee (deducted from seller proceeds at release)
  - Launch waiver: settlement fees are 0 for the first 90 days
                   (OPENTRUST_FEE_WAIVER_ENABLED=true + OPENTRUST_FEE_WAIVER_END_DATE set)

The $2 job listing fee is never waived.
"""
from datetime import datetime, timezone
from decimal import ROUND_HALF_UP, Decimal

from ..config import settings

_ROUND = Decimal("0.01")


def _settlement_waived() -> bool:
    """Return True if we are currently inside the launch waiver window."""
    if not settings.opentrust_fee_waiver_enabled:
        return False
    end = settings.opentrust_fee_waiver_end_date.strip()
    if not end:
        return False
    try:
        waiver_until = datetime.fromisoformat(end)
        if waiver_until.tzinfo is None:
            waiver_until = waiver_until.replace(tzinfo=timezone.utc)
        return datetime.now(timezone.utc) < waiver_until
    except ValueError:
        return False


def marketplace_settlement_fee(amount_usdc: Decimal) -> tuple[Decimal, bool]:
    """Return (fee, waived) for a marketplace order / escrow settlement.

    Fee is 5% of amount_usdc. Returns (0, True) if within the waiver window or
    fees are globally disabled.
    """
    if not settings.opentrust_marketplace_fee_enabled:
        return Decimal("0.00"), False
    waived = _settlement_waived()
    if waived:
        return Decimal("0.00"), True
    pct = Decimal(settings.opentrust_marketplace_fee_pct) / 100
    fee = (amount_usdc * pct).quantize(_ROUND, rounding=ROUND_HALF_UP)
    return fee, False


def job_settlement_fee(amount_usdc: Decimal) -> tuple[Decimal, bool]:
    """Return (fee, waived) for a job-board escrow settlement.

    Fee is 4% of amount_usdc. Returns (0, True) if within the waiver window or
    fees are globally disabled.
    """
    if not settings.opentrust_marketplace_fee_enabled:
        return Decimal("0.00"), False
    waived = _settlement_waived()
    if waived:
        return Decimal("0.00"), True
    pct = Decimal(settings.opentrust_job_settlement_fee_pct) / 100
    fee = (amount_usdc * pct).quantize(_ROUND, rounding=ROUND_HALF_UP)
    return fee, False


def job_listing_fee() -> Decimal:
    """Return the flat $2 job listing fee. Never waived."""
    if not settings.opentrust_marketplace_fee_enabled:
        return Decimal("0.00")
    return Decimal(settings.opentrust_job_listing_fee_usdc).quantize(_ROUND)
