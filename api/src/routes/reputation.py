"""Reputation read surface.

Reputation is registry-computed from settled escrow outcomes and counterparty
ratings (see services.marketplace_store). These endpoints are read-only — there
is no write path a party can use to set its own reputation.
"""
from fastapi import APIRouter, Depends, HTTPException, Query

from ..database import Database, get_db
from ..schemas.reputation import CounterpartyRating, ReputationRecord, SubjectKind
from ..services.marketplace_store import store
from ._durable import hydrate_ratings, hydrate_reputation

router = APIRouter(prefix="/reputation", tags=["reputation"])


@router.get("/{subject_id}", response_model=ReputationRecord)
async def get_reputation(subject_id: str, kind: SubjectKind | None = Query(default=None), db: Database = Depends(get_db)):
    await hydrate_reputation(db)
    record = store.get_reputation(subject_id, kind)
    if record is None:
        raise HTTPException(status_code=404, detail="no reputation record for this subject")
    return record


@router.get("/{subject_id}/ratings", response_model=list[CounterpartyRating])
async def get_reputation_ratings(subject_id: str, db: Database = Depends(get_db)):
    await hydrate_ratings(db)
    return store.list_ratings_for_subject(subject_id)
