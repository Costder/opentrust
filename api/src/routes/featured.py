"""
Featured listings route — curated promoted tools shown at the top of marketplace/search.

TODO (implement):
  - Admin POST/DELETE endpoints need real auth middleware (admin role check)
  - Replace stubs with actual DB queries
"""

from fastapi import APIRouter, HTTPException
from typing import Optional
from pydantic import BaseModel
from datetime import datetime

router = APIRouter(tags=["featured"])


class CreateFeaturedRequest(BaseModel):
    listing_id: str
    placement:  str = "marketplace_top"
    starts_at:  Optional[datetime] = None
    ends_at:    Optional[datetime] = None


@router.get("/api/featured")
async def list_featured(placement: str = "marketplace_top"):
    # TODO: query featured_listings JOIN listings WHERE placement=$1
    return []


@router.post("/api/admin/featured")
async def create_featured(req: CreateFeaturedRequest):
    # TODO: add admin auth middleware + INSERT INTO featured_listings
    return {"status": "stub"}


@router.delete("/api/admin/featured/{listing_id}")
async def remove_featured(listing_id: str):
    # TODO: DELETE FROM featured_listings WHERE listing_id=$1
    return {"status": "stub"}
