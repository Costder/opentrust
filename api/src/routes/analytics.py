"""
Seller analytics route.

TODO:
  - Add auth middleware: caller must own the listing
  - Replace stub with real aggregation queries on listing_events
"""

from fastapi import APIRouter, Query
from typing import Optional
from datetime import datetime, timedelta

router = APIRouter(prefix="/api/analytics", tags=["analytics"])


@router.get("/listings/{listing_id}")
async def get_listing_analytics(
    listing_id: str,
    from_date: Optional[str] = Query(None, alias="from", description="ISO8601 start date"),
    to_date:   Optional[str] = Query(None, alias="to",   description="ISO8601 end date"),
    granularity: str = Query("day"),
):
    """Return analytics for a single listing. Auth: caller must own listing_id.
    Returns: {
      listing_id, period: {from, to},
      totals: {views, installs, revenue_usdc, badge_clicks},
      timeseries: [{date, views, installs, revenue_usdc}]
    }
    TODO: SELECT date_trunc(granularity, created_at) AS date, COUNT(*) FILTER
    (WHERE event_type='view') AS views FROM listing_events WHERE listing_id=$1
    """
    to_dt = datetime.utcnow() if not to_date else datetime.fromisoformat(to_date)
    from_dt = to_dt - timedelta(days=30) if not from_date else datetime.fromisoformat(from_date)
    # TODO: replace with real DB aggregation
    return {
        "listing_id": listing_id,
        "period": {"from": from_dt.isoformat(), "to": to_dt.isoformat()},
        "totals": {"views": 0, "installs": 0, "revenue_usdc": 0.0, "badge_clicks": 0},
        "timeseries": [],
    }
